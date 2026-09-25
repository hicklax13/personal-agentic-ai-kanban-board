import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  AccountProvider,
  AgentTestResult,
  AppSettings,
  BoardState,
  DiscoveryReport,
  DispatchRequest,
  EndpointSettings,
  ProviderDefault,
  RunUpdate,
  SecretKey,
} from '@shared/types';
import { IPC, SECRET_KEYS } from '@shared/types';
import { createBoardStore } from './store/jsonStore.js';
import { makeCard } from './store/schema.js';
import { SecretStore, passthroughCipher, type Cipher } from './secrets/secretStore.js';
import { SettingsStore } from './settings.js';
import { refreshProviders, runDiscovery, type DiscoveryInput } from './discovery/index.js';
import { MCP_SIGN_IN_ARGS, MCP_SIGN_IN_TERMINAL } from './discovery/mcpAgents.js';
import { Dispatcher } from './dispatch/dispatcher.js';
import { run as runProcess } from './discovery/proc.js';
import {
  captureSettingsScreens,
  isSmokeTest,
  runSmokeTest,
  SMOKE_TEST_SWITCHES,
} from './smokeTest.js';
import { buildAgentEnv } from './agents/credentials.js';
import {
  getAccountStatuses,
  runBrowserSignIn,
  signIn as accountSignIn,
  signOut as accountSignOut,
} from './accounts.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * A separate data folder means a separate board, so it also gets its own
 * Electron profile. Electron's single-instance lock is keyed to the profile
 * folder, so without this a second board — or a test run — would collide with
 * an already-open window and quit immediately. Must run before `ready`.
 */
if (process.env.AGENT_KANBAN_DATA_DIR) {
  app.setPath('userData', join(process.env.AGENT_KANBAN_DATA_DIR, 'electron-profile'));
}

// Self-test captures must reflect the live DOM even when the window is covered.
if (isSmokeTest(process.argv)) {
  for (const [name, value] of SMOKE_TEST_SWITCHES) app.commandLine.appendSwitch(name, value);
}

/**
 * Where the app keeps its own data.
 *
 * When running unpackaged (`electron .` from a checkout) everything stays
 * inside the project folder, so a development install writes nothing outside
 * the directory it was started from. A packaged build uses the platform's
 * standard per-application location, which is what users expect from an
 * installed app. `AGENT_KANBAN_DATA_DIR` overrides both.
 *
 * Electron itself still writes its Chromium caches under the OS userData path;
 * that is the framework's own storage and is not something the app controls.
 */
const userData = process.env.AGENT_KANBAN_DATA_DIR
  ? process.env.AGENT_KANBAN_DATA_DIR
  : app.isPackaged
    ? app.getPath('userData')
    : join(app.getAppPath(), 'data');

const BOARD_PATH = join(userData, 'board.json');
const SECRETS_PATH = join(userData, 'secrets.enc.json');
const SETTINGS_PATH = join(userData, 'settings.json');

/**
 * Default working folder handed to agents when a card does not set its own.
 *
 * The home folder always exists. The previous default named this project's own
 * folder, which broke every agent the moment the project was moved or renamed.
 */
const DEFAULT_WORKSPACE = homedir();

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/**
 * Electron's safeStorage is backed by DPAPI on Windows and the login keychain
 * elsewhere. Wrapping it behind the Cipher interface keeps the store testable,
 * and falling through to `passthroughCipher` means a machine without a keyring
 * still works — loudly, with the UI showing that the file is not encrypted.
 */
const cipher: Cipher = {
  isAvailable: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (blob) => safeStorage.decryptString(blob),
};

const boardStore = createBoardStore(BOARD_PATH, DEFAULT_WORKSPACE);
const secretStore = new SecretStore(SECRETS_PATH, {
  isAvailable: () => cipher.isAvailable() || passthroughCipher.isAvailable(),
  encrypt: (p) => (cipher.isAvailable() ? cipher.encrypt(p) : passthroughCipher.encrypt(p)),
  decrypt: (b) => (cipher.isAvailable() ? cipher.decrypt(b) : passthroughCipher.decrypt(b)),
});
const settingsStore = new SettingsStore(SETTINGS_PATH);

