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

export interface SettingsCapture {
  accounts: string | null;
  credentials: string | null;
  /** Text of each account row as rendered, e.g. "OpenAI (ChatGPT) · via Codex …". */
  accountRows: string[];
  credentialFields: number;
  errors: string[];
}

/**
 * Open Settings and photograph the Accounts and Credentials tabs.
 *
 * The Accounts tab shows real sign-in status read from each CLI, which needs the
 * environment scan to finish first, so this waits for the status rows to appear
 * rather than for a fixed time.
 */
export async function captureSettingsScreens(
  window: BrowserWindow,
  dir: string,
  timeoutMs = 240_000,
): Promise<SettingsCapture> {
  const errors: string[] = [];
  const js = (code: string): Promise<unknown> => window.webContents.executeJavaScript(code);
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const clickButton = (label: string): Promise<unknown> =>
    js(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.click(); return Boolean(b); })()`,
    );

  const shot = async (name: string): Promise<string | null> => {
    try {
      const image = await window.webContents.capturePage();
      const path = join(dir, name);
      await fs.writeFile(path, image.toPNG());
      return path;
    } catch (err) {
      errors.push(`Screenshot ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  if (!(await clickButton('Settings'))) errors.push('No Settings button found.');

  const started = Date.now();
  let accountRows: string[] = [];
  while (Date.now() - started < timeoutMs) {
    accountRows = (await js(
      `[...document.querySelectorAll('.modal .status-row .sr-main')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`,
    )) as string[];
    if (accountRows.length > 0) break;
    await pause(1000);
  }
  if (accountRows.length === 0) errors.push('Account status never appeared.');
  await pause(500);
  const accounts = await shot('smoke-test-accounts.png');

  if (!(await clickButton('Credentials'))) errors.push('No Credentials tab found.');
  await pause(800);
  const credentialFields = (await js(
    `document.querySelectorAll('.modal input[type="password"]').length`,
  )) as number;
  const credentials = await shot('smoke-test-credentials.png');

  return { accounts, credentials, accountRows, credentialFields, errors };
}
