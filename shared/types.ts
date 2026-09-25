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
  /** Effort actually used, after defaults were applied. Absent on older runs. */
  effort?: string | null;
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
  /** 'worker' does the task; 'judge' checks it in Goal mode. Absent on older runs. */
  role?: RunRole;
  /** Goal-mode round this run belongs to, counting from 1. */
  round?: number;
  /** The judge's decision, on judge runs only. */
  verdict?: JudgeVerdict | null;
}

export type RunRole = 'worker' | 'judge';

/**
 * A judge's decision in Goal mode. Mirrors Hermes's goal judge: `continue`
 * sends the reason back to the worker, `blocked` means the task cannot be
 * finished as written and needs a person.
 */
export interface JudgeVerdict {
  verdict: 'done' | 'continue' | 'blocked';
  reason: string;
}

/** Progress of a Goal-mode loop, shown on the card. */
export interface GoalState {
  status: 'running' | 'done' | 'blocked' | 'stopped';
  /** Round in progress or last finished, counting from 1. */
  round: number;
  maxRounds: number;
  /** The judge's latest reason, or why the loop stopped. */
  reason: string | null;
  updatedAt: string;
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
  /** Reasoning effort, e.g. 'high'. Null means "use the provider default". */
  effort: string | null;
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
  /**
   * Where the agent works: the board's folder, a folder of the card's own
   * (`workingDirectory`), or a git worktree made from that folder's repository.
   */
  workspaceMode: WorkspaceMode;
  /** The folder for 'dir' mode, and the repository to branch from in 'worktree' mode. */
  workingDirectory: string | null;
}

export type WorkspaceMode = 'board' | 'dir' | 'worktree';

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
  /** A card that must reach DONE before this one may run. */
  parentId: string | null;
  /** When to start by itself (ISO time). Null means not scheduled. */
  scheduledAt: string | null;
  /** Run in a loop until the judge (Settings → Judge) agrees the task is done. */
  goalMode: boolean;
  /** Goal-loop progress; written by the main process only. */
  goal: GoalState | null;
  /** The git worktree made for this card, reused by its later runs. */
  worktreePath: string | null;
  /** Why the card is in BLOCKED, when the app put it there. */
  blockedReason: string | null;
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
  /** Effort levels the running agent accepts for this provider. Empty = not adjustable. */
  efforts: string[];
  /** What the effort setting is called for this provider, e.g. "Reasoning effort". */
  effortLabel: string;
  /** Caveat shown under the effort picker, if any. */
  effortNote?: string | null;
  /** Why the live model list could not be read, when it could not. */
  modelsError?: string | null;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  contextLength: number | null;
  capabilities: string[];
  /** Effort levels this specific model accepts, when the source says (Codex does). */
  efforts?: string[];
  /** The model's own default effort, when the source says. */
  defaultEffort?: string | null;
}

