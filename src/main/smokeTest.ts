import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrowserWindow } from 'electron';

/**
 * Headless launch verification.
 *
 * Run with `--smoke-test` and the app boots, waits for the renderer to settle,
 * captures the window to a PNG, reports anything the renderer logged as an
 * error, and exits with a non-zero code if the UI failed to come up.
 *
 * This exists because "the process is still alive" is a weak claim: an Electron
 * app whose renderer threw on first render keeps running happily with a blank
 * white window. Capturing a real frame and checking for console errors is the
 * difference between "it launched" and "it works".
 */

export interface SmokeResult {
  ok: boolean;
  errors: string[];
  screenshotPath: string | null;
  /** Element counts read out of the live DOM. */
  dom: { columns: number; cards: number; topbar: boolean } | null;
}

export function isSmokeTest(argv: string[]): boolean {
  return argv.includes('--smoke-test');
}

export async function runSmokeTest(
  window: BrowserWindow,
  screenshotPath: string,
  settleMs = 6000,
): Promise<SmokeResult> {
  const errors: string[] = [];

  window.webContents.on('console-message', (_e, level, message) => {
    // level 3 is 'error' in Chromium's logging severity.
    if (level >= 3) errors.push(message);
  });
  window.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`Renderer process gone: ${details.reason}`);
  });
  window.webContents.on('did-fail-load', (_e, code, description) => {
    errors.push(`Page failed to load (${code}): ${description}`);
  });

  await new Promise((resolve) => setTimeout(resolve, settleMs));

  let dom: SmokeResult['dom'] = null;
  try {
    dom = (await window.webContents.executeJavaScript(
      `({
        columns: document.querySelectorAll('.column').length,
        cards: document.querySelectorAll('.card').length,
        topbar: !!document.querySelector('.topbar h1'),
      })`,
    )) as SmokeResult['dom'];
  } catch (err) {
    errors.push(`Could not query the DOM: ${err instanceof Error ? err.message : String(err)}`);
  }

  let screenshot: string | null = null;
  try {
    await settleFrame(window);
    const image = await window.webContents.capturePage();
    await fs.mkdir(dirname(screenshotPath), { recursive: true });
    await fs.writeFile(screenshotPath, image.toPNG());
    screenshot = screenshotPath;
  } catch (err) {
    errors.push(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // A board that rendered no columns means the renderer mounted but the data
  // never arrived — visually a blank panel, which a liveness check would miss.
  const rendered = Boolean(dom && dom.topbar && dom.columns > 0);
  if (!rendered) errors.push('The board did not render any columns.');

  return { ok: rendered && errors.length === 0, errors, screenshotPath: screenshot, dom };
}

/**
 * Make sure the next capture shows the DOM as it is now.
 *
 * `capturePage` returns the last frame Chromium composited. A window behind
 * other windows stops getting new frames, so without this a capture taken right
 * after a click shows the screen from before the click. Invalidating and
 * waiting two animation frames forces a fresh paint first.
 */
export async function settleFrame(window: BrowserWindow): Promise<void> {
  window.webContents.invalidate();
  await window.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Chromium switches for self-test runs only: stop Windows occlusion tracking and
 * background throttling from freezing a window the tester cannot see. Must be
 * applied before the app is ready.
 */
export const SMOKE_TEST_SWITCHES: [string, string?][] = [
  ['disable-features', 'CalculateNativeWinOcclusion'],
  ['disable-renderer-backgrounding'],
  ['disable-background-timer-throttling'],
];

export interface SettingsCapture {
  /** Screenshot path per step, e.g. { accounts: "…/smoke-accounts.png" }. */
  shots: Record<string, string | null>;
  /** Text of each account row as rendered. */
  accountRows: string[];
  credentialFields: number;
  /** Number of model/effort pickers rendered on each tab. */
  pickers: Record<string, number>;
  /** Option counts of the first model and effort select on the Accounts tab. */
  firstPickerOptions: { models: number; efforts: number } | null;
  expanderItems: number;
  mcpGroups: string[];
  mcpSignInButtons: number;
  errors: string[];
}

/**
 * Open Settings and photograph every tab, including an opened list on the
 * Environment tab and its MCP section.
 *
 * The Accounts tab shows real sign-in status read from each CLI, which needs the
 * environment scan to finish first, so this waits for the status rows to appear
 * rather than for a fixed time. Counts read from the live DOM are returned
 * alongside the screenshots so the result can be checked without looking.
 */
export async function captureSettingsScreens(
  window: BrowserWindow,
  dir: string,
  timeoutMs = 240_000,
): Promise<SettingsCapture> {
  const errors: string[] = [];
  const shots: Record<string, string | null> = {};
  const pickers: Record<string, number> = {};
  const js = <T>(code: string): Promise<T> => window.webContents.executeJavaScript(code) as Promise<T>;
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const clickButton = (label: string): Promise<boolean> =>
    js<boolean>(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return Boolean(b); })()`,
    );
  const countPickers = (): Promise<number> => js<number>(`document.querySelectorAll('.modal .picker').length`);

  const shot = async (name: string): Promise<void> => {
    try {
      await settleFrame(window);
      const image = await window.webContents.capturePage();
      const path = join(dir, `smoke-${name}.png`);
      await fs.writeFile(path, image.toPNG());
      shots[name] = path;
    } catch (err) {
      errors.push(`Screenshot ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      shots[name] = null;
    }
  };

  if (!(await clickButton('Settings'))) errors.push('No Settings button found.');

  // Accounts — wait for real sign-in status and the pickers under each row.
  const started = Date.now();
  let accountRows: string[] = [];
  while (Date.now() - started < timeoutMs) {
    accountRows = await js<string[]>(
      `[...document.querySelectorAll('.modal .status-row .sr-name')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`,
    );
    if (accountRows.length > 0 && (await countPickers()) > 0) break;
    await pause(1000);
  }
  if (accountRows.length === 0) errors.push('Account status never appeared.');
  pickers.accounts = await countPickers();
  const firstPickerOptions = await js<{ models: number; efforts: number } | null>(
    `(() => { const p = document.querySelector('.modal .picker'); if (!p) return null; const s = p.querySelectorAll('select'); return { models: s[0] ? s[0].options.length : 0, efforts: s[1] ? s[1].options.length : 0 }; })()`,
  );
  await pause(400);
  await shot('accounts');

  // Connections, then Credentials.
  for (const tab of ['Connections', 'Credentials']) {
    if (!(await clickButton(tab))) errors.push(`No ${tab} tab found.`);
    await pause(800);
    pickers[tab.toLowerCase()] = await countPickers();
    await shot(tab.toLowerCase());
  }
  const credentialFields = await js<number>(`document.querySelectorAll('.modal input[type="password"]').length`);

  // Environment — open the Models list, photograph, then the MCP section.
  if (!(await clickButton('Environment'))) errors.push('No Environment tab found.');
  await pause(800);
  await js(
    `(() => { const h = [...document.querySelectorAll('.expander-head')].find((b) => b.textContent.includes('Models')); if (h) h.click(); })()`,
  );
  await pause(500);
  const expanderItems = await js<number>(`document.querySelectorAll('.expander-body .filter-row').length`);
  await shot('environment-models');

  const mcpGroups = await js<string[]>(
    `[...document.querySelectorAll('.mcp-group-head')].map((e) => e.textContent.trim())`,
  );
  const mcpSignInButtons = await js<number>(
    `[...document.querySelectorAll('.mcp-head button')].filter((b) => /Sign in/.test(b.textContent)).length`,
  );
  await js(`(() => { const g = document.querySelector('.mcp-group'); if (g) g.scrollIntoView({ block: 'start' }); })()`);
  await pause(400);
  await shot('environment-mcp');

  return {
    shots,
    accountRows,
    credentialFields,
    pickers,
    firstPickerOptions,
    expanderItems,
    mcpGroups,
    mcpSignInButtons,
    errors,
  };
}
