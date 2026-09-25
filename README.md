# Agent Kanban

A desktop Kanban board where each card can be dispatched to a coding agent installed on
this machine. Agents, models, tools, MCP servers, plugins and skills are all discovered at
runtime — nothing about your setup is hard-coded.

Built with Electron 44, React 19 and TypeScript. All state lives in a plain JSON file on
your disk. No cloud service, no telemetry, no account.

---

## Quick start

Install dependencies:

```bash
npm install
```

Electron downloads its own program the first time it starts, so there is no separate install
step.

Build and run:

```bash
npm run build && npx electron .
```

Or run in development with hot reload:

```bash
npm run dev
```

---

## What it does

**Board.** Four columns by default (Backlog, In Progress, In Review, Done). Add, rename and
delete columns. Add, edit, move and delete cards. Drag a card anywhere, including between
columns. Everything saves automatically and survives a restart.

**Per-card agent config.** Select a card and the right-hand panel lets you set, for that card
alone:

| Setting | What it does |
| --- | --- |
| Assigned agent | Which discovered agent runs this card |
| Model provider | Narrows the model list |
| Model | Pick from the discovered list, or type any id |
| Tools | Which tools the agent may use |
| MCP servers | Which MCP servers the agent may reach |
| Plugins | Which plugins are active |
| Skills | Which skills are preloaded |
| Chat session | Share a conversation thread across several cards |
| Task prompt | The instruction sent when you dispatch |
| Working directory | Where the agent runs |

Each scoping list says whether the chosen agent can actually enforce it. Where an agent's CLI
has no flag for something, the control still works but is labelled **recorded only** — the app
never pretends a restriction is being applied when it is not.

**Dispatch.** Press **Send to Agent**. The card moves to In Progress, output appears on the
card as it arrives, and the card moves to In Review when the run succeeds. You can cancel a
run at any time.

---

## Supported agents

| Agent | How it is reached | Streaming |
| --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json` | yes |
| OpenAI Codex | `codex exec --json` | yes |
| Hermes Agent | `hermes -z` | no (one-shot returns the final answer) |
| Ollama | `POST /api/chat` | yes |
| LM Studio | `POST /v1/chat/completions` | yes |
| ChatGPT Desktop | **not connected** — no local API exists | — |

The board discovers whichever of these are present. Anything missing appears in the picker
with a red dot and an explanation, rather than being silently hidden.

---

## Settings

Open **Settings** in the top right.

- **Connections** — set the Ollama and LM Studio URLs, and press **Test** on any agent to
  perform a real round-trip. A version check only proves a binary exists; Test is what proves
  the account behind it works.
- **Accounts** — sign in with your own **OpenAI (ChatGPT)** and **Anthropic (Claude)**
  accounts. Each button runs that tool's official browser sign-in (`codex login`,
  `claude auth login`), so the app never sees your password or tokens. While signed in, Codex
  and Claude Code use your subscription; a saved API key does not override the sign-in.
- **Credentials** — API keys, encrypted at rest with the OS keyring (DPAPI on Windows) and
  never sent back to the window: there is no read path across the IPC bridge, only write and
  clear.

  | Provider | Stored as | Used by |
  | --- | --- | --- |
  | OpenAI | `OPENAI_API_KEY` | Hermes (openai-api) |
  | Anthropic | `ANTHROPIC_API_KEY` | Hermes (anthropic) |
  | Google AI (Gemini) | `GOOGLE_API_KEY` | Hermes (gemini) |
  | DeepSeek | `DEEPSEEK_API_KEY` | Hermes (deepseek) |
  | xAI (Grok) | `XAI_API_KEY` | Hermes (xai) |
  | DeepInfra | `DEEPINFRA_API_KEY` | Hermes (deepinfra) |
  | Command Code | `COMMANDCODE_API_KEY` | Hermes (commandcode) |
  | Xiaomi MiMo | `XIAOMI_API_KEY` | Hermes (xiaomi) |
  | Ollama Cloud | `OLLAMA_API_KEY` | Hermes (ollama-cloud) |
  | LM Studio | `LM_STUDIO_API_KEY` | LM Studio |

  Each name is the environment variable the receiving agent reads; the Hermes names come from
  Hermes's own provider table. Hermes loads its own `.env` over anything passed in, so if
  Hermes already holds a key for a provider, Hermes uses its own.
- **Environment** — what the last scan found, and any warnings.

---

## Where your data lives

Running unpackaged (`npx electron .`), everything stays inside the project folder:

| File | Contents |
| --- | --- |
| `data/board.json` | The whole board, in readable JSON |
| `data/settings.json` | Endpoint URLs |
| `data/secrets.enc.json` | API keys, encrypted |

A packaged build uses the platform's standard application-data directory instead. Set
`AGENT_KANBAN_DATA_DIR` to override either. Electron writes its own Chromium caches under the
OS application-data path regardless — that is the framework's storage, not the board's.

`board.json` is plain JSON and safe to hand-edit while the app is closed. If it ever becomes
unreadable, the app renames it to `corrupt-<timestamp>.json` and starts fresh rather than
refusing to launch.

---

## Commands

```bash
npm run dev         # development with hot reload
npm run build       # build main, preload and renderer
npm start           # preview the built app
npm test            # run the test suite
npm run typecheck   # typecheck both processes
```

Two verification modes are built into the app itself:

```bash
npx electron . --smoke-test
```

Boots the app, waits for the renderer, captures a screenshot, and exits non-zero if the board
failed to render. Prints `SMOKE_TEST_RESULT {...}`.

```bash
npx electron . --dispatch-test=hermes,ollama
```

Runs a real card through the real dispatcher for each named agent and prints
`DISPATCH_TEST {...}` per agent, including whether the run persisted to disk.

---

## Permissions — read this first

Every agent runs with **full permissions and no approval prompts**. That is deliberate: a card
runs unattended, so any prompt would stall it, and the aim is maximum autonomy.

| Agent | Flags | Effect |
| --- | --- | --- |
| Claude Code | `--permission-mode bypassPermissions` | Every tool allowed, no prompts |
| Codex | `--dangerously-bypass-approvals-and-sandbox` | No sandbox, no prompts |
| Hermes | `--yolo --accept-hooks` | Dangerous commands and config hooks auto-approved |

An agent can therefore read, change or delete anything your user account can, and run any
command. Give each card a **Working directory** for the folder it should work in; a card
without one runs in your home folder. Only send prompts you trust — text pasted from a web
page or a document can carry instructions aimed at the agent.

The flags live in one place per agent (`src/main/agents/*.ts`) if you want to dial them back.

## Security notes

- The renderer has no Node access. `contextIsolation` is on and the preload script exposes one
  explicit, typed API object.
- Every subprocess is spawned with `shell: false` and an argv array. A task prompt containing
  quotes, backticks or `&&` is passed to the agent as one argument and is never parsed by a
  shell.
- API keys are encrypted at rest and can be written or cleared from the window, never read back.
- A Content-Security-Policy in `index.html` blocks remote script entirely.

---

## Adding another agent

1. Detect it in `src/main/discovery/agents.ts` and return a `DiscoveredAgent`.
2. Write an adapter in `src/main/agents/` with a pure `buildXCommand()` plus a `run()`.
3. Register it in `src/main/agents/registry.ts`.
4. Add argv tests in `tests/adapters.test.ts`.

Keep the argv builder pure and separate from the subprocess call — that is what makes the
flags testable without spawning anything.
