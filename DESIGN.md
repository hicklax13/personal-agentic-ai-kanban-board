---
name: Agent Kanban
description: A heraldic hall of record, where every agent task advances along one gilded line of eight stations on a sable field.
colors:
  field: "#070708"
  well: "#0d0e10"
  steel: "#131417"
  steel-2: "#181a1e"
  steel-3: "#202328"
  steel-4: "#2a2e34"
  engrave: "#2b2f35"
  engrave-2: "#3b4047"
  engrave-hover: "#4d535b"
  field-edge: "#62686f"
  argent-bright: "#eef0f2"
  argent: "#c9ced4"
  argent-edge: "#aeb4bb"
  argent-dim: "#9aa1a9"
  argent-faint: "#858c94"
  argent-wash: "rgba(201, 206, 212, 0.1)"
  or: "#c9a24a"
  or-bright: "#e8c872"
  or-pale: "#f0d68a"
  or-deep: "#8c6b22"
  or-ink: "#241a05"
  gules: "#a8222b"
  gules-text: "#f28b90"
  gules-wash: "rgba(168, 34, 43, 0.16)"
  azure: "#2b50a8"
  azure-bright: "#5b82e0"
  azure-text: "#a3bcf7"
  azure-wash: "rgba(43, 80, 168, 0.2)"
  purpure: "#6a3a8b"
  purpure-bright: "#8e5bb3"
  purpure-text: "#d2b2f2"
  purpure-wash: "rgba(106, 58, 139, 0.24)"
  vert: "#1e7442"
  vert-text: "#7ad6a2"
  vert-wash: "rgba(30, 116, 66, 0.2)"
  tenne: "#b45e1f"
  tenne-text: "#f3a766"
  tenne-wash: "rgba(180, 94, 31, 0.16)"
typography:
  display:
    fontFamily: "Cinzel, 'Atkinson Hyperlegible Next', serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
  headline:
    fontFamily: "Cinzel, 'Atkinson Hyperlegible Next', serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.12em"
  inscription:
    fontFamily: "Cinzel, 'Atkinson Hyperlegible Next', serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0.14em"
  title:
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: '"tnum"'
  meta:
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.3
  button:
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
  chip:
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
  mono:
    fontFamily: "'Atkinson Hyperlegible Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  chip: "4px"
  inset: "5px"
  sm: "6px"
  md: "8px"
  track: "10px"
  pill: "11px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  station-gap: "12px"