let board: BoardState | null = null;
let discovery: DiscoveryReport | null = null;
let mainWindow: BrowserWindow | null = null;

async function getBoard(): Promise<BoardState> {
  if (!board) {
    let loaded = await boardStore.read();
    // A saved workspace goes stale when its folder is moved or deleted. Repair
    // it on load: otherwise every agent run fails before it starts, with a
    // misleading "not found" error that names the agent's program instead.
    if (loaded.workspaceRoot && !existsSync(loaded.workspaceRoot)) {
      console.warn(
        `[board] saved workspace "${loaded.workspaceRoot}" no longer exists; using ${DEFAULT_WORKSPACE}`,
      );
      loaded = { ...loaded, workspaceRoot: DEFAULT_WORKSPACE };
      await boardStore.write(loaded);
    }
    board = loaded;
  }
  return board;
}

function publish(update: RunUpdate): void {
  mainWindow?.webContents.send(IPC.runUpdate, update);
}

/**
 * Fold a run update into the board file.
 *
 * Runs arrive from a background process while the renderer may also be editing
 * the same card, so this merges into the main process's copy rather than
 * accepting a whole board from the renderer — last-writer-wins on the entire
 * board would silently drop the other side's edit.
 */
async function persistRunUpdate(update: RunUpdate): Promise<void> {
  const current = await getBoard();
  const cards = current.cards.map((card) => {
    if (card.id !== update.cardId) return card;
    const existing = card.runs.findIndex((r) => r.id === update.run.id);
    const runs =
      existing >= 0
        ? card.runs.map((r, i) => (i === existing ? update.run : r))
        : [...card.runs, update.run].slice(-25);
    return {
      ...card,
      runs,
      lastRunId: update.run.id,
      columnId: update.moveToColumnId ?? card.columnId,
      updatedAt: new Date().toISOString(),
    };
  });
  board = { ...current, cards, updatedAt: new Date().toISOString() };
  await boardStore.write(board);
}

const dispatcher = new Dispatcher({
  getBoard: () => board ?? { version: 1, boardTitle: '', workspaceRoot: null, columns: [], cards: [], chatSessions: [], updatedAt: '' },
  getAgent: (agentId) => discovery?.agents.find((a) => a.id === agentId) ?? null,
  endpoints: () => currentEndpoints,
  providerDefaults: () => currentProviderDefaults,
  secrets: { get: (key) => secretStore.get(key) },
  publish,
  persist: persistRunUpdate,
});

let currentEndpoints: EndpointSettings = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  lmStudioBaseUrl: 'http://127.0.0.1:1234',
};

/** Loaded at startup and kept current on every save, so dispatch never waits on disk. */
let currentProviderDefaults: Record<string, ProviderDefault> = {};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoveryInput(): Promise<DiscoveryInput> {
  currentEndpoints = await settingsStore.read();
  const current = await getBoard();
  return {
    endpoints: currentEndpoints,
    // Keys are read on demand inside the main process and used only as request
    // headers to each provider's own model list; they never reach the window.
    getSecret: (key) => secretStore.get(key),
    cwd: current.workspaceRoot ?? DEFAULT_WORKSPACE,
  };
}

async function refreshDiscovery(): Promise<DiscoveryReport> {
  discovery = await runDiscovery(await discoveryInput());
  return discovery;
}

/** Re-read model lists and effort levels only — seconds, not the minutes a full scan takes. */
async function refreshCatalog(): Promise<DiscoveryReport> {
  const report = await ensureDiscovery();
  discovery = await refreshProviders(report, await discoveryInput());
  return discovery;
}

