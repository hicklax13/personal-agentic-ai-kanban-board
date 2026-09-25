/**
 * A stand-in for the Electron bridge (`window.api`) so the renderer runs in an
 * ordinary browser for design work and UI tests.
 *
 * Development only: it is loaded by `preview.html`, which the production build
 * never includes. Every name, task and number in here is sample data.
 */
import type {
  AccountStatus,
  AgentRun,
  AppSettings,
  BoardState,
  BrandAssets,
  CardPatchUpdate,
  Column,
  DiscoveredAgent,
  DiscoveredModel,
  DiscoveredProvider,
  DiscoveryReport,
  RendererApi,
  RunUpdate,
} from '@shared/types';
import { addCard, applyCardPatch, upsertRun } from '@shared/boardOps';
import { FLOW_COLUMNS, flowColumn } from '@shared/flow';

const now = Date.now();
const iso = (offsetMin: number): string => new Date(now + offsetMin * 60_000).toISOString();

// ---------------------------------------------------------------- discovery

const agent = (a: Partial<DiscoveredAgent> & Pick<DiscoveredAgent, 'id' | 'name'>): DiscoveredAgent => ({
  transport: 'cli-subprocess',
  availability: 'available',
  binaryPath: `C:\\Tools\\${a.id}.exe`,
  endpoint: null,
  version: '1.0.0',
  statusDetail: 'Ready.',
  remediation: null,
  supportsStreaming: true,
  supportsToolScoping: true,
  supportsMcpScoping: true,
  supportsSkillScoping: true,
  supportsPluginScoping: true,
  supportsSessionResume: true,
  providerIds: [],
  ...a,
});

const models = (ids: string[], extra: Partial<DiscoveredModel> = {}): DiscoveredModel[] =>
  ids.map((id) => ({ id, name: id, contextLength: null, capabilities: [], ...extra }));

const provider = (p: Partial<DiscoveredProvider> & Pick<DiscoveredProvider, 'id' | 'name'>): DiscoveredProvider => ({
  agentIds: [],
  availability: 'available',
  statusDetail: 'Ready.',
  models: [],
  live: true,
  efforts: [],
  effortLabel: 'Effort',
  ...p,
});