components:
  button-primary:
    backgroundColor: "{colors.or}"
    textColor: "{colors.or-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "#d6b15b"
  button:
    backgroundColor: "{colors.steel-3}"
    textColor: "{colors.argent-bright}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  button-hover:
    backgroundColor: "{colors.steel-4}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.argent-dim}"
    padding: "6px 9px"
  button-ghost-hover:
    backgroundColor: "{colors.steel-3}"
    textColor: "{colors.argent-bright}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.gules-text}"
  button-danger-solid:
    backgroundColor: "{colors.gules}"
    textColor: "#ffffff"
  button-approve:
    backgroundColor: "{colors.vert}"
    textColor: "#ffffff"
  button-small:
    padding: "5px 10px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.argent}"
    size: "36px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.argent-bright}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  input-search:
    backgroundColor: "{colors.steel-2}"
    padding: "8px 80px 8px 34px"
  toggle:
    backgroundColor: "{colors.steel-4}"
    rounded: "{rounded.pill}"
    width: "38px"
    height: "22px"
  toggle-on:
    backgroundColor: "{colors.argent}"
  chip:
    backgroundColor: "{colors.steel-3}"
    textColor: "{colors.argent}"
    typography: "{typography.chip}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
  chip-running:
    backgroundColor: "{colors.azure-wash}"
    textColor: "{colors.azure-text}"
  chip-failed:
    backgroundColor: "{colors.gules-wash}"
    textColor: "{colors.gules-text}"
  chip-goal:
    backgroundColor: "{colors.purpure-wash}"
    textColor: "{colors.purpure-text}"
  chip-succeeded:
    backgroundColor: "{colors.vert-wash}"
    textColor: "{colors.vert-text}"
  banner-info:
    backgroundColor: "{colors.azure-wash}"
    textColor: "{colors.azure-text}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  banner-warn:
    backgroundColor: "{colors.tenne-wash}"
    textColor: "{colors.tenne-text}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  banner-error:
    backgroundColor: "{colors.gules-wash}"
    textColor: "{colors.gules-text}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.argent-dim}"
    typography: "{typography.button}"
    padding: "8px 10px 7px"
  tab-selected:
    textColor: "{colors.argent-bright}"
  status-pill:
    backgroundColor: "transparent"
    textColor: "{colors.argent}"
    padding: "7px 10px"
  menu:
    backgroundColor: "{colors.steel-2}"
    rounded: "{rounded.md}"
    padding: "6px"
  card:
    backgroundColor: "{colors.steel-2}"
    textColor: "{colors.argent-bright}"
    rounded: "{rounded.md}"
    padding: "11px 12px 10px"
  card-done:
    backgroundColor: "#111214"
  track:
    backgroundColor: "rgba(13, 14, 16, 0.78)"
    rounded: "{rounded.track}"
    padding: "8px"
  station:
    width: "204px"
  station-narrow:
    width: "132px"
  station-folded:
    width: "64px"
  station-shield:
    width: "30px"
    height: "35px"
  station-ribbon:
    backgroundColor: "#1e2025"
    textColor: "{colors.argent-bright}"
    typography: "{typography.inscription}"
    padding: "5px 14px 4px"
  escutcheon-urgent:
    width: "26px"
    height: "30px"
  escutcheon-high:
    width: "22px"
    height: "26px"
  escutcheon:
    width: "20px"
    height: "23px"
  escutcheon-low:
    width: "16px"
    height: "19px"
  live-dot:
    backgroundColor: "{colors.azure-bright}"
    size: "8px"
  jewel:
    rounded: "1.5px"
    size: "8px"
  panel:
    textColor: "{colors.argent-bright}"
    width: "clamp(400px, 31vw, 500px)"
  dialog:
    rounded: "{rounded.track}"
    width: "760px"
---

# Design System: Agent Kanban

## Overview

**Creative North Star: "The Heraldic Hall of Record"**

A black field where the owner's crest presides, each agent bears its own arms, and every task advances along one gilded line of eight stations. The look is taken from the crest itself: sable, polished silver metalwork, gold rationed to what matters most, the heraldic tinctures for state, and Roman inscriptional capitals for names. It refuses the category's default, the dark developer dashboard with one neon accent.

This is an instrument left open all day on a large monitor and sometimes a small laptop, so ornament lives in the frame (the band, the rail of station shields, the name scrolls, a faint diapered field) and the working surface stays calm: blackened-steel plates, a hyperlegible sans at 12 to 16px, and silver for everything the hand touches. Density is high without crowding: stations 204 to 332px wide, 8px between cards, 12px between stations. There is no light theme; the crest's world is a black field.

Nothing glows and nothing loops. Light appears only as 1px engraved hairlines and top-lit steel, and every blurred shadow is black. Motion reports a change in 150 to 200ms and stops: a running card shows a ticking clock and its newest line of output, and its track flashes once when more arrives.

**The State-Only Motion Rule.** Transitions run 150 to 200ms on one expo-out curve (cubic-bezier(0.16, 1, 0.3, 1)) and only when something changed; nothing repeats, spins or pulses, and under prefers-reduced-motion every transition collapses to an instant and scrolling stops being smooth.

**Key Characteristics:**
- Sable field under a faint silver lozenge diaper; blackened-steel plates on recessed tracks.
- Argent is the everyday accent; gold is rationed to the primary action, READY and the line itself.
- Five state tinctures, each doubled by Petra Sancta hatching, a word or a count.
- One heater-shield outline for every heraldic mark.
- Cinzel capitals for names, Atkinson Hyperlegible Next for reading, its Mono for machine output.
- Self-hosted type and drawn SVG icons; nothing is fetched from outside the app.

