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

**Board.** Eight workflow columns, modelled on Hermes Agent's own Kanban:

| Column | Meaning |
| --- | --- |
| TRIAGE | Rough ideas |
| TODO | Parked work — and tasks waiting for an unfinished parent |
| SCHEDULED | Tasks waiting for their start time |
| READY | **Runs by itself**, highest priority first (up to three at once) |
| RUNNING | An agent is working on it |
| BLOCKED | Needs you: a failed run, or a Goal the judge could not sign off (the card says why) |
| REVIEW | Finished — check the result |
| DONE | Accepted. Cards waiting on this one move to READY |

**How it looks.** The board is drawn like a coat of arms on a black field. The eight columns
are stations on one gold rail: each station's shield shows how many cards it holds (READY's is
gold; RUNNING turns blue, BLOCKED red, REVIEW purple and DONE green when they hold cards, each
with its heraldic hatching so the states differ by pattern too), and a line under its name says
its state at a glance ("3 live", "1 to fix", "2 to approve"). Every card shows a small shield
for its agent — a colour, a pattern and a letter, so agents can be told apart without relying on
colour — plus its model, what it is doing right now, and its **next stop**: where it goes next
and what gets it there (a person icon means it is waiting for you). Select a card and its
station lights up, the rail traces the way to its next stop in gold, and its parent and child
cards are outlined in silver.

On a smaller screen, when there is live work to keep in view, the quieter stations (DONE,
TRIAGE, SCHEDULED, then TODO) fold down to their shield and name so READY, RUNNING, BLOCKED and
REVIEW stay on screen. Click a folded station to open it; you can still drop cards on it. The
**⋯** button at the foot of each station renames, folds or deletes it (deleting asks first, and
its cards move to the first station).

The status line at the top counts what is running, ready, blocked and waiting for review; click
one to jump to that station. Nothing on the board animates on a loop: a running card shows a
ticking clock and its latest line, and its thin blue bar flashes once when new output arrives. **Ctrl K** searches titles, descriptions, models and agents (cards
that do not match fade out). **Approve** on a REVIEW card and **Retry** on a BLOCKED card move it
on in one click. From the keyboard, **Enter** opens a card and **Space** picks it up to move it.
Text is set in Atkinson Hyperlegible (made for easy reading), station names in Cinzel's Roman
capitals; both are bundled with the app. Put your own logo in `data/brand/` (see below) and it
leads the top bar and becomes the window icon; without one the app shows a plain gold shield.

Add, rename and delete columns; add, edit, move and delete cards (deleting asks first, inside the
app); drag a card anywhere.
Everything saves automatically and survives a restart. A board from an older version is
upgraded in place (Backlog → TODO, In Progress → RUNNING, In Review → REVIEW, Done → DONE, no
card moves) and the original file is kept as `board.v1-backup.json`.

**New task popup.** The gold **New task** button at the top opens it, as does **New task** at
the foot of any column. Only the title is required:

| Field | What it does |
| --- | --- |
| Title, Description | The task. In Goal mode these are what the judge checks, so say what "done" means |
| Start in | The column it starts in (TODO from the top button, else the column you clicked). READY starts it by itself |
| Priority | Low to Urgent; higher starts first when several tasks are READY |
| Workspace | The board folder, a folder of its own, or a new **git worktree** (own branch, under `<repo>/.worktrees/<id>`, kept afterwards) |
| Assignee | An account (ChatGPT via Codex, Claude via Claude Code), a connection (Hermes, Ollama, LM Studio) or an API key (via Hermes) |
| Model, Effort | Every model and effort level that assignee offers; blank uses the default from Settings |
| Skills, MCP servers, tools, plugins | Optional; each list only offers what that agent can use |
| Parent | The task waits in TODO until the parent is DONE, then starts by itself |
| Schedule | The task waits in SCHEDULED and starts by itself at that time (the app must be open; if it is not, it starts when you next open it) |
| Goal mode | The worker loops until the judge agrees it is done |

The popup's footer says where the task will go and when it will start. Everything can be
changed later in the card panel, which also has the task prompt and a chat session.

Each scoping list says whether the chosen agent can actually enforce it. Where an agent's CLI
has no flag for something, the control still works but is labelled **recorded only** — the app
never pretends a restriction is being applied when it is not.

**Dispatch.** Press **Send to Agent**, or move the card to READY. The card moves to RUNNING,
output appears on it as it arrives, and it moves to REVIEW when the run succeeds (BLOCKED if it
fails). You can cancel a run at any time.