/**
 * The current discovery report, starting a scan only if none has run yet.
 *
 * A scan takes a while (it health-checks every MCP server), so concurrent
 * callers share one in-flight scan instead of each starting their own.
 */
let discoveryInFlight: Promise<DiscoveryReport> | null = null;
function ensureDiscovery(): Promise<DiscoveryReport> {
  if (discovery) return Promise.resolve(discovery);
  discoveryInFlight ??= refreshDiscovery().finally(() => {
    discoveryInFlight = null;
  });
  return discoveryInFlight;
}

// ---------------------------------------------------------------------------
// Settings snapshot
// ---------------------------------------------------------------------------

async function settingsSnapshot(): Promise<AppSettings> {
  const endpoints = await settingsStore.read();
  const presence = await secretStore.presence();
  const plaintext = await secretStore.usedPlaintextFallback();
  const secretsPresent: Record<string, boolean> = {};
  for (const key of SECRET_KEYS) secretsPresent[key] = Boolean(presence[key]);
  return {
    endpoints,
    secretsPresent,
    encryptionAvailable: cipher.isAvailable() && !plaintext,
    secretsPath: SECRETS_PATH,
    boardPath: BOARD_PATH,
    providerDefaults: await settingsStore.readProviderDefaults(),
  };
}

// ---------------------------------------------------------------------------
// Agent connectivity test
// ---------------------------------------------------------------------------

/**
 * Prove an integration end-to-end with the smallest possible real request.
 *
 * A version probe only shows the binary exists; it says nothing about whether
 * the account behind it can actually run a turn. This performs a genuine
 * round-trip, which is the only way to surface an expired login or an exhausted
 * quota before the user commits a real task to it.
 */
