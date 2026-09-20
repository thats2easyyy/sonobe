---
name: sonobe
description: Build, debug and explain interaction prototypes in Sonobe (layers plus a patch graph with a live viewer) using the sonobe MCP tools. Use when someone asks to prototype an interaction, animation, gesture or screen flow in Sonobe, to import screens from their app or code into Sonobe, to fix a Sonobe prototype that doesn't behave, or to explain what one does.
---

# Prototyping in Sonobe

Sonobe prototypes are layers (what people see) plus patches (logic nodes with typed ports) wired together. The `sonobe` MCP tools edit the person's open document through the same ops, validation and undo history as their own clicks. Changes show up live in their editor.

## Before you touch anything

1. Call `get_guide` with topic `start-here`, once per conversation (again after your context is compacted).
2. Call `get_document_info`. It tells you:
   - which document is active and its screen size
   - whether this is the app or headless mode (no editor selection; saving may be manual)
   - existing diagnostics
3. Call `get_outline` to see what exists. Use ids exactly as printed.
4. Call `list_patch_types` (search by intent: "spring", "drag", "tabs") and `describe_patch_types` for every patch type you'll wire. Never invent port keys.
5. For an interaction a verified example covers (a bottom sheet, swipe cards, a carousel, a tab bar), call `list_examples`, then `get_example` for its patch chain, common mistakes and recipe.

## Importing screens from the person's app

When they have an app or a design in code, start from it instead of drawing layers by hand. Read the `importing` guide first.

- A web app: find or start its dev server (read `package.json` scripts), then `import_design` with `url` for each screen. `selector` imports one component; `waitFor` waits for data.
- Anything else (SwiftUI, React Native, Flutter, a screen that needs a backend) or a new design: read the screen's code and theme, write one faithful static HTML page at the device width with real copy, colors, fonts, spacing and inline SVG icons, and `data-name` on elements you'll wire, text included. Write SF Symbols as `<svg data-sf-symbol="heart.fill"></svg>` (CSS `font-size`, `font-weight` and `color` style them) instead of drawing them: Sonobe on a Mac imports the real symbol. Import it with `html`.
- For a new design, match what's there first: `get_outline` with detail "styles" lists the colors, fonts, sizes and radii the prototype uses, and `get_screenshot` of one screen (isolate: true) shows its look. Before a replace over a screen the person may have changed, dryRun: true names the layers that wouldn't be found again.
- Read the result's outline, compare `get_screenshot` with the source (`screenshot: true` returns the page), then wire interactions onto the imported ids.

## Building

- Call `begin_work` with a one-line intent the person will see. Call `finish_work` at the end, even after a failure.
- Build one feature per call:
  - `add_layers` for visuals.
  - `add_patches` with `connections` for logic. Give patches a `ref` and wire with `"$ref.port"` in the same call; refs work in any order, so loops fit in one call.
  - `set_values` to tune; `connect` for single wires; `apply_ops` for anything else, such as disconnects, components or moves.
  - `set_knobs` for numbers the person will want to tune or compare: named knobs with ranges, and presets like a locked "Shipped app" next to "Proposal". Never put reference values in names (see the `knobs` guide).
- Name things for people: layers by what they are ("Like Button"), patches by what they do ("Liked", "Press Spring").
- Leave out `ui` positions: `add_patches` places new patches as wide as the editor draws them, clear of frames. Frame each feature with a comment and lay it out with `tidy_graph` (`frames` for one section); `get_items` lists nodes whose boxes overlap.
- Default to the ISAT chain: Interaction (tap or down) → Switch (remember) → Pop Animation or Classic Animation (move 0…1 smoothly) → Transition (0…1 into real units) → layer property.
  - `down` is a state that ends on release. Wire `tap` into a Switch when the change should stay.
- Read every write result:
  - `revision`, created ids, and the diagnostics added or resolved.
  - A failed call changed nothing. Read the hint, apply a suggestion's ops if one fits, and retry.
- Pass `expectedRevision` when acting on something you read a while ago, so you don't overwrite the person's edits.

## Verifying (do this before saying it works)

1. `get_diagnostics` with `severity: "warning"`.
2. `sim_reset`, then `sim_dispatch` the gesture (`{ "kind": "tap", "target": "@card" }`). Check the hit report: which layer caught it, which patch heard it, any warnings.
3. `sim_trace` the properties that should move. Check the end value, settle time and overshoot against the requested feel ("snappy" means little or no overshoot and settles fast).
4. `sim_step` with `until: "idle"`, or `sim_get_values`, for final states.
5. `get_screenshot` for visual QA: `"@card"` for one layer, `simId` plus `atMs` for a moment in a simulation, `"graph"` with `component` to see inside a component without moving the person. Headless servers draw it themselves with approximate text and placeholders for video. Read structure and values from tools, not pixels.
6. To peek under a layer or A/B a value, use `sim_override` inside the simulation, or `get_screenshot` with `isolate: true` for one layer alone. Never edit and undo just to look: that clutters the person's history.
7. The person's live viewer keeps its state through your edits (a count, a switch that's on). When they should see it from the start, `restart_viewer` restarts it, on their phone too.

## Debugging

- Call `explain` with `audience: "engineer"` on the items involved.
- Reproduce in simulation and read values along the chain (interaction output, switch, animation, layer property) to find where the value stops changing.
- Fix the smallest thing, then re-run the same simulation.
- The `troubleshooting` guide lists symptoms and fixes.

## Talking to people

- Describe results by names and feel: "tapping the card springs it up to 108% size and settles in about 0.4 s". Don't paste ids, addresses or JSON unless they ask.
- For beginners, `explain` with `audience: "beginner"` gives a plain walkthrough you can build on.
- Ask before deleting things you didn't create. `delete_items` requires a confirmation token past 10 items.
- `undo` reverts your last batch. It refuses to undo the person's own edits unless they agree.

## Guides

`get_guide` topics: `start-here`, `importing`, `graph-basics`, `gestures`, `animation`, `layout`, `loops`, `components`, `knobs`, `simulation`, `troubleshooting`. Read the one that matches the task before building something unfamiliar.
