# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(An Electron desktop app for Windows whose interface is a React web UI. The design language is web, not native Windows.)

## Users

One owner, a power user, on their own Windows PC. They do two jobs, both daily:

- **Dispatch desk** — write tasks and hand them to their own AI agents (Claude Code, Codex, Hermes, Ollama, LM Studio), then check the results.
- **Control room** — keep many agent tasks running in parallel and keep an eye on all of them.

No other audience is planned.

## Product Purpose

Agent Kanban turns task cards into real agent runs on the owner's machine. A card holds the task, who does it (an account, a connection or an API key), the model and effort, what the agent may use, where it works, and when it runs. The board then moves work along by itself: READY cards start, scheduled cards start on time, a card waits for its parent, and a Goal-mode card loops until a judge agrees it is done.

Success: tasks go from rough idea to done with as few clicks as possible, and the owner can see at a glance what every agent is doing, waiting on, or needs from them.

## Positioning

It runs the owner's own signed-in agents and API keys locally, with full permissions, instead of a hosted service. Everything it offers — agents, models, effort levels, tools, MCP servers, plugins, skills — is discovered from the machine at runtime; nothing is hard-coded. The workflow deliberately follows Hermes Agent's own Kanban, so it behaves the way the owner already expects. No cloud, no account, no telemetry.

## Operating Context

- Left open all day on a big monitor while agents work; also used on a small laptop screen.
- The owner works across several AI coding tools at once and expects this app to keep up with them.
- Board, settings and encrypted keys live in local files next to the app; the repository is public.

## Capabilities and Constraints

- Workflow columns: TRIAGE, TODO, SCHEDULED, READY, RUNNING, BLOCKED, REVIEW, DONE. READY starts by itself (highest priority first, three at a time); failed runs go to BLOCKED with the reason; finished runs go to REVIEW; Goal-mode approval goes to DONE.
- New Task popup and card panel: title, description, priority, workspace (board folder, own folder, git worktree), assignee, model, effort, skills / MCP servers / tools / plugins, parent, schedule, Goal mode, task prompt, chat session.
- Settings: Accounts (sign-in through Codex and Claude Code), Connections, Credentials (encrypted API keys), Judge, Environment (everything discovered, with MCP sign-in).
- Agent output streams onto cards live; runs can be cancelled; every agent runs with full permissions.
- Must stay through any redesign: the eight columns and how they work, and every feature and setting — things may be reorganized and redesigned, never removed.
- Technical: Electron 44, React 19, TypeScript, electron-vite. The window reaches the system only through the preload bridge (`window.api`). The Content-Security-Policy allows no remote resources, so fonts, images and icons must ship inside the app. Secret values never reach the window.

## Brand Commitments

- Name: **Agent Kanban**.
- **The owner's family crest is the app's logo, and its style sets the look of the entire app** (owner's binding instruction): a black field; polished silver and gold metalwork; heraldic red, blue and green; ribbon banners lettered in classical Roman capitals; eagle, helm and mantling. The crest is private — it contains the family name and motto — so it lives only in the git-ignored `data/brand/` folder and must never be committed; the public repository ships a plain, nameless shield in its place.
- The owner asked for the whole interface to be more advanced, higher quality, professional, modern, current and unique — graphics, elements, fonts, colors, effects, backgrounds, and everything else on screen.

## Evidence on Hand

- The crest image exists only locally: the original `data/brand/crest.webp` (588×696, on black), the copy the app shows trimmed to the artwork (`crest.png`), and a 256×256 window icon (`crest-icon.png`). No other logo, icons or illustrations exist.
- Real board data exists only in the owner's local, git-ignored `data/` folder; it must never be published.
- No usage numbers, testimonials or benchmarks exist; do not invent any.

## Product Principles

1. **State at a glance.** What each agent is doing, waiting for, or needs from the owner is visible without opening anything.
2. **Autonomy you can predict and stop.** Work starts by itself, so the interface always says where a card will go and when it will start, and every run can be stopped.
3. **Honest controls.** A control never implies an effect that will not happen: defaults are shown, and choices an agent cannot enforce say so.
4. **Local and private.** Nothing leaves the machine except the agents' own calls; secret values are never shown.
5. **Comfortable all day.** Calm enough to leave open for hours on a big monitor, and still clear on a small laptop.

## Accessibility & Inclusion

- Easier reading is required: comfortable text sizes and strong contrast for long sessions.
- Status must be color-blind friendly: never color alone — pair it with a label, icon or shape.
- Must work from a large monitor down to a small laptop screen.
- Simple to use for any level of computer skill and any age, even though the owner is a power user.
