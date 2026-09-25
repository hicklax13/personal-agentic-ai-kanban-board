# Surface: Agent Kanban app shell

Mode: Operate.

## Scope

The whole renderer: top band, eight-station board, card tiles, card panel, New Task popup, and Settings (Accounts, Connections, Credentials, Judge, Environment). Every feature and setting stays; the eight columns and how they behave stay.

## Audience and job

One owner on Windows, all day on a big monitor and sometimes a small laptop, doing two jobs: hand tasks to agents, and watch many agents run at once. It must be easy for any skill level and age, comfortable to read, and color-blind safe.

## Success, in the owner's words

Instant status; faster task flow; a world-class, unique look; easy to find things; measured against what real users publicly praise in modern AI and productivity apps (Linear and Raycast for speed and clarity; Conductor and Vibe Kanban for per-agent status and built-in review; 2026 Apple Design Award winners for watching several live things at once and serving beginners and experts alike).

Feels wrong: generic, not unique, distracting while working, cramped or hard to read, hidden controls.

## Pinned by the owner

Their family crest is the logo, and its style sets the look of the entire app. The crest is private (it carries the family name and motto): it is loaded at runtime from the git-ignored `data/brand/` folder and never committed; a plain, nameless shield ships in its place.

## Direction contract

THESIS: A heraldic hall of record. The owner's crest presides over a black field where each agent bears its own tincture and every task advances along one gilded line of eight stations. It refuses the dark developer dashboard with one neon accent that this category ships.

OWN-WORLD: Sable field; argent hairlines and engraved borders; or (gold) only for the primary action, the READY station and emphasis; agents as small escutcheons in gules, azure, vert, purpure and tenné, each also marked by its Petra Sancta hatching; station names in Roman inscriptional capitals on ribbon banners; body text in a hyperlegible sans; nothing glows.

STORY: The owner sees at a glance what runs, what waits and what needs them, dispatches from the gold New task button, and approves finished work where it lands.

FIRST VIEWPORT: Black band: the crest at 44px on the left beside AGENT KANBAN in Roman capitals; live status in the centre; search, gold New task and settings on the right. Beneath it a gilded rail threads eight station shields, each with its count. Below, eight tracks of blackened-steel cards, each with an escutcheon badge, bold title, model line and next stop; RUNNING cards show live progress, BLOCKED cards carry gules hatching.

FORM: The owner-pinned crest world carrying the rolled Transit Map topology (candidate 5 of 7, seed 9c97b18a): one line of stations, the next stop on every card, lettered agent badges, hatching for blocked.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction and motion

Selecting a card lights its station shield and traces its next stop along the rail in gold; its parent and children light up in their tracks. Motion is 150–200 ms and shows state only.

## Build path

Code-led. Figma reached its plan's tool-call limit during the direction round and no image generator is available, so there are no comps. The Figma decision comp of the unchosen transit look stays only as reference.

## Open decisions

- A light variant is not planned: the crest's world is a black field.