**Goal mode.** After each round the judge (Settings → Judge) runs in the same folder, checks the
work against the title and description, and answers `done` (card → DONE), `continue` (its
feedback goes back to the worker, which resumes its own session) or `blocked` (the task cannot
be done as written; card → BLOCKED). If the judge is still not satisfied after the round limit,
the card goes to BLOCKED with its last feedback. A judge that gives no clear answer counts as
`continue`, so unfinished work is never marked done.

---

## Supported agents

| Agent | How it is reached | Streaming |
| --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json` | yes |
| OpenAI Codex | `codex exec --json` | yes |
| Hermes Agent | `hermes -z` | no (one-shot returns the final answer) |
| Ollama | `POST /api/chat` | yes |
| LM Studio | `POST /v1/chat/completions` | yes |


The board discovers whichever of these are present. Anything missing appears in the picker
with a red dot and an explanation, rather than being silently hidden.

---

## Settings

Open **Settings** in the top right. Every account, connection and API-key provider has a
**Model** and **Effort** picker listing everything that provider offers. The choice becomes the
default for cards that leave those fields blank; a card's own choice always wins.

| Where models come from | How |
| --- | --- |
| Codex (ChatGPT sign-in) | `codex debug models`, including each model's own effort levels |
| Claude Code | Aliases, plus Anthropic's live model list when a key is saved |
| API-key providers | Each provider's own live "list models" endpoint, called with your saved key |
| Ollama, LM Studio | The local server's live model list |

Effort levels come from each agent's own CLI help: Claude Code `--effort`, Codex
`model_reasoning_effort` (per model), Hermes `--reasoning`, and Ollama's `think` switch.

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
- **Judge** — who checks Goal-mode tasks: any account, connection or API key, its model and
  effort, what it may use (skills, MCP servers, tools, plugins), and how many rounds to allow
  before a person takes over (default 5).
- **Environment** — what the last scan found. Click any count (agents, providers, models, MCP
  servers, plugins, skills, tools) to open the full list, with a filter for long ones. MCP
  servers are grouped by the agent that owns them — Claude Code, Codex and Hermes each keep
  their own list — and every server that uses OAuth has a **Sign in** button. It runs that
  agent's own login (`claude mcp login`, `codex mcp login`, `hermes mcp login`), which opens
  your default browser at the service's consent page; the agent stores the result.

---

## Where your data lives

Running unpackaged (`npx electron .`), everything stays inside the project folder:

| File | Contents |
| --- | --- |
| `data/board.json` | The whole board, in readable JSON |
| `data/settings.json` | Endpoint URLs, each provider's default model and effort, and the judge |
| `data/secrets.enc.json` | API keys, encrypted |
| `data/board.v1-backup.json` | Only after an upgrade: the board as it was before |
| `data/brand/` | Optional: your own logo as `crest.png`, `crest.webp` or `crest.jpg` (a tall image on black works best), and `crest-icon.png` (256×256) for the window icon |

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

To work on the look without Electron, run the real interface in a browser with sample data (it
shows your logo from `data/brand/` if there is one), then open
`http://localhost:5199/preview.html`:

```bash
npx vite --config vite.preview.config.ts
```

Three verification modes are built into the app itself. Point `AGENT_KANBAN_DATA_DIR` at a
scratch folder for all of them; the self-test never starts agents or moves cards, the other two do.

```bash
npx electron . --smoke-test
```

Boots the app, waits for the board, captures a screenshot, and exits non-zero if the board
failed to render. Prints `SMOKE_TEST_RESULT {...}`. With `SMOKE_TEST_SETTINGS=1` it also opens
the New Task popup (filled in, then cancelled), a card, and every Settings tab, photographs
each and prints what it found (`SMOKE_TEST_TASK`, `SMOKE_TEST_SETTINGS`).

```bash
npx electron . --dispatch-test=hermes,ollama
```

Runs a real card through the real dispatcher for each named agent and prints
`DISPATCH_TEST {...}` per agent, including whether the run persisted to disk.

```bash
npx electron . --flow-test=600
```

Lets the real workflow run the board — READY starts, schedules, parents, Goal mode with the
judge — until nothing is left to do (or the given number of seconds pass), then prints
`FLOW_TEST {...}` with every card's column, goal and runs.

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
command. Give each card a **Workspace** — its own folder, or a git worktree so its changes stay
on their own branch; a card on the board folder runs in your home folder by default. Only send
prompts you trust — text pasted from a web page or a document can carry instructions aimed at
the agent.

Cards also start **without a click**: anything moved to READY, a scheduled task when its time
comes, and a task whose parent reaches DONE all run with these same permissions. The Goal-mode
judge is told not to change files, but it runs with its agent's full permissions too.

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