const HERMES_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const discovery: DiscoveryReport = {
  scannedAt: iso(-3),
  platform: 'win32 x64',
  agents: [
    agent({ id: 'claude-code', name: 'Claude Code', version: '2.1.240', statusDetail: 'Signed in with a Claude subscription.', providerIds: ['anthropic'] }),
    agent({ id: 'codex', name: 'OpenAI Codex', version: '0.155.0', statusDetail: 'Signed in with ChatGPT.', supportsToolScoping: false, supportsMcpScoping: false, supportsSkillScoping: false, supportsPluginScoping: false, providerIds: ['openai'] }),
    agent({ id: 'hermes', name: 'Hermes Agent', version: '0.20.6', statusDetail: 'Ready. Uses its own configuration.', supportsPluginScoping: false, providerIds: ['hermes:deepseek', 'hermes:gemini', 'hermes:xai', 'hermes:openai-api', 'hermes:anthropic', 'hermes:openrouter'] }),
    agent({ id: 'ollama', name: 'Ollama (direct)', transport: 'http-rest', binaryPath: null, endpoint: 'http://127.0.0.1:11434', version: '0.34.1', statusDetail: '3 models pulled.', supportsToolScoping: false, supportsMcpScoping: false, supportsSkillScoping: false, supportsPluginScoping: false, supportsSessionResume: false, providerIds: ['ollama'] }),
    agent({ id: 'lmstudio', name: 'LM Studio (direct)', transport: 'http-rest', binaryPath: null, endpoint: 'http://127.0.0.1:1234', availability: 'degraded', version: null, statusDetail: 'The server is up but rejected the token.', remediation: 'Add the LM Studio key in Settings → Credentials.', supportsToolScoping: false, supportsMcpScoping: false, supportsSkillScoping: false, supportsPluginScoping: false, supportsSessionResume: false, providerIds: ['lmstudio'] }),
  ],
  providers: [
    provider({ id: 'anthropic', name: 'Anthropic (Claude Code)', agentIds: ['claude-code'], models: models(['opus', 'sonnet', 'haiku', 'fable', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5']), efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }),
    provider({ id: 'openai', name: 'OpenAI (Codex · ChatGPT sign-in)', agentIds: ['codex'], effortLabel: 'Reasoning effort', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', contextLength: 272_000, capabilities: [], efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
      { id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex', contextLength: 272_000, capabilities: [], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', contextLength: 128_000, capabilities: [], efforts: ['low', 'medium', 'high'], defaultEffort: 'low' },
    ] }),
    provider({ id: 'hermes:deepseek', name: 'DeepSeek (via Hermes)', agentIds: ['hermes'], models: models(['deepseek-chat', 'deepseek-reasoner']), efforts: HERMES_EFFORTS, effortLabel: 'Reasoning effort' }),
    provider({ id: 'hermes:gemini', name: 'Google AI (Gemini) (via Hermes)', agentIds: ['hermes'], models: models(['gemini-3-pro', 'gemini-3-flash', 'gemini-3-flash-lite']), efforts: HERMES_EFFORTS, effortLabel: 'Reasoning effort' }),
    provider({ id: 'hermes:xai', name: 'xAI (Grok) (via Hermes)', agentIds: ['hermes'], models: models(['grok-5', 'grok-5-mini']), efforts: HERMES_EFFORTS, effortLabel: 'Reasoning effort' }),
    provider({ id: 'hermes:openai-api', name: 'OpenAI API (via Hermes)', agentIds: ['hermes'], models: models(['gpt-5.4', 'gpt-5.4-mini', 'o5']), efforts: HERMES_EFFORTS, effortLabel: 'Reasoning effort' }),
    provider({ id: 'hermes:anthropic', name: 'Anthropic API (via Hermes)', agentIds: ['hermes'], models: models(['claude-opus-5-5', 'claude-sonnet-5']), efforts: HERMES_EFFORTS, effortLabel: 'Reasoning effort' }),
    provider({ id: 'hermes:openrouter', name: 'openrouter (via Hermes)', agentIds: ['hermes'], live: false, models: models(['meta/llama-5-70b']), efforts: HERMES_EFFORTS, effortLabel: 'Reasoning effort' }),
    provider({ id: 'ollama', name: 'Ollama (local)', agentIds: ['ollama'], models: models(['qwen3:14b', 'gemma3:12b', 'llama4:8b'], { efforts: ['off', 'on'] }), efforts: ['off', 'on'], effortNote: 'Only models that support thinking use this.' }),
    provider({ id: 'lmstudio', name: 'LM Studio (local)', agentIds: ['lmstudio'], models: [], modelsError: 'The saved key was rejected (HTTP 401).', effortNote: 'LM Studio has no effort setting this app can pass.' }),
  ],
  mcpServers: [
    { id: 'claude:github', name: 'github', target: 'https://api.githubcopilot.com/mcp', kind: 'http', availability: 'available', statusDetail: 'Connected', owner: 'claude-code', ownerName: 'Claude Code', signIn: 'oauth' },
    { id: 'claude:figma', name: 'figma', target: 'https://mcp.figma.com/mcp', kind: 'http', availability: 'degraded', statusDetail: 'Needs sign-in', owner: 'claude-code', ownerName: 'Claude Code', signIn: 'oauth' },
    { id: 'claude:playwright', name: 'playwright', target: 'npx @playwright/mcp', kind: 'stdio', availability: 'available', statusDetail: 'Connected', owner: 'claude-code', ownerName: 'Claude Code', signIn: 'none' },
    { id: 'claude:filesystem', name: 'filesystem', target: 'npx @modelcontextprotocol/server-filesystem', kind: 'stdio', availability: 'available', statusDetail: 'Connected', owner: 'claude-code', ownerName: 'Claude Code', signIn: 'none' },
    { id: 'codex:docs', name: 'openaiDeveloperDocs', target: 'https://developers.openai.com/mcp', kind: 'http', availability: 'available', statusDetail: 'Connected', owner: 'codex', ownerName: 'Codex', signIn: 'none' },
    { id: 'hermes:browserless', name: 'browserless', target: 'https://mcp.browserless.io/mcp', kind: 'http', availability: 'available', statusDetail: 'Configured', owner: 'hermes', ownerName: 'Hermes', signIn: 'none' },
    { id: 'hermes:cloudflare', name: 'cloudflare', target: 'https://mcp.cloudflare.com/mcp', kind: 'http', availability: 'degraded', statusDetail: 'Sign-in expired', owner: 'hermes', ownerName: 'Hermes', signIn: 'oauth' },
  ],
  skills: [
    ['frontend-design', 'Distinctive, production-grade interfaces.'],
    ['test-driven-development', 'Write the failing test first.'],
    ['systematic-debugging', 'Find the root cause before fixing.'],
    ['code-review', 'Review changes for bugs and clarity.'],
    ['release-notes', 'Summarize merged work for a changelog.'],
    ['accessibility-review', 'Audit against WCAG 2.2.'],
    ['api-docs', 'Generate reference documentation from code.'],
    ['sql-explainer', 'Explain and tune slow queries.'],
  ].map(([name, description]) => ({ id: `skill:${name}`, name, description, source: 'user', path: `~/.claude/skills/${name}` })),
  plugins: [
    { id: 'superpowers@official', name: 'superpowers', marketplace: 'claude-plugins-official', enabled: true },
    { id: 'figma@official', name: 'figma', marketplace: 'claude-plugins-official', enabled: true },
    { id: 'vercel@official', name: 'vercel', marketplace: 'claude-plugins-official', enabled: true },
    { id: 'playwright@official', name: 'playwright', marketplace: 'claude-plugins-official', enabled: false },
  ],
  tools: [
    ...['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch'].map((name) => ({ id: `claude:${name}`, name, description: `Claude Code's ${name} tool.`, agentIds: ['claude-code'] })),
    ...['web', 'terminal', 'file', 'browser'].map((name) => ({ id: `hermes:${name}`, name, description: `Hermes toolset: ${name}.`, agentIds: ['hermes'] })),
  ],
  warnings: [],
};

// ---------------------------------------------------------------- settings

let settings: AppSettings = {
  endpoints: { ollamaBaseUrl: 'http://127.0.0.1:11434', lmStudioBaseUrl: 'http://127.0.0.1:1234' },
  secretsPresent: {
    OPENAI_API_KEY: true, ANTHROPIC_API_KEY: true, GOOGLE_API_KEY: true, DEEPSEEK_API_KEY: true, XAI_API_KEY: true,
    DEEPINFRA_API_KEY: false, COMMANDCODE_API_KEY: false, XIAOMI_API_KEY: false, OLLAMA_API_KEY: true, LM_STUDIO_API_KEY: false,
  },
  encryptionAvailable: true,
  secretsPath: 'C:\\Projects\\agent-kanban\\data\\secrets.enc.json',
  boardPath: 'C:\\Projects\\agent-kanban\\data\\board.json',
  providerDefaults: { anthropic: { model: 'sonnet', effort: 'high' }, openai: { model: 'gpt-5.4', effort: 'medium' } },
  judge: {
    agentId: 'claude-code', providerId: 'anthropic', model: 'haiku', effort: 'medium',
    allowedTools: ['Read', 'Grep', 'Bash'], allowedMcpServers: [], allowedPlugins: [], allowedSkills: [], maxRounds: 5,
  },
};

const accounts: AccountStatus[] = [
  { provider: 'openai', label: 'OpenAI (ChatGPT)', via: 'Codex', available: true, signedIn: true, method: 'ChatGPT', detail: 'Signed in.' },
  { provider: 'anthropic', label: 'Anthropic (Claude)', via: 'Claude Code', available: true, signedIn: true, method: 'Claude subscription (max)', detail: 'Signed in.' },
];

// ---------------------------------------------------------------- board

const columns: Column[] = FLOW_COLUMNS.map((c, i) => ({ id: `col-${c.key}`, title: c.title, position: i, wipLimit: null, accent: c.accent }));
const col = (key: string): string => `col-${key}`;

function run(cardId: string, r: Partial<AgentRun>): AgentRun {
  return {
    id: `run-${cardId}-${r.startedAt ?? '0'}`,
    cardId,
    agentId: 'claude-code',
    providerId: null,
    model: null,
    status: 'succeeded',
    prompt: '',
    output: '',
    events: [],
    error: null,
    exitCode: 0,
    agentSessionId: null,
    startedAt: iso(-60),
    endedAt: iso(-50),
    command: null,
    ...r,
  };
}

function buildBoard(): BoardState {
  let b: BoardState = {
    version: 2,
    boardTitle: 'Agent Board',
    workspaceRoot: 'C:\\Projects\\agent-kanban',
    columns,
    cards: [],
    chatSessions: [],
    updatedAt: iso(0),
  };
  const add = (id: string, key: string, f: Parameters<typeof addCard>[2]): void => {
    b = addCard(b, col(key), { id, ...f });
  };
  add('idea', 'triage', { title: 'Idea: dark mode for the board', description: 'Rough idea. Check whether a light theme is worth it at all.' });
  add('csv', 'triage', { title: 'Research a faster CSV import', config: { agentId: 'hermes', providerId: 'hermes:deepseek', model: 'deepseek-chat' } });
  add('migration', 'todo', { title: 'Write the v2 board-file migration', parentId: 'oauth', config: { agentId: 'codex', providerId: 'openai', model: 'gpt-5.4', effort: 'high' } });
  add('settings', 'todo', { title: 'Refactor the settings store', config: { agentId: 'claude-code', providerId: 'anthropic', model: 'sonnet', effort: 'medium' } });
  add('readme', 'todo', { title: 'Update README screenshots', priority: 'low', config: { agentId: 'lmstudio', providerId: 'lmstudio', model: 'qwen3-coder' } });
  add('audit', 'scheduled', { title: 'Nightly dependency audit', scheduledAt: iso(372), config: { agentId: 'claude-code', providerId: 'anthropic', model: 'haiku', effort: 'low' } });
  add('flaky', 'ready', { title: 'Fix the flaky login test', priority: 'urgent', config: { agentId: 'claude-code', providerId: 'anthropic', model: 'opus', effort: 'high' } });
  add('oauth', 'running', { title: 'Add OAuth sign-in to the Codex adapter', priority: 'high', config: { agentId: 'codex', providerId: 'openai', model: 'gpt-5.4', effort: 'high', workspaceMode: 'worktree' } });
  add('apidocs', 'running', { title: 'Generate API reference docs', goalMode: true, config: { agentId: 'hermes', providerId: 'hermes:deepseek', model: 'deepseek-reasoner' } });
  add('issues', 'running', { title: 'Summarize open issues', priority: 'low', config: { agentId: 'ollama', providerId: 'ollama', model: 'qwen3:14b', effort: 'on' } });
  add('deploy', 'blocked', { title: 'Deploy the preview build', config: { agentId: 'claude-code', providerId: 'anthropic', model: 'sonnet', effort: 'medium' } });
  add('merge', 'review', { title: 'Tighten board-save merging', config: { agentId: 'claude-code', providerId: 'anthropic', model: 'opus', effort: 'high' } });
  add('translate', 'review', { title: 'Translate onboarding copy', config: { agentId: 'hermes', providerId: 'hermes:gemini', model: 'gemini-3-pro' } });
  add('clock', 'done', { title: 'Departure clock for schedules', config: { agentId: 'codex', providerId: 'openai' } });
  add('queue', 'done', { title: 'Queue board writes', config: { agentId: 'claude-code', providerId: 'anthropic' } });
  add('fonts', 'done', { title: 'Bundle local fonts', config: { agentId: 'ollama', providerId: 'ollama' } });

  b = upsertRun(b, run('oauth', { agentId: 'codex', model: 'gpt-5.4', effort: 'high', status: 'running', startedAt: iso(-12.7), endedAt: null, output: 'Reading src/main/accounts.ts…\nAdding a PKCE sign-in flow for Codex.\nediting src/main/accounts.ts', role: 'worker' }));
  b = upsertRun(b, run('apidocs', { agentId: 'hermes', model: 'deepseek-reasoner', status: 'running', startedAt: iso(-31), endedAt: null, round: 2, role: 'worker', output: 'Round 2: writing the Settings and Judge sections.' }));
  b = applyCardPatch(b, 'apidocs', { goal: { status: 'running', round: 2, maxRounds: 5, reason: 'Two sections are still missing: Settings and Judge.', updatedAt: iso(-8) } });
  b = upsertRun(b, run('issues', { agentId: 'ollama', model: 'qwen3:14b', status: 'running', startedAt: iso(-3.2), endedAt: null, output: 'reading 48 issues' }));
  b = upsertRun(b, run('deploy', { status: 'failed', error: 'npm error Missing script: "preview"', output: '' }));
  b = applyCardPatch(b, 'deploy', { blockedReason: 'Run failed: the "preview" script does not exist.' });
  b = upsertRun(b, run('merge', { model: 'opus', status: 'succeeded', startedAt: iso(-40), endedAt: iso(-12), output: 'Merged window saves field by field.\n4 files changed, all tests pass.' }));
  b = upsertRun(b, run('translate', { agentId: 'hermes', status: 'succeeded', startedAt: iso(-90), endedAt: iso(-60), output: 'Translated 42 strings into Spanish and German.' }));
  b = applyCardPatch(b, 'clock', { goal: { status: 'done', round: 1, maxRounds: 5, reason: 'The clock renders and counts down correctly.', updatedAt: iso(-180) } });
  return b;
}

// ---------------------------------------------------------------- the api

type Listener<T> = (u: T) => void;

export function createMockApi(crest: string | null): RendererApi {
  let board = buildBoard();
  let seq = 0;
  const runListeners = new Set<Listener<RunUpdate>>();
  const patchListeners = new Set<Listener<CardPatchUpdate>>();
  const listen = <T,>(set: Set<Listener<T>>, cb: Listener<T>): (() => void) => {
    set.add(cb);
    return () => set.delete(cb);
  };
  const patch = (cardId: string, p: CardPatchUpdate['patch']): void => {
    board = applyCardPatch(board, cardId, p);
    const update = { cardId, patch: p, seq: ++seq };
    patchListeners.forEach((l) => l(update));
  };
  const delay = <T,>(value: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms));

  /** A pretend run: streams a few lines, then lands in REVIEW. */
  function simulate(cardId: string): void {
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return;
    const running = flowColumn(board.columns, 'running');
    const review = flowColumn(board.columns, 'review');
    if (running) patch(cardId, { columnId: running.id, blockedReason: null });
    const r: AgentRun = run(cardId, { id: `run-${cardId}-${Date.now()}`, agentId: card.config.agentId ?? 'claude-code', model: card.config.model, status: 'running', startedAt: new Date().toISOString(), endedAt: null, output: '' });
    const lines = ['Reading the task…\n', 'Planning the change.\n', 'Editing files…\n', 'Running the tests.\n', 'All tests pass.\n'];
    let i = 0;
    const tick = setInterval(() => {
      if (i < lines.length) {
        r.output += lines[i++];
        runListeners.forEach((l) => l({ cardId, run: { ...r } }));
        return;
      }
      clearInterval(tick);
      r.status = 'succeeded';
      r.endedAt = new Date().toISOString();
      board = upsertRun(board, r);
      runListeners.forEach((l) => l({ cardId, run: { ...r } }));
      if (review) patch(cardId, { columnId: review.id });
    }, 700);
    board = upsertRun(board, r);
    runListeners.forEach((l) => l({ cardId, run: { ...r } }));
  }

  return {
    loadBoard: () => delay({ board, patchSeq: seq }),
    saveBoard: async (state) => {
      board = state;
      return { ok: true };
    },
    revealBoardFile: async () => undefined,
    getDiscovery: () => delay(discovery, 400),
    refreshDiscovery: () => delay({ ...discovery, scannedAt: new Date().toISOString() }, 900),
    refreshCatalog: () => delay(discovery, 500),
    getSettings: () => delay(settings),
    setEndpoints: async (endpoints) => (settings = { ...settings, endpoints }),
    setSecret: async (key) => (settings = { ...settings, secretsPresent: { ...settings.secretsPresent, [key]: true } }),
    clearSecret: async (key) => (settings = { ...settings, secretsPresent: { ...settings.secretsPresent, [key]: false } }),
    testAgent: (agentId) => delay({ agentId, ok: true, detail: 'PONG', durationMs: 1840 }, 900),
    getAccounts: () => delay(accounts, 300),
    signIn: () => delay({ ok: true, detail: 'Signed in.' }, 900),
    signOut: () => delay({ ok: true, detail: 'Signed out.' }, 400),
    onSignInProgress: () => () => undefined,
    setProviderDefault: async (providerId, value) =>
      (settings = { ...settings, providerDefaults: { ...settings.providerDefaults, [providerId]: value } }),
    mcpSignIn: () => delay({ ok: true, detail: 'Signed in.' }, 900),
    onMcpSignInProgress: () => () => undefined,
    startDispatch: async (req) => {
      simulate(req.cardId);
      return { ok: true };
    },
    cancelDispatch: async () => ({ ok: true }),
    setJudge: async (judge) => (settings = { ...settings, judge }),
    pickFolder: () => delay('C:\\Projects\\agent-kanban', 200),
    gitRepoInfo: (path) => delay({ ok: true, root: path }, 200),
    getBrand: (): Promise<BrandAssets> => delay({ crest }),
    onRunUpdate: (cb) => listen(runListeners, cb),
    onCardPatch: (cb) => listen(patchListeners, cb),
  };
}