async function testAgent(agentId: string): Promise<AgentTestResult> {
  const started = Date.now();
  const agent = discovery?.agents.find((a) => a.id === agentId);
  const fail = (detail: string): AgentTestResult => ({
    agentId,
    ok: false,
    detail,
    durationMs: Date.now() - started,
  });

  if (!agent) return fail('Agent not present in the discovery report.');
  if (agent.transport === 'none') return fail(agent.statusDetail);

  const PING = 'Reply with exactly the word: PONG';

  if (agent.id === 'ollama') {
    try {
      const res = await fetch(`${currentEndpoints.ollamaBaseUrl.replace(/\/+$/, '')}/api/tags`);
      if (!res.ok) return fail(`HTTP ${res.status} from /api/tags.`);
      const body = (await res.json()) as { models?: unknown[] };
      const count = Array.isArray(body.models) ? body.models.length : 0;
      return {
        agentId,
        ok: true,
        detail: `Reachable. ${count} model(s) pulled.`,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  if (agent.id === 'lmstudio') {
    try {
      const key = await secretStore.get('LM_STUDIO_API_KEY');
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      const res = await fetch(`${currentEndpoints.lmStudioBaseUrl.replace(/\/+$/, '')}/v1/models`, {
        headers,
      });
      if (res.status === 401 || res.status === 403) {
        return fail('Server is up but rejected the token. Set LM_STUDIO_API_KEY in Settings.');
      }
      if (!res.ok) return fail(`HTTP ${res.status} from /v1/models.`);
      return { agentId, ok: true, detail: 'Authenticated.', durationMs: Date.now() - started };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  if (!agent.binaryPath) return fail('No binary path resolved.');

  // Same environment a real run gets, so a passing test means a passing run.
  const env = await buildAgentEnv(agent.id, { get: (key) => secretStore.get(key) });

  if (agent.id === 'claude-code') {
    const res = await runProcess(
      agent.binaryPath,
      ['-p', PING, '--output-format', 'json', '--model', 'sonnet', '--permission-mode', 'bypassPermissions'],
      { timeoutMs: 180_000, env },
    );
    try {
      const parsed = JSON.parse(res.stdout.trim().split(/\r?\n/).pop() ?? '{}') as {
        is_error?: boolean;
        result?: string;
      };
      if (parsed.is_error) return fail(parsed.result ?? 'Claude Code reported an error.');
      return {
        agentId,
        ok: true,
        detail: (parsed.result ?? '').slice(0, 200) || 'Responded.',
        durationMs: Date.now() - started,
      };
    } catch {
      return fail(res.stderr.trim() || res.stdout.trim().slice(0, 300) || 'Unparseable response.');
    }
  }

  if (agent.id === 'codex') {
    const res = await runProcess(
      agent.binaryPath,
      ['exec', PING, '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral'],
      { timeoutMs: 180_000, env },
    );
    const text = `${res.stdout}\n${res.stderr}`;
    const errLine = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.includes('"type":"error"') || l.includes('"type":"turn.failed"'));
    if (errLine) {
      try {
        const parsed = JSON.parse(errLine) as { message?: string; error?: { message?: string } };
        return fail(parsed.message ?? parsed.error?.message ?? errLine);
      } catch {
        return fail(errLine);
      }
    }
    if (!res.ok) return fail(res.stderr.trim() || `Exit code ${res.code}.`);
    return { agentId, ok: true, detail: 'Turn completed.', durationMs: Date.now() - started };
  }

  if (agent.id === 'hermes') {
    const res = await runProcess(agent.binaryPath, ['-z', PING], { timeoutMs: 240_000, env });
    const out = res.stdout.trim();
    if (!out) return fail(res.stderr.trim() || 'Hermes produced no output.');
    return { agentId, ok: true, detail: out.slice(0, 200), durationMs: Date.now() - started };
  }

  return fail('No test routine is defined for this agent.');
}

// ---------------------------------------------------------------------------
// End-to-end dispatch check
// ---------------------------------------------------------------------------

/**
 * Drive a real card through the real dispatcher for each named agent.
 *
 * This deliberately reuses the production path — same adapter, same dispatcher,
 * same persistence — rather than a parallel test harness, because a harness
 * that bypasses the real code proves only that the harness works. The card is
 * added to the board first so the run has to survive the save/reload cycle too.
 *
 * Usage: electron . --dispatch-test=hermes,ollama
 */
async function runDispatchTest(agentIds: string[]): Promise<number> {
  await refreshDiscovery();
  const current = await getBoard();
  const columnId = current.columns[0].id;

  let failures = 0;

  for (const agentId of agentIds) {
    const card = makeCard({
      columnId,
      title: `Dispatch check — ${agentId}`,
      position: Date.now(),
      config: {
        agentId,
        // Overridable so the same harness can prove more than a reply — for
        // example that an agent can really write files. `{agent}` is replaced
        // with the agent id so each agent's output is distinguishable.
        taskPrompt: (process.env.DISPATCH_TEST_PROMPT || 'Reply with exactly the word: PONG')
          .split('{agent}')
          .join(agentId),
        model: DISPATCH_TEST_MODELS[agentId] ?? null,
        workingDirectory: process.env.DISPATCH_TEST_CWD || null,
      },
    });

    board = { ...(await getBoard()), cards: [...(await getBoard()).cards, card] };
    await boardStore.write(board);

    const started = Date.now();
    const result = await dispatcher.start(card, board.workspaceRoot);

    // Read the board back off disk: this is what proves the run was persisted,
    // not merely held in memory.
    const reloaded = await createBoardStore(BOARD_PATH, DEFAULT_WORKSPACE).read();
    const persisted = reloaded.cards.find((c) => c.id === card.id);
    const run = persisted?.runs[persisted.runs.length - 1];

    const line = {
      agent: agentId,
      ok: result.ok,
      durationMs: Date.now() - started,
      status: run?.status ?? 'missing',
      output: (run?.output ?? '').trim().slice(0, 200),
      error: run?.error ?? null,
      command: run?.command ?? null,
      persisted: Boolean(run),
      movedColumn: persisted ? persisted.columnId !== columnId : false,
    };
    console.log(`DISPATCH_TEST ${JSON.stringify(line)}`);
    if (!result.ok) failures++;
  }

  return failures;
}

/** Models used by the dispatch check, chosen from what discovery actually found. */
const DISPATCH_TEST_MODELS: Record<string, string> = {
  'claude-code': 'sonnet',
  ollama: 'qwen3:14b',
  // Any id will do here: the point is to reach the credential check, not to
  // name a model LM Studio has actually loaded.
  lmstudio: 'local-model',
};

function parseDispatchTestArg(argv: string[]): string[] | null {
  const flag = argv.find((a) => a.startsWith('--dispatch-test'));
  if (!flag) return null;
  const value = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : '';
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(IPC.boardLoad, async () => getBoard());

  ipcMain.handle(IPC.boardSave, async (_e, next: BoardState) => {
    try {
      // Preserve run history from the main process's copy: the renderer's board
      // can be a few hundred milliseconds stale while a run is streaming.
      const current = await getBoard();
      const runsById = new Map(current.cards.map((c) => [c.id, c.runs] as const));
      const merged: BoardState = {
        ...next,
        cards: next.cards.map((c) => {
          const authoritative = runsById.get(c.id);
          if (!authoritative || authoritative.length <= c.runs.length) return c;
          return { ...c, runs: authoritative };
        }),
      };
      board = merged;
      await boardStore.write(merged);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.boardReveal, async () => {
    shell.showItemInFolder(BOARD_PATH);
  });

  ipcMain.handle(IPC.discoveryGet, async () => ensureDiscovery());
  ipcMain.handle(IPC.discoveryRefresh, async () => refreshDiscovery());

  ipcMain.handle(IPC.settingsGet, async () => settingsSnapshot());

  ipcMain.handle(IPC.settingsSetEndpoints, async (_e, endpoints: EndpointSettings) => {
    currentEndpoints = await settingsStore.write(endpoints);
    return settingsSnapshot();
  });

  ipcMain.handle(IPC.settingsSetSecret, async (_e, key: SecretKey, value: string) => {
    if (!SECRET_KEYS.includes(key)) throw new Error(`Unknown secret key: ${key}`);
    await secretStore.set(key, value);
    return settingsSnapshot();
  });

  ipcMain.handle(IPC.settingsClearSecret, async (_e, key: SecretKey) => {
    if (!SECRET_KEYS.includes(key)) throw new Error(`Unknown secret key: ${key}`);
    await secretStore.clear(key);
    return settingsSnapshot();
  });

  ipcMain.handle(IPC.settingsTestAgent, async (_e, agentId: string) => testAgent(agentId));

  const ACCOUNT_PROVIDERS: AccountProvider[] = ['openai', 'anthropic'];
  const checkProvider = (provider: AccountProvider): void => {
    if (!ACCOUNT_PROVIDERS.includes(provider)) {
      throw new Error(`Unknown account provider: ${String(provider)}`);
    }
  };

  ipcMain.handle(IPC.accountsStatus, async () =>
    getAccountStatuses((await ensureDiscovery()).agents),
  );

  ipcMain.handle(IPC.accountsSignIn, async (_e, provider: AccountProvider) => {
    checkProvider(provider);
    return accountSignIn(provider, (await ensureDiscovery()).agents, (url) => {
      mainWindow?.webContents.send(IPC.accountsProgress, { provider, url });
    });
  });

  ipcMain.handle(IPC.accountsSignOut, async (_e, provider: AccountProvider) => {
    checkProvider(provider);
    return accountSignOut(provider, (await ensureDiscovery()).agents);
  });

  ipcMain.handle(IPC.catalogRefresh, async () => refreshCatalog());

  ipcMain.handle(
    IPC.settingsSetProviderDefault,
    async (_e, providerId: string, value: ProviderDefault) => {
      if (typeof providerId !== 'string' || !providerId) throw new Error('A provider id is required.');
      currentProviderDefaults = await settingsStore.setProviderDefault(providerId, value);
      return settingsSnapshot();
    },
  );

  /**
   * Start an MCP server's browser sign-in through the agent that owns it.
   *
   * The server must be one discovery actually found for that owner. The name is
   * passed as its own argv entry with no shell, but checking it against the
   * known list still keeps the window from asking a CLI to sign in to anything
   * this app did not show it.
   */
  ipcMain.handle(IPC.mcpSignIn, async (_e, owner: string, name: string) => {
    const report = await ensureDiscovery();
    const server = report.mcpServers.find((s) => s.owner === owner && s.name === name);
    if (!server) return { ok: false, detail: `No MCP server "${name}" is configured in ${owner}.` };
    if (server.signIn !== 'oauth') return { ok: false, detail: `${server.name} has no sign-in to run.` };
    const agent = report.agents.find((a) => a.id === owner);
    const args = MCP_SIGN_IN_ARGS[owner];
    if (!agent?.binaryPath || !args) return { ok: false, detail: `${server.ownerName} is not installed.` };
    return runBrowserSignIn(agent.binaryPath, args(name), (url) => {
      mainWindow?.webContents.send(IPC.mcpProgress, { owner, name, url });
    }, MCP_SIGN_IN_TERMINAL[owner](name));
  });

  ipcMain.handle(IPC.dispatchStart, async (_e, req: DispatchRequest) => {
    const current = await getBoard();
    // Dispatch from the main process's card, not the renderer's copy: it is the
    // one that has been through schema validation.
    const card = current.cards.find((c) => c.id === req.cardId) ?? req.card;
    return dispatcher.start(card, req.workspaceRoot ?? current.workspaceRoot);
  });

  ipcMain.handle(IPC.dispatchCancel, async (_e, cardId: string) => ({
    ok: dispatcher.cancel(cardId),
  }));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0f1115',
    show: false,
    title: 'Agent Kanban',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // A self-test drives a window nobody is looking at; keep it painting.
      backgroundThrottling: !isSmokeTest(process.argv),
      // The renderer runs web content and must never touch Node directly.
      // contextIsolation keeps the bridged API on a separate JS world, which is
      // the boundary that stops page script from reaching into the main process.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open external links in the real browser rather than inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// A second instance would fight the first over the board file; hand the
// activation to the window that already exists instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    registerIpc();
    await getBoard();
    currentEndpoints = await settingsStore.read();
    currentProviderDefaults = await settingsStore.readProviderDefaults();

    // The dispatch check runs headless: no window is needed, and creating one
    // would only add startup noise to the output being asserted on.
    const dispatchAgents = parseDispatchTestArg(process.argv);
    if (dispatchAgents) {
      const failures = await runDispatchTest(dispatchAgents);
      app.exit(failures === 0 ? 0 : 1);
      return;
    }

    createWindow();

    // Discovery probes subprocesses and remote MCP servers, which can take tens
    // of seconds. Running it after the window is up means the board is usable
    // immediately and the agent pickers fill in when the scan lands.
    void ensureDiscovery().catch((err: unknown) => {
      console.error('[discovery] failed:', err);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    if (isSmokeTest(process.argv) && mainWindow) {
      const result = await runSmokeTest(mainWindow, join(userData, 'smoke-test.png'));
      // Print machine-readable output so CI can assert on it without scraping.
      console.log(`SMOKE_TEST_RESULT ${JSON.stringify(result)}`);
      // Optional second pass: open Settings and photograph the Accounts and
      // Credentials tabs once the real sign-in status has loaded.
      if (result.ok && process.env.SMOKE_TEST_SETTINGS === '1') {
        const settings = await captureSettingsScreens(mainWindow, userData);
        console.log(`SMOKE_TEST_SETTINGS ${JSON.stringify(settings)}`);
      }
      app.exit(result.ok ? 0 : 1);
    }
  });

  app.on('window-all-closed', () => {
    dispatcher.cancelAll();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => dispatcher.cancelAll());
}
