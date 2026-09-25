/**
 * Shared contract between the Electron main process and the React renderer.
 *
 * Nothing here may import Node or DOM APIs: this file is bundled into BOTH
 * processes, so keeping it dependency-free is what lets one set of types
 * describe the IPC boundary without the two sides drifting apart.
 */

// ---------------------------------------------------------------------------
// Board model
// ---------------------------------------------------------------------------

/** Lifecycle of an agent run attached to a card. Drives the badge on the tile. */
export type RunStatus =
  | 'idle'
  | 'queued'
  | 'acknowledged'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

/**
 * A single execution of a card against an agent. Cards keep a bounded history
 * so you can compare "what did Claude say" with "what did Hermes say" without
 * the board file growing without limit.
 */
export interface AgentRun {
  id: string;
  cardId: string;
  agentId: string;
  providerId: string | null;
  model: string | null;
  status: RunStatus;
  /** Prompt actually sent, after config was rendered into it. */
  prompt: string;
  /** Accumulated assistant text, appended as the stream arrives. */
  output: string;
  /** Human-readable transcript of tool calls / events the agent emitted. */
  events: RunEvent[];
  error: string | null;
  exitCode: number | null;
  /** Native session id reported by the agent, for resuming a chat thread. */
  agentSessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Exact argv used, so a run is always reproducible from the UI. */
  command: string | null;
}

export interface RunEvent {
  at: string;
  kind: 'info' | 'tool' | 'stderr' | 'status' | 'error';
  text: string;
}

/**
 * Per-card agent configuration. Every field here is a deliberate scope
 * restriction: the card, not a global setting, decides what the agent may use.
 */
export interface CardAgentConfig {
  /** Id from the discovered agent list, e.g. 'claude-code'. */
  agentId: string | null;
  /** Provider id, e.g. 'anthropic' / 'ollama' / 'deepseek'. */
  providerId: string | null;
  /** Concrete model id, e.g. 'claude-sonnet-5' or 'qwen3.8:27b'. */
  model: string | null;
  /** Tool names the agent may use. Empty array means "agent default". */
  allowedTools: string[];
  /** MCP server ids to expose. Empty means "agent default". */
  allowedMcpServers: string[];
  /** Plugin ids to activate. Empty means "agent default". */
  allowedPlugins: string[];
  /** Skill ids to preload. Empty means "agent default". */
  allowedSkills: string[];
  /** Chat session this card's runs belong to. */
  chatSessionId: string | null;
  /** The instruction sent when the card is dispatched. */
  taskPrompt: string;
  /** Working directory for the agent. Defaults to the board's workspace. */
  workingDirectory: string | null;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  labels: string[];
  /** Ordering key inside the column; lower sorts first. */
  position: number;
  config: CardAgentConfig;
  /** Most recent run, denormalised for fast tile rendering. */
  lastRunId: string | null;
  runs: AgentRun[];
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  title: string;
  position: number;
  /** Optional cap; the UI warns past this but never blocks a move. */
  wipLimit: number | null;
  /** Colour accent, a CSS hex string. */
  accent: string;
}