## Colors

A sable-and-steel ground lit by silver, with gold rationed and five heraldic tinctures that carry state. Every reading tint clears 4.5:1 on the ground it sits on.

### Primary
- **Heraldic Or** (#c9a24a): the gilded rail, the READY shield, and the fill of the one primary button in each surface.
- **Bright Or** (#e8c872): the READY station's note, the "next stop" note on the traced station, and the bordure of an urgent escutcheon.
- **Pale Gilt** (#f0d68a): the selection trace: the relit stretch of rail, the lit shield rims, and the scroll edge of the selected card's station.
- **Old Gold** (#8c6b22): the rim of gold things, the primary button's edge and the READY shield's rim.
- **Gilder's Umber** (#241a05): letters and hatching on gold (7.1:1 on Heraldic Or).

### Secondary
- **Polished Argent** (#eef0f2): primary text, the focus ring, the selected card's edge, the active tab's underline, a drop target's edge.
- **Argent** (#c9ced4): secondary text (agent lines, field labels, chips), the switched-on toggle track, checkbox accents.
- **Silver Rule** (#aeb4bb): engraved silver edges: the scroll's rules, station shield rims, a focused field's border, related cards, the station chip.
- **Pewter** (#9aa1a9): quiet text: hints, meta lines, station notes, ghost buttons and resting icons.
- **Tarnished Silver** (#858c94): placeholders and zero counts, the faintest text in the app.
- **Silver Wash** (rgba(201, 206, 212, 0.1)): the fill of a track or folded station while a card is dragged over it.

### Tertiary
Each tincture comes as a field (shields, solid buttons, hatching), a text tint (words on the dark) and a wash (chips, banners, callouts).
- **Gules** (#a8222b, tint #f28b90, wash rgba(168, 34, 43, 0.16)): stuck, failed, destructive, urgent. The BLOCKED shield and hatch band, error banners, failure chips, the Urgent chip, danger buttons.
- **Azure** (#2b50a8, bright #5b82e0, tint #a3bcf7, wash rgba(43, 80, 168, 0.2)): running. The RUNNING shield, live dots and tracks, the running count, queued and starting chips, info banners, tool events in transcripts.
- **Purpure** (#6a3a8b, bright #8e5bb3, tint #d2b2f2, wash rgba(106, 58, 139, 0.24)): waiting on a verdict: work awaiting the owner's review, and Goal mode while its judge is still deciding. The REVIEW shield and track edge, Goal chips and the running Goal status.
- **Vert** (#1e7442, tint #7ad6a2, wash rgba(30, 116, 66, 0.2)): done and approved. The DONE shield, the Approve button, finished lines, succeeded and Goal-met chips, the available jewel.
- **Tenné** (#b45e1f, tint #f3a766, wash rgba(180, 94, 31, 0.16)): caution. Warning banners and hints, the degraded jewel, fix-it lines, stderr in transcripts.

### Neutral
- **Sable Field** (#070708): the ground of the whole app under a faint overhead sheen; on the board it carries a silver lozenge diaper at 4%.
- **Inkwell** (#0d0e10): recessed wells: text fields, output and transcript boxes, the model picker, waiting and scheduled chips.
- **Blackened Steel** (#131417): the darkest step of the steel scale; the thumb of a switched-on toggle.
- **Steel Plate** (#181a1e): menus, select options, the search field, a hovered folded station; the tone cards are graded around.
- **Raised Steel** (#202328): buttons, chips, key caps, and the hover of quiet rows.
- **Worn Steel** (#2a2e34): button hover, the idle toggle track, scrollbar thumbs, the idle live dot.
- **Engraved Line** (#2b2f35): the 1px edge of cards, tracks, groups and dividers.
- **Deep Engraving** (#3b4047): the edge of buttons, chips and key caps, and the status divider.
- **Burnished Edge** (#4d535b): the hover edge of buttons and the hovered scrollbar.
- **Field Edge** (#62686f): the resting border of every text field, select, pick-list box and toggle track, at 3:1 or better against the surfaces it sits on.

### Named Rules
**The Silver Hand Rule.** Everything the hand touches answers in argent: the focus ring, text selection, the active tab, a switched-on toggle, checkboxes, the selected card's doubled edge and a drop target's wash. No interactive state is drawn in gold or in a tincture.

**The Rationed Gold Rule.** Or appears in these places only: the single primary button of each surface (New task in the band, Send to Agent in the card panel, Create task, Save and rescan), the READY station (its shield, note and track edge), the rail and its trace, the bordure of an urgent escutcheon, and the plain gilded shield that stands in for the crest.

**The Two Heraldries Rule.** Tinctures speak in two voices, kept apart by what carries them. On a station shield, count, chip, note, banner or track edge a tincture is a state. On an escutcheon it is an agent's arms and always travels with the agent's letter: Claude Code tenné, Codex azure, Hermes purpure, Ollama vert, LM Studio argent. No agent bears gules; trouble keeps its colour to itself.

**The Never Colour Alone Rule.** Every tincture that means something carries a second sign: its Petra Sancta hatching (gules vertical, azure horizontal, vert bendwise, purpure bend sinister, tenné crossed diagonally, or dotted, argent plain), a word, a count, a letter, a shape, or the drawn warning triangle that leads warning banners and hints.

## Typography

**Display Font:** Cinzel (with Atkinson Hyperlegible Next, serif)
**Body Font:** Atkinson Hyperlegible Next (with Segoe UI, system-ui, sans-serif)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with Cascadia Mono, Consolas, monospace)

**Character:** Roman inscriptional capitals name things; a face designed for low-vision readers carries everything that is read or typed. All three ship inside the app under the SIL Open Font License (Cinzel at 700 only), and numerals are tabular throughout so counts and clocks never jitter.

### Hierarchy
- **Display** (Cinzel 700, 20px, line-height 1, tracked 0.12em): the AGENT KANBAN wordmark beside the crest in the band.
- **Headline** (Cinzel 700, 17px, 1.2, 0.12em): panel and dialog titles.
- **Inscription** (Cinzel 700, 13px, 1.35, 0.14em, capitals): station names on their scrolls, fieldset legends and group heads. A folded station's name runs vertically at 0.16em; the station chip is 12px at 0.1em; a narrow station's scroll tightens to 6px of side padding and its name to 12px at 0.06em.
- **Title** (Atkinson Hyperlegible Next 700, 15px, 1.35): card titles. Finished cards drop to 600 in Pewter.
- **Body** (400, 14px, 1.5): running text, confirms and toggle labels; field values use 1.45.
- **Meta** (400, 13.5px, 1.4): the agent and model lines on cards, hints, notes and detail text.
- **Label** (600, 13.5px, 1.3): field labels; the next-stop line uses the same weight at 1.35.
- **Button** (600, 14px, 1.2): every button; the gold primary goes to 700 and small buttons to 13px.
- **Chip** (600, 12px, 1.35): chips, the smallest reading size in the app.
- **Mono** (Atkinson Hyperlegible Mono 400, 13px, 1.5): transcripts and the newest output line; run clocks at 600, 13px; key caps at 600, 12px.

### Named Rules
**The Inscription Rule.** Cinzel speaks names only: the wordmark, station names, panel and dialog titles, fieldset legends, group heads and the station chip. It is always 700, always capitals, always tracked (0.06 to 0.16em) and never below 12px. Sentences, counts, button labels and form text are never Cinzel; the one editable Cinzel line is a station's own name, renamed in place on its scroll.

**The Machine Voice Rule.** Atkinson Hyperlegible Mono carries only what machines say or count: run clocks, the newest line of agent output, transcripts, key caps and inline code.

## Layout

The app is a fixed frame: the band across the top, the board filling the rest, and the card panel docked on the right while a card is open. The page itself never scrolls: the board scrolls sideways (snapping to station starts), each track scrolls down, and panel and dialog bodies scroll inside their frames.

The board is one line of stations, 12px apart inside 12px 16px 16px of padding. A full station flexes from 204px to 332px; an empty station narrows to 132px when room is short; a folded station is 64px. Each station is a column: a 102px head (shield on the rail at 24px from the top, then the scroll, then the note), a track that scrolls its cards with 8px of padding and 8px between cards, and a foot holding its New task button and menu. The layout planner and the stylesheet share these numbers, and the planner also reserves 32px of edge and 140px for Add column.

**The Live Middle Rule.** When the line is short of room, empty stations narrow first. Stations fold only while READY, RUNNING, BLOCKED or REVIEW hold cards, least urgent first (DONE, TRIAGE, SCHEDULED, TODO), never the selected card's station and never while searching. The owner's own fold or unfold always wins.

The card panel is clamp(400px, 31vw, 500px) wide beside the board. Dialogs are 760px wide (New task 800px; Settings 860px, with a fixed height of min(860px, 100%) so its tabs never jump) inside 28px of backdrop.

Spacing is dense and 2px-grained: 4, 6, 8, 10, 12 and 16px do almost all the work, 8px most of all; 14px and 18px set the band's gaps and edges and the fieldset groups. Fields stack 16px apart, and the New task form runs in two columns 14px apart.

As the window narrows:
- Below 1640px the status line takes its own row under a hairline.
- Below 1120px the card panel slides over the board (up to 460px) instead of squeezing it.
- Below 860px search takes a full row and the New task form goes to one column.
- Below 700px the wordmark hides and the crest stands alone.
- Below 520px the band's button labels are hidden visually but stay named for assistive tech.

**The Status Keeps Its Words Rule.** Short of room, the status line moves to its own row rather than shortening its labels; a count always travels with its word.

## Elevation & Depth

A hybrid. Tone carries most of the depth, from the field through the inkwell of the tracks to steel plates and raised steel controls, and black shadows seat the plates and lift what floats. Plates are top-lit gradients rather than flat fills: cards run from #1b1d21 to #151619, the panel and dialogs from #17191d to #111215, the band from #111215 to #09090b, and a faint overhead sheen (#1b1c21, fading out by 62%) lies over the top of the field.

### Shadow Vocabulary
- **Plate** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 6px 14px -6px rgba(0, 0, 0, 0.55)`): cards on their tracks, together with a 4% white inset along the top edge.
- **Lift** (`box-shadow: 0 22px 48px -12px rgba(0, 0, 0, 0.75), 0 4px 12px rgba(0, 0, 0, 0.5)`): menus, dialogs (inside a 1px silver ring at 32%) and the dragged card.
- **Recess** (`box-shadow: inset 0 10px 18px -14px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(0, 0, 0, 0.6)`): the tracks, cut into the field.
- **Band cast** (`box-shadow: inset 0 -1px 0 rgba(174, 180, 187, 0.3), 0 8px 24px rgba(0, 0, 0, 0.45)`): the band's silver underline and the shade it throws on the board.
- **Panel cast** (`box-shadow: inset 1px 0 0 rgba(174, 180, 187, 0.25), -14px 0 32px rgba(0, 0, 0, 0.45)`): the card panel's silver edge and its shade.
- **Shield drop** (`filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.75))`): station shields on the rail; escutcheons take `drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.75))`.

### Named Rules
**The No-Glow Rule.** Every blurred shadow is black. Light enters only as 1px engraved hairlines and top-lit steel; nothing emits light, nothing blooms, and nothing blurs what lies behind it.

**The Three Depths Rule.** On the board there are three heights: tracks cut into the field, plates seated on them with Plate, and floating things (menus, dialogs, the dragged card) raised with Lift. The band and the card panel are the frame and cast their own shade over the board.

## Shapes

Squared steel with small, even corners, and heraldic silhouettes wherever meaning lives. Corners grow with size: 4px for chips and key caps, 5px for callouts inside a card, 6px for controls, banners and wells, 8px for cards, menus, groups and settings rows, 10px for tracks, folded stations and dialogs. The toggle is an 11px pill and the live dot a circle; tabs, scrolls and the rail are square. Edges are 1px engraved lines; the heavier strokes are the 2px focus rings, the 2px selected-tab underline, the doubled edge of a selected card, the 2px base of a key cap and the 4px rail.

- **Heater shield:** a flat top, straight sides and a curve to a point, drawn in a 24 by 28 box and filled with a tincture and its hatching.
- **Lozenge jewel:** an 8px square turned 45° with 1.5px corners, marking the health of an agent or MCP server, always beside its status words: vert available, tenné degraded, gules unavailable. Status text from the command line loses its leading ✓, ! or ✗, so the jewel is the only mark.
- **Scroll:** a square-cut band between two Silver Rule lines, its ends folded back as 12px notched tabs in darker steel, set 5px lower.
- **Engraved chevron:** disclosure rows draw their chevron from two 2px Pewter strokes and turn it 90° in 150ms.

**The One Shield Rule.** Every heraldic mark uses the same heater-shield outline: agent escutcheons, station shields, the station marks in the status line and the plain gilded shield. Only the fill, hatching, rim and size change.

**The Dashed Means Not Yet Rule.** A dashed line marks what has not happened yet: a raw idea card in TRIAGE, an empty station's hint, an unassigned escutcheon, and the pale-gilt rim of the next stop's shield.

## Components

### Buttons
Flat, squared and quick, like painted charges on steel.
- **Shape:** gently squared (6px), a 1px edge, icon and label 7px apart.
- **Primary:** flat Heraldic Or with an Old Gold edge and a Gilder's Umber label at 700, padded 7px 12px (8px 15px for New task in the band). One per surface.
- **Hover / Focus:** a 150ms change of fill and edge (the primary warms to #d6b15b); a press nudges the button 1px down; focus is a 2px Polished Argent ring at a 2px offset; disabled buttons fall to 45% opacity.
- **Steel (default):** Raised Steel fill, Deep Engraving edge, Polished Argent label; hover takes Worn Steel and the Burnished Edge. The band's Board file and Settings buttons drop the fill and keep the edge.
- **Ghost:** no fill or edge, a Pewter label, padded 6px 9px; hover fills with Raised Steel and brightens the label. Used for New task at each station's foot, Add column and Cancel.
- **Danger:** transparent with a gules edge and a gules-tint label, washing gules on hover. The solid form (Gules fill, white label) is kept for the confirming click.
- **Approve:** Vert fill and a white label, the quick Approve on REVIEW cards. Retry and Approve on cards use the small size (13px, 5px 10px).
- **Icon:** 36px square and transparent until hovered; the station menu's is 32px.

### Chips
- **Style:** 4px corners, Raised Steel fill, a Deep Engraving edge and an Argent 12px label padded 2px 7px; a 12px line icon may lead.
- **State:** tincture chips take the wash as fill, the tint as text and a stronger tincture edge: azure for queued and starting, gules for failed and Urgent, purpure for Goal rounds, vert for Goal met and a finished last run. High wears a silver edge, Low goes Pewter, and waiting or scheduled chips sit in Inkwell with a brighter edge.
- **Station chip:** the station's name in Cinzel 12px on a transparent chip with a Silver Rule edge, beside the card panel's title.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** a top-lit plate graded from #1b1d21 to #151619 around Steel Plate, with an Engraved Line edge.
- **Shadow Strategy:** Plate plus the 4% white top edge (see Elevation & Depth).
- **Border:** hover lifts the edge to #4a5058; a selected card doubles it in Polished Argent; its parent and children take Silver Rule; a search leaves non-matches at 26% and desaturated so the board keeps its shape; a dragged card leaves a 35% ghost while its copy tilts 1° on Lift; the drop point shows as a 3px Polished Argent line above the card it will displace.
- **Internal Padding:** 11px 12px 10px, with sections 8px apart.
- **By station:** TRIAGE ideas are dashed and darker; DONE cards go flat (#111214) and shadowless with a muted escutcheon and a Pewter title; BLOCKED cards take a gules edge and the hatch band.
- **Order of the face:** escutcheon and title; agent line; model and effort; chips; the live block on RUNNING cards; the reason on BLOCKED cards (a gules callout, up to 4 lines) or the result on REVIEW cards (an Inkwell box, up to 3 lines); the finished time; the quick Retry or Approve; the next stop.
- **Keyboard:** Enter opens a card; Space picks it up, the arrow keys move it, Space drops it and Escape cancels.

The card panel and dialogs share one frame: graded steel, a 12px 16px head and foot divided by engraved rules, a 16px body, and a headline title. Dialogs add 10px corners, the silver ring and Lift, and rise 8px over 200ms on a 76% black backdrop. Fieldset groups are 8px boxes with an Engraved Line edge, a 1.2% white tint and an Inscription legend.

### Inputs / Fields
- **Style:** Inkwell fill, a Field Edge border, 6px corners, padded 8px 10px in body type. Selects draw their own Silver Rule chevron; the search field sits on Steel Plate with room for its icon and a Ctrl K key cap.
- **Focus:** hover lifts the edge to Pewter; focus turns it Silver Rule inside a 2px Polished Argent ring at 45%.
- **Error / Disabled:** fields have no error state of their own; problems appear beneath them as a tenné hint (behind the drawn triangle, or a drawn pass or fail mark) or as a gules banner. Disabled fields fall to 55% opacity.
- **Toggle:** a 38 by 22px pill with a Field Edge border, Worn Steel with a Pewter thumb when off and an Argent track with a Blackened Steel thumb when on; the thumb slides 16px in 160ms.
- **Pick lists:** an Inkwell box with a Field Edge border and a borderless search row, rows with 5px corners that shade Raised Steel on hover, and a count at the foot.

### Navigation
- **The band:** a black band at least 70px tall, padded 10px 18px and graded from #111215 to #09090b above its silver underline. On the left, the crest at 58px and the wordmark, with the board's own title beneath it once the owner renames the board; then the status line; on the right, search, the gold New task, Board file and Settings.
- **Status line:** borderless pills at 500 weight with the count at 700, 15px. Running shows a round live dot (azure while anything runs), ready, blocked and review show their station's mark, an engraved divider follows, then the number of agents ready beside its lozenge jewel. Running, blocked and review counts take their state's tint when above zero (ready keeps silver beside its gold mark); zero counts go Tarnished Silver. A click scrolls to that station and lights its shield for 1.4 seconds.
- **Tabs:** borderless and Pewter; hover shows an engraved underline; the selected tab is Polished Argent with a 2px Polished Argent underline.
- **Station menu:** a 32px ellipsis at each station's foot opens a Steel Plate menu upward over the track (8px corners, Lift, 6px padding) with Rename, Fold and Delete station.

### Station Head
The signature of the line: a shield on the gilded rail, the name on a scroll beneath it, and one line of state.
- **Rail:** a 4px Heraldic Or bar 24px from the top of the head, each station drawing its own half to meet its neighbour's, with a 1px black lip beneath; the first and last stations stop at their shield.
- **Shield:** 30 by 35px on the rail, holding the station's count. TRIAGE, TODO, SCHEDULED and any empty station stay plain (#141519 with a Silver Rule rim); READY is always Or with an Old Gold rim; RUNNING, BLOCKED, REVIEW and DONE take azure, gules, purpure and vert once they hold cards, each with its hatching.
- **Scroll:** the name in Inscription on #1e2025 between Silver Rule lines, renamed in place; a BLOCKED station's name turns gules while it holds cards.
- **Note:** one 13px line at 600: "starts by itself" in Bright Or for READY, "N live" in azure, "N to fix" in gules, "N to approve" in purpure, or "N of M max" when a station has a limit.
- **Track edge:** RUNNING, BLOCKED and REVIEW tracks take their tint while they hold cards; READY's gold edge is always on.

### The Trace
Selecting a card dims the whole rail to 30% except the stretch from its station to its next stop, which is relit in Pale Gilt. The card's own shield grows to 118% with a Pale Gilt rim and its scroll edge turns Pale Gilt; the destination shield takes a dashed Pale Gilt rim and its note reads "next stop" in Bright Or; the card's parent and children take a Silver Rule edge. The line changes in 180ms.

### Escutcheon
An agent's arms: the heater shield in the agent's tincture and hatching with its initial (C, X, H, O, L) in Atkinson Hyperlegible Next 700. Priority sets the size on a fixed ramp (urgent 30px tall with a Bright Or bordure, high 26px, normal 23px, low 19px), so importance never rests on colour. An unassigned card shows a dashed empty shield with a question mark; DONE cards mute theirs to 55%.

### Hatch Band
A BLOCKED card carries a 7px band across its top: vertical gules strokes (2px solid, then 3px at 28%), the engraver's sign for gules, over a gules hairline, so a stuck card reads as stuck without seeing red.

### Live Block
A RUNNING card shows an 8px azure dot, the elapsed clock in Mono 600, what it is doing ("working", "starting", "judge checking", with the round), the newest line of output in Mono, and a 2px still track that flashes once (200ms, from #c5d5ff back to azure at 45%) each time output arrives.

### Folded Station
A folded station keeps its shield on the rail and becomes a 64px track holding its name in Inscription running downward, its card count and an unfold icon. It opens on a click and still takes dropped cards.

### Next Stop
**The Next Stop Rule.** Every card on the line ends with its next stop, under a hairline: the station it goes to next and what moves it there, in plain words, led by an arrow. When the card waits on the owner, the line turns Polished Argent at 700 and the arrow becomes a person. DONE, the end of the line, has none.

### Banners and Confirms
- **Banners:** 6px corners, a 1px tinted edge, a wash fill and a tint text, padded 9px 12px: azure for information, tenné for warnings (behind the drawn triangle), gules for errors. The toast form sits under the band with a dismiss button.

**The Confirm In Place Rule.** A destructive action asks inside the surface that offered it (the station menu, the card panel's foot, an account row) with a solid gules button to commit and the safe choice focused: Keep it, Keep, Stay signed in.

## Do's and Don'ts

### Do:
- **Do** keep argent for every interactive state: the 2px Polished Argent focus ring at a 2px offset, selection, the active tab, toggles, the selected card and drop targets.
- **Do** keep gold to its list: one primary button per surface, the READY station, the rail and its trace, the urgent bordure and the plain gilded shield.
- **Do** give every tincture a second sign: hatching, a word, a count, a letter or the drawn warning triangle.
- **Do** draw every heraldic mark with the one heater-shield outline (24 by 28) and fill it from the tincture set with its Petra Sancta hatching.
- **Do** set names in Cinzel 700 tracked capitals, everything read, counted or clicked in Atkinson Hyperlegible Next at 12px or larger, and machine output in its Mono.
- **Do** keep motion at 150 to 200ms on cubic-bezier(0.16, 1, 0.3, 1), once per change, and honour prefers-reduced-motion.
- **Do** confirm destructive actions in place, with a solid gules commit and the safe choice focused.
- **Do** end every card on the line with its next stop, and make it bright and bold when the card waits on the owner.
- **Do** draw icons as 12 to 18px Lucide line icons bundled with the app, or as drawn SVG.

### Don't:
- **Don't** gild anything else: no gold text for emphasis, no gold edges on ordinary cards, no second gold button in one surface.
- **Don't** let anything glow, bloom or blur what lies behind it; every blurred shadow is black.
- **Don't** loop: no spinners, pulses, shimmer or marching borders; show liveness with a ticking clock and the newest line of output.
- **Don't** put gules on an agent's arms; it belongs to trouble.
- **Don't** set sentences, counts, button labels or form text in Cinzel.
- **Don't** use typed characters as icons.
- **Don't** load anything from outside the app: fonts, images and icons ship inside it.
- **Don't** commit, embed or describe the owner's crest: it is loaded at runtime from the git-ignored `data/brand/` folder, and a plain gilded shield ships in its place.