export interface DiscoveredMcpServer {
  id: string;
  name: string;
  /** stdio command or remote URL, exactly as configured. */
  target: string;
  kind: 'stdio' | 'http' | 'sse' | 'unknown';
  availability: Availability;
  statusDetail: string;
  /** Agent whose configuration holds this server: 'claude-code', 'codex' or 'hermes'. */
  owner: string;
  ownerName: string;
  /** 'oauth' when the owning agent can run a browser sign-in for it. */
  signIn: 'oauth' | 'none';
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
  /** The provider id whose models and default this key unlocks. */
  providerId: string;
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
    providerId: 'hermes:openai-api',
    help:
      'Codex uses your ChatGPT sign-in (Accounts tab) instead while you are signed in — a test ' +
      'key did not override it.',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    usedBy: 'Hermes (anthropic provider)',
    providerId: 'hermes:anthropic',
    help:
      'Claude Code uses your Claude sign-in (Accounts tab) instead while you are signed in — a ' +
      'test key did not override it.',
  },
  {
    key: 'GOOGLE_API_KEY',
    label: 'Google AI (Gemini)',
    usedBy: 'Hermes (gemini provider)',
    providerId: 'hermes:gemini',
    help: 'Create one at Google AI Studio.',
  },
  {
    key: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek',
    usedBy: 'Hermes (deepseek provider)',
    providerId: 'hermes:deepseek',
    help: 'From the DeepSeek platform console.',
  },
  {
    key: 'XAI_API_KEY',
    label: 'xAI (Grok)',
    usedBy: 'Hermes (xai provider)',
    providerId: 'hermes:xai',
    help: 'From the xAI console.',
  },
  {
    key: 'DEEPINFRA_API_KEY',
    label: 'DeepInfra',
    usedBy: 'Hermes (deepinfra provider)',
    providerId: 'hermes:deepinfra',
    help: 'From your DeepInfra dashboard.',
  },
  {
    key: 'COMMANDCODE_API_KEY',
    label: 'Command Code',
    usedBy: 'Hermes (commandcode provider)',
    providerId: 'hermes:commandcode',
    help: 'From your Command Code account.',
  },
  {
    key: 'XIAOMI_API_KEY',
    label: 'Xiaomi MiMo',
    usedBy: 'Hermes (xiaomi provider)',
    providerId: 'hermes:xiaomi',
    help: 'From the Xiaomi MiMo platform.',
  },
  {
    key: 'OLLAMA_API_KEY',
    label: 'Ollama Cloud',
    usedBy: 'Hermes (ollama-cloud provider)',
    providerId: 'hermes:ollama-cloud',
    help: 'From your ollama.com account. Not needed for the local Ollama app.',
  },
  {
    key: 'LM_STUDIO_API_KEY',
    label: 'LM Studio',
    usedBy: 'LM Studio (direct)',
    providerId: 'lmstudio',
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

export interface McpSignInProgress {
  owner: string;
  name: string;
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
  /** Default model and effort per provider id, used when a card leaves them blank. */
  providerDefaults: Record<string, ProviderDefault>;
  /** Who checks Goal-mode cards, and with what. */
  judge: JudgeSettings;
}

/**
 * The agent that decides whether a Goal-mode card is done. It runs in the same
 * folder as the worker, so the tools, MCP servers, plugins and skills chosen
 * here are what it can use to inspect the result.
 */
export interface JudgeSettings {
  agentId: string | null;
  providerId: string | null;
  model: string | null;
  effort: string | null;
  allowedTools: string[];
  allowedMcpServers: string[];
  allowedPlugins: string[];
  allowedSkills: string[];
  /** Worker rounds before an unfinished goal is handed to a person. */
  maxRounds: number;
}

/**
 * The model and effort a provider uses when a card does not choose its own.
 * `provider` is only used by the Hermes entry, where it picks which of Hermes's
 * providers a card with no provider of its own should use.
 */
export interface ProviderDefault {
  model: string | null;
  effort: string | null;
  provider?: string | null;
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

  catalogRefresh: 'catalog:refresh',
  settingsSetProviderDefault: 'settings:setProviderDefault',

  mcpSignIn: 'mcp:signIn',
  /** main -> renderer: an MCP sign-in page URL, in case the browser did not open. */
  mcpProgress: 'mcp:progress',

  dispatchStart: 'dispatch:start',
  dispatchCancel: 'dispatch:cancel',

  settingsSetJudge: 'settings:setJudge',
  pickFolder: 'dialog:pickFolder',
  gitRepoInfo: 'git:repoInfo',
  brandGet: 'brand:get',

  /** main -> renderer stream of run updates. */
  runUpdate: 'run:update',
  /** main -> renderer: the workflow moved or changed a card (schedule, parent, goal). */
  cardPatch: 'board:cardPatch',
} as const;

/** Fields the main process changes on its own; everything else is the window's. */
export type CardWorkflowPatch = Partial<
  Pick<Card, 'columnId' | 'goal' | 'worktreePath' | 'blockedReason' | 'scheduledAt'>
>;

/**
 * A workflow change pushed to the window. `seq` increases with every change;
 * the window sends back the highest one it has applied with each save, so the
 * main process can tell a save that simply had not seen a change yet from one
 * where the user deliberately changed the card afterwards.
 */
export interface CardPatchUpdate {
  cardId: string;
  patch: CardWorkflowPatch;
  seq: number;
}

export interface LoadedBoard {
  board: BoardState;
  /** The latest workflow change already included in `board`. */
  patchSeq: number;
}

export interface DispatchResult {
  ok: boolean;
  runId?: string;
  error?: string;
  /** True when the card was parked to start later rather than run now. */
  queued?: boolean;
  /** Plain-language note for the user, e.g. why it was queued. */
  info?: string;
}

export interface GitRepoInfo {
  ok: boolean;
  /** Top folder of the repository, when `path` is inside one. */
  root?: string;
  error?: string;
}

/**
 * The owner's private brand assets, read from the git-ignored `data/brand/`
 * folder. They never live in the repository: the crest carries a family name.
 */
export interface BrandAssets {
  /** The crest as a data: URL, or null when none is installed (the app shows a plain shield). */
  crest: string | null;
}

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
  loadBoard(): Promise<LoadedBoard>;
  /** `seenPatchSeq`: the highest workflow change this window has applied. */
  saveBoard(state: BoardState, seenPatchSeq: number): Promise<{ ok: boolean; error?: string }>;
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

  /** Re-read every provider's model list without redoing the whole scan. */
  refreshCatalog(): Promise<DiscoveryReport>;
  setProviderDefault(providerId: string, value: ProviderDefault): Promise<AppSettings>;

  mcpSignIn(owner: string, name: string): Promise<AccountActionResult>;
  onMcpSignInProgress(cb: (p: McpSignInProgress) => void): () => void;

  startDispatch(req: DispatchRequest): Promise<DispatchResult>;
  cancelDispatch(cardId: string): Promise<{ ok: boolean }>;

  setJudge(judge: JudgeSettings): Promise<AppSettings>;
  /** Native folder picker; null when cancelled. */
  pickFolder(defaultPath?: string | null): Promise<string | null>;
  gitRepoInfo(path: string): Promise<GitRepoInfo>;
  getBrand(): Promise<BrandAssets>;

  onRunUpdate(cb: (u: RunUpdate) => void): () => void;
  onCardPatch(cb: (u: CardPatchUpdate) => void): () => void;
}