/** A named conversation thread that cards can share. */
export interface ChatSession {
  id: string;
  name: string;
  agentId: string | null;
  /** Native session id from the agent, used to resume. */
  nativeSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardState {
  /** Schema version, so future changes can migrate an existing file. */
  version: number;
  boardTitle: string;
  /** Default cwd handed to agents when a card does not override it. */
  workspaceRoot: string | null;
  columns: Column[];
  cards: Card[];
  chatSessions: ChatSession[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Discovery model — what this machine actually has
// ---------------------------------------------------------------------------

/**
 * Availability is deliberately three-state. 'degraded' is the interesting one:
 * the integration is installed and the transport works, but a credential or
 * quota is missing. Collapsing that into 'unavailable' would hide the fact
 * that the only thing standing between the user and a working agent is a login.
 */
export type Availability = 'available' | 'degraded' | 'unavailable';

export interface DiscoveredAgent {
  id: string;
  name: string;
  /** How the app talks to it. */
  transport: 'cli-subprocess' | 'http-rest' | 'none';
  availability: Availability;
  /** Resolved absolute path to the binary, when transport is cli-subprocess. */
  binaryPath: string | null;
  /** Base URL, when transport is http-rest. */
  endpoint: string | null;
  version: string | null;
  /** Why it is degraded/unavailable, shown verbatim in the UI. */
  statusDetail: string;
  /** What must happen to move it to 'available'. */
  remediation: string | null;
  supportsStreaming: boolean;
  supportsToolScoping: boolean;
  supportsMcpScoping: boolean;
  supportsSkillScoping: boolean;
  supportsPluginScoping: boolean;
  supportsSessionResume: boolean;
  /** Provider ids this agent can route to. */
  providerIds: string[];
}

export interface DiscoveredProvider {
  id: string;
  name: string;
  /** Agent ids that can use this provider. */
  agentIds: string[];
  availability: Availability;
  statusDetail: string;
  models: DiscoveredModel[];
  /** True when the model list came from a live query rather than a catalog. */
  live: boolean;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  contextLength: number | null;
  capabilities: string[];
}

export interface DiscoveredMcpServer {
  id: string;
  name: string;
  /** stdio command or remote URL, exactly as configured. */
  target: string;
  kind: 'stdio' | 'http' | 'sse' | 'unknown';
  availability: Availability;
  statusDetail: string;
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  /** 'user' = ~/.claude/skills, 'plugin' = bundled with a plugin, etc. */
  source: string;
  path: string;
}

export interface DiscoveredPlugin {
  id: string;
  name: string;
  marketplace: string;
  enabled: boolean;
}

export interface DiscoveredTool {
  id: string;
  name: string;
  description: string;
  /** Agent ids that accept this tool name in their allow-list flag. */
  agentIds: string[];
}

export interface DiscoveryReport {
  scannedAt: string;
  platform: string;
  agents: DiscoveredAgent[];
  providers: DiscoveredProvider[];
  mcpServers: DiscoveredMcpServer[];
  skills: DiscoveredSkill[];
  plugins: DiscoveredPlugin[];
  tools: DiscoveredTool[];
  /** Non-fatal problems encountered while scanning. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Names of secrets the app knows how to store. Values never leave the main process. */
export type SecretKey =
  | 'ANTHROPIC_API_KEY'
  | 'OPENAI_API_KEY'
  | 'LM_STUDIO_API_KEY'
  | 'GOOGLE_API_KEY'
  | 'DEEPSEEK_API_KEY'
  | 'XAI_API_KEY'
  | 'DEEPINFRA_API_KEY'
  | 'COMMANDCODE_API_KEY'
  | 'XIAOMI_API_KEY'
  | 'OLLAMA_API_KEY';

export interface CredentialInfo {
  key: SecretKey;
  /** Provider name as shown in Settings. */
  label: string;
  /** Which agent receives the key, in plain words. */
  usedBy: string;
  help: string;
}

/**
 * Every credential the app stores, in display order.
 *
 * Each `key` doubles as the environment-variable name the receiving agent reads.
 * The Hermes names are taken from Hermes's own provider table
 * (`hermes_cli/auth.py`) — none are guessed. Google AI is stored as
 * `GOOGLE_API_KEY` because Hermes checks that name before `GEMINI_API_KEY`.
 */
export const CREDENTIALS: CredentialInfo[] = [
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI',
    usedBy: 'Hermes (openai-api provider)',
    help:
      'Codex uses your ChatGPT sign-in (Accounts tab) instead while you are signed in — a test ' +
      'key did not override it.',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    usedBy: 'Hermes (anthropic provider)',
    help:
      'Claude Code uses your Claude sign-in (Accounts tab) instead while you are signed in — a ' +
      'test key did not override it.',
  },
  {
    key: 'GOOGLE_API_KEY',
    label: 'Google AI (Gemini)',
    usedBy: 'Hermes (gemini provider)',
    help: 'Create one at Google AI Studio.',
  },
  {
    key: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek',
    usedBy: 'Hermes (deepseek provider)',
    help: 'From the DeepSeek platform console.',
  },
  {
    key: 'XAI_API_KEY',
    label: 'xAI (Grok)',
    usedBy: 'Hermes (xai provider)',
    help: 'From the xAI console.',
  },
  {
    key: 'DEEPINFRA_API_KEY',
    label: 'DeepInfra',
    usedBy: 'Hermes (deepinfra provider)',
    help: 'From your DeepInfra dashboard.',
  },
  {
    key: 'COMMANDCODE_API_KEY',
    label: 'Command Code',
    usedBy: 'Hermes (commandcode provider)',
    help: 'From your Command Code account.',
  },
  {
    key: 'XIAOMI_API_KEY',
    label: 'Xiaomi MiMo',
    usedBy: 'Hermes (xiaomi provider)',
    help: 'From the Xiaomi MiMo platform.',
  },
  {
    key: 'OLLAMA_API_KEY',
    label: 'Ollama Cloud',
    usedBy: 'Hermes (ollama-cloud provider)',
    help: 'From your ollama.com account. Not needed for the local Ollama app.',
  },
  {
    key: 'LM_STUDIO_API_KEY',
    label: 'LM Studio',
    usedBy: 'LM Studio (direct)',
    help: 'Required to use LM Studio. Find it in LM Studio under its developer server settings.',
  },
];

export const SECRET_KEYS: SecretKey[] = CREDENTIALS.map((c) => c.key);

// ---------------------------------------------------------------------------
// Accounts — sign-in handled by each agent's own CLI
// ---------------------------------------------------------------------------

export type AccountProvider = 'openai' | 'anthropic';

export interface AccountStatus {
  provider: AccountProvider;
  /** e.g. "OpenAI (ChatGPT)". */
  label: string;
  /** The CLI that owns the sign-in, e.g. "Codex". */
  via: string;
  /** False when that CLI is not installed. */
  available: boolean;
  signedIn: boolean;
  /** How it is signed in, e.g. "ChatGPT" or "Claude subscription (max)". */
  method: string | null;
  detail: string;
}

export interface AccountActionResult {
  ok: boolean;
  detail: string;
}

/** Pushed while a sign-in is waiting on the browser, so the UI can offer the link. */
export interface AccountSignInProgress {
  provider: AccountProvider;
  url: string;
}

export interface EndpointSettings {
  ollamaBaseUrl: string;
  lmStudioBaseUrl: string;
}

export interface AppSettings {
  endpoints: EndpointSettings;
  /** Which secret keys currently hold a value. Never the values themselves. */
  secretsPresent: Record<string, boolean>;
  /** True when the OS provided real encryption rather than a plaintext fallback. */
  encryptionAvailable: boolean;
  /** Absolute path of the encrypted secrets file, shown in the settings panel. */
  secretsPath: string;
  /** Absolute path of the board file. */
  boardPath: string;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

export const IPC = {
  boardLoad: 'board:load',
  boardSave: 'board:save',
  boardReveal: 'board:reveal',

  discoveryGet: 'discovery:get',
  discoveryRefresh: 'discovery:refresh',

  settingsGet: 'settings:get',
  settingsSetEndpoints: 'settings:setEndpoints',
  settingsSetSecret: 'settings:setSecret',
  settingsClearSecret: 'settings:clearSecret',
  settingsTestAgent: 'settings:testAgent',

  accountsStatus: 'accounts:status',
  accountsSignIn: 'accounts:signIn',
  accountsSignOut: 'accounts:signOut',
  /** main -> renderer: a sign-in page URL, in case the browser did not open. */
  accountsProgress: 'accounts:progress',

  dispatchStart: 'dispatch:start',
  dispatchCancel: 'dispatch:cancel',

  /** main -> renderer stream of run updates. */
  runUpdate: 'run:update',
} as const;

/** Payload pushed to the renderer as a run progresses. */
export interface RunUpdate {
  cardId: string;
  run: AgentRun;
  /** Set when the card's column should change as a result of this update. */
  moveToColumnId?: string;
}

export interface DispatchRequest {
  cardId: string;
  card: Card;
  workspaceRoot: string | null;
}

export interface AgentTestResult {
  agentId: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

/** The surface exposed on `window.api` by the preload script. */
export interface RendererApi {
  loadBoard(): Promise<BoardState>;
  saveBoard(state: BoardState): Promise<{ ok: boolean; error?: string }>;
  revealBoardFile(): Promise<void>;

  getDiscovery(): Promise<DiscoveryReport>;
  refreshDiscovery(): Promise<DiscoveryReport>;

  getSettings(): Promise<AppSettings>;
  setEndpoints(endpoints: EndpointSettings): Promise<AppSettings>;
  setSecret(key: SecretKey, value: string): Promise<AppSettings>;
  clearSecret(key: SecretKey): Promise<AppSettings>;
  testAgent(agentId: string): Promise<AgentTestResult>;

  getAccounts(): Promise<AccountStatus[]>;
  signIn(provider: AccountProvider): Promise<AccountActionResult>;
  signOut(provider: AccountProvider): Promise<AccountActionResult>;
  onSignInProgress(cb: (p: AccountSignInProgress) => void): () => void;

  startDispatch(req: DispatchRequest): Promise<{ ok: boolean; runId?: string; error?: string }>;
  cancelDispatch(cardId: string): Promise<{ ok: boolean }>;

  onRunUpdate(cb: (u: RunUpdate) => void): () => void;
}
