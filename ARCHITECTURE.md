# Sonobe Architecture

Sonobe is an open-source, AI-native desktop app for interaction prototyping. It works like Meta's Origami Studio: layers, patches, a viewer, and an inspector. It adds three things Origami doesn't have:

1. **AI-native by construction.** Every capability is a typed operation in a text-diffable document. The same operations are exposed to Claude over MCP.
2. **Learnable by construction.** Pulses and state are visible, errors teach, and every patch has generated docs, examples, and a plain-language "explain".
3. **Open and cross-platform.** MIT-licensed Electron app for macOS, Windows, and Linux, plus a web player for phones and an iPhone app that plays it with real haptics.

This document is the **contract** every contributor (human or agent) builds against. If code and this document disagree, fix one of them in the same PR.

Research that backs these decisions lives in `docs/research/`. Origami's docs are stale, so the release notes at https://origami.design/releases/ (summarized through v228 in `docs/research/release-notes.md`) are the source of truth for "what Origami does today".

---

## 1. Principles

- **One op engine, many front doors.** The UI, the MCP server, the CLI, and in-app scripting all mutate documents through `applyOps()` in `@sonobe/core`. Nothing mutates a document any other way.
- **Declarations drive everything.** A patch or layer type is declared once, with ports, types, defaults, and docs. The runtime, validation, inspector UI, patch picker search, hover docs, MCP schemas, and the reference site are all generated from that declaration.
- **Headless first.** The engine (evaluation, physics, layout, hit testing, gestures) is pure TypeScript with no DOM. It runs in Node for tests, the CLI, and MCP simulation. The DOM renderer only draws a `SceneFrame`.
- **Deterministic.** The simulation clock uses a fixed timestep and seeded randomness. The same document plus the same input events always produce the same frames.
- **Clean room.** No Meta code, assets, or trademarks, and no Apple device imagery. We reimplement behavior from public documentation and observable semantics. Compatibility notes may name Origami factually.

---

## 2. Repository layout (npm workspaces)

```
sonobe/
├── packages/
│   ├── core/       @sonobe/core     document model, zod schema, ids, values & coercion, ops, history,
│   │                                diagnostics, canonical serialization, migrations, outline projection;
│   │                                @sonobe/core/graph: the patch graph as drawn (node shapes and sizes, tidy)
│   ├── engine/     @sonobe/engine   runtime: graph compile + frame evaluation, loops, pulses, per-index state,
│   │                                physics (springs, decay), layout, hit testing, gesture recognition
│   ├── patches/    @sonobe/patches  built-in patch library: definitions + evaluators + docs + examples
│   ├── renderer/   @sonobe/renderer DOM renderer for SceneFrame, pointer/keyboard capture, device frames
│   ├── import/     @sonobe/import   design capture format, DOM walker (reads a rendered page), capture → layers converter
│   ├── mcp/        @sonobe/mcp      MCP tools over a SonobeHost interface, headless host, HTTP + stdio transports
│   └── cli/        @sonobe/cli      `sonobe` CLI: new, validate, fmt, outline, describe, sim, mcp (stdio relay; --headless <dir>)
├── apps/
│   ├── editor/     React editor UI (Electron renderer process; also runs in a browser for dev/tests)
│   ├── desktop/    Electron main + preload: windows, menus, file IO, MCP HTTP server, LAN preview server,
│   │               and the web player (player/) it serves to phones and the pop-out viewer
│   └── ios/        Sonobe Viewer: an iPhone app (Swift, Xcode) that plays the web player with native haptics
├── integrations/
│   ├── claude-code/     Claude Code plugin (.mcp.json + skills)
│   ├── claude-desktop/  .mcpb bundle manifest
│   ├── chrome-extension/ Sonobe Capture for Chrome: copy a page or an element as a design capture
│   └── figma-plugin/    Sonobe Capture for Figma: copy a selection as a design capture
├── examples/       canonical example prototypes (*.sonobe folders), used by docs, lessons, tests
└── docs/           research/, guides/ (numbered tutorials), patches/ (generated reference), assets/ (README screenshots)
```

Dependency direction (no cycles): `core ← engine ← patches ← renderer ← editor ← desktop`, and `mcp ← cli`, where `mcp` depends on `core`, `engine`, and `patches`. `import` depends only on `core`; `mcp`, `editor`, and `desktop` use it.

Tooling: TypeScript (strict, ESM), Vite 8 for the editor, esbuild for Electron main/preload and the CLI, Vitest for unit tests, Playwright for e2e (Chromium via `npm run e2e`; `_electron` in the desktop smoke test and package verification). Formatting uses Prettier defaults. `apps/ios` is Swift and SwiftUI, built with Xcode, and isn't an npm workspace.

---

## 3. Document model

### 3.1 On disk: a project folder

```
Checkout Flow.sonobe/
├── project.json            manifest: formatVersion, name, generator, device, root component id
├── components/
│   ├── main.json           root prototype (kind "prototype")
│   └── primary_button.json one file per document component
├── scripts/<patchId>.js    JavaScript patch sources (real files; diffable, lintable)
├── assets/assets.json      asset registry: id → {file, kind, name, width, height, sha256, font?}
├── assets/<sha256>.<ext>   content-addressed media
└── .sonobe/session.json    per-user editor state (camera, selection, panel sizes). Gitignored.
```

Canonical serialization rules:
- UTF-8, LF line endings, 2-space indent, trailing newline.
- Keys in schema order; maps sorted by id.
- Short leaf objects stay on one line, so a connection change is a one-line diff.
- Numbers are rounded to 6 significant decimals, `-0` is written as `0`, and there are no volatile fields. Rounding is idempotent, so a saved file passes `sonobe fmt --check`.

Folder rules:
- Only regular files named like document files load: `components/*.json` and `scripts/<name>` matching `[A-Za-z0-9_][A-Za-z0-9_.-]*`. Folders and other files in `scripts/` (`lib/`, `.eslintrc.json`) are left alone: saves never read, rewrite or delete them, and never delete a folder.
- File names must stay distinct where names ignore case (macOS, Windows). Component ids and script names that differ only by case are refused by ops, reported by diagnostics (`file_name_collision`), and saving throws before writing anything.
- Layers nest at most 256 levels deep (ops refuse deeper, loading reports a format error).

A `.sonobez` zip of the same layout is used for sharing (later).

### 3.2 Identifiers

- Ids are **readable, immutable slugs**: `^[A-Za-z_][A-Za-z0-9_]*$`. They are unique within a component across layers, patches, and comments. `__proto__` is reserved; other Object.prototype names are ordinary ids because lookups only read own keys.
- Component ids are file names (`components/<id>.json`), so they're unique ignoring case: `navBar` and `navbar` can't both exist, and derived ids skip to `navbar_2`.
- They are auto-derived from the display name on creation (`card`, `card_2`, `tap_card`, `popAnimation_1`).
- Renaming changes `name`, never `id`.
- Ids aren't reused across batches within a session. An id that belonged to an item of a component at any committed revision this session, and isn't live there when a batch starts, is **retired** in that component: a derived id skips it (the op result's `retired` says so) and an explicit one fails with `id_retired`. A batch may still remove an item and add a new one under the same id (a replacement); its inverse restores the old item. Component ids retire the same way, ignoring case. Retirement protects references held outside the batch (an agent's notes, simulator paths, the selection) from silently reaching a different item.
- Each host keeps the ids it has seen in an `IdLedger` (`createIdLedger`, passed to `applyOps` as `seenIds`) and observes every commit, undo and redo. Opening a document starts a new ledger; a reload continues it; it's never saved with the project (`seenIdsToJSON` lets a draft carry it).
- References:
  - a patch port: `patchId.portKey`
  - a layer property: `@layerId.propKey`
- Agents may pass `$ref` temp ids in a batch. `applyOps` returns an `idMap`.

### 3.3 Component file

```jsonc
{
  "formatVersion": 1,
  "id": "main",
  "name": "Main",
  "kind": "prototype",                 // "prototype" | "layerComponent" | "patchComponent"
  "notes": "Tap the card to expand it.",
  "interface": { "inputs": {}, "outputs": {} },   // published ports (components)
  "layers": [                          // ordered back → front; children nest
    { "id": "card", "type": "rectangle", "name": "Card",
      "props": {
        "position": [16, 120], "size": [358, 220], "cornerRadius": 24, "color": "#FFFFFFFF",
        "scale": { "link": "grow.output" }
      },
      "children": [] }
  ],
  "patches": {                         // map keyed by id
    "tap_card": { "type": "interaction", "inputs": { "layer": { "layer": "card" } }, "ui": { "x": 40, "y": 60 } },
    "toggle":   { "type": "switch", "inputs": { "flip": { "link": "tap_card.tap" } }, "ui": { "x": 220, "y": 60 } },
    "pop":      { "type": "popAnimation", "inputs": { "number": { "link": "toggle.on" }, "bounciness": 5, "speed": 10 }, "ui": { "x": 400, "y": 60 } },
    "grow":     { "type": "transition", "typeParam": "number", "inputs": { "progress": { "link": "pop.output" }, "start": 1, "end": 1.08 }, "ui": { "x": 580, "y": 60 } }
  },
  "comments": [ { "id": "note_1", "text": "Spring feel matches iOS sheet", "rect": [30, 20, 600, 120], "color": "yellow" } ],
  "meta": {}
}
```

- **Connections live on the input they drive**: `{ "link": "patchId.port" }`. An input can have at most one driver, so the format cannot represent two drivers into one input.
- Patches keep their graph position in `ui`, and comments in `rect`. Layer target nodes (`@layerId`, for layers a cable drives or reads) and the component's interface nodes (`$in`, `$out`) have no item to hold a position, so theirs live in `meta.patchEditor.nodes` (`{ "@photo": [980, 20] }`), written only by `setNodePositions`. A node without a saved position is placed next to the patches it connects to. Removing a layer drops its entry.
- A layer property is either a literal or a link. A layer-reference port holds `{ "layer": "layerId" }`.
- Patch options:
  - `typeParam` for type-variant patches (Transition on number, point, or color)
  - `inputCount` for variadic patches (Add, Or, Option Picker, Loop Builder)
  - `muted` (a Blender-style bypass)
- Literal value encoding:
  - number → JSON number
  - boolean → JSON boolean
  - text → string
  - color → `"#RRGGBBAA"`
  - point/size/anchor → `[x, y]`
  - point3d → `[x, y, z]`
  - point4d/edges/cornerRadii → `[a, b, c, d]`
  - enum → string key (never an index)
  - json → inline
  - image/video/sound/font → `{ "asset": "assetId" }`
  - loops of literals → `{ "loop": [...] }`
  - pulses have no literal

### 3.4 In memory

`SonobeDocument = { project, components: Record<id, Component>, scripts: Record<patchId, string>, assets: Record<id, AssetRecord> }`. It is plain immutable data. Updates produce new objects with structural sharing, so React selectors stay cheap and undo inverses stay trivial.

### 3.5 Ops (the only way to mutate)

`applyOps(doc, ops, ctx) → { doc, results, idMap, inverse, diagnosticsDelta, revision }`

- Batches are **atomic by default**: all ops apply or none do.
- Ops apply sequentially, and each op sees the effects of earlier ops.
- `dryRun` returns the would-be diff and diagnostics without applying anything.
- `expectedRevision` enables optimistic concurrency.
- Every op validates against the registry: unknown port → did-you-mean; type mismatch → converter suggestion.
- A field an op kind doesn't take fails with `unknown_field` and a did-you-mean, instead of being ignored (lenient undo and redo replays skip this check).
- Update ops merge by key, and `null` removes a key (props, settings, meta, published ports). `updateInterface` also takes `replace: true`, which makes each side it's given (inputs, outputs) the whole set. Unpublishing a port disconnects its cables inside the component and on every instance, including reads of a layer instance's prop (`@chip_1.label`), and the inverse restores them. An output declared again without `link` keeps its cable; `link: null` disconnects it.
- A batch may replace an item under its id (remove, then add); ids removed by earlier batches are retired (§3.2).

Op kinds (see `Op` in `packages/core/src/types.ts`): `addLayer, updateLayer, moveLayer, removeLayer, addPatch, updatePatch, removePatch, setInput, connect, disconnect, rename, addComment, updateComment, removeComment, addComponent, removeComponent, createComponent, updateInterface, updateComponent, setNodePositions, setScript, addAsset, removeAsset, setProject`. There is no separate layer-prop op: `setInput` and `connect` accept `@layer.prop` addresses.

- `setNodePositions { positions: { "@layerId" | "$in" | "$out": [x, y] | null } }` merges graph node positions entry by entry (rounded to whole points; `null` returns a node to automatic placement), and its inverse touches only the named keys. `updateComponent` refuses a `meta.patchEditor` object that would drop or move saved positions (`meta_conflict`); `patchEditor: null` still clears it.
- An `addPatch` without `ui` goes one column right of the rightmost patch: its drawn width plus 72 pt.

Errors are `{ code, message, hint, address, opIndex, suggestions: [{ description, ops }] }` and are written for humans first. Links may also read layer outputs or props: `{ "link": "@layerId.key" }`.

**History.** Every committed batch is one undo group `{ label, author: { kind: "human" | "agent", name }, ops, inverse, revision }`. Undo applies the inverse. The history panel shows agent groups ("Claude: added press animation (12 ops)"). Soft deletes go to a session trash.
- A reload of outside changes is its own undo group ("Outside Sonobe: Reloaded from disk"). Undoing past it restores the document older groups were recorded against, and redo restores the reloaded version exactly, so undo then redo never reverts outside changes.
- An agent's undo checks the human-edit guard in the same step it undoes (in the editor, not across RPCs).

**Outside changes.** Other writers share project folders (the app, git, a person, `sonobe mcp --headless`).
- The app reloads outside changes when clean. With unsaved edits it holds them (`externalChange`) and Save refuses with `disk_changed` until the person keeps their edits or reloads. Changes reported during a save or open are checked once it finishes. A file that no longer parses sets `diskProblem` and marks the document as having something to save.
- The headless host remembers the files as it last read or wrote them. `save_document` (and autosave) refuse with `disk_changed` when the folder changed since, and only delete stale files the session loaded or wrote. `save_document({ force: true })` writes over the outside changes but still never deletes files the session didn't know; `open_document({ ref, reload: true })` loads the version on disk.

### 3.6 Diagnostics

`getDiagnostics(doc, registry)` is a pure pass that returns `{ code, severity, message, itemIds, port?, suggestions }`. It checks:
- unknown types or ports
- invalid links and type mismatches
- zero-latency self-cycles
- a pulse wired into a state input ("did you mean a Switch?")
- loop length mismatches (warning)
- unreachable or unused patches (info)
- published inputs nothing inside the component reads (`unused_input`, info) and outputs nothing inside drives (`unconnected_output`, info)
- a cable that reads an instance's output its component doesn't drive (`undriven_output`, warning, on the component holding the cable)
- missing assets
- a layer that can't receive touches because it has opacity 0 or is disabled
- variables: an unnamed broadcaster, broadcasters that share a name, scope, and type, and a variable nothing reads (info)
- layers in a patch component, which is never drawn (ops refuse to add them)

Messages name items the way the editor shows them ("Photo Scale" (Transition)); ids stay in `itemIds` and suggestion ops.

Hosts that diagnose every revision use `createDiagnosticsCache(registry)`. It returns exactly what `getDiagnostics` would, but re-checks only components that changed (or that show a changed component), and inside a changed component only the inputs and layer properties whose literal values changed. A scrub or a drag at 1,000 patches costs well under a millisecond.

---

## 4. Values, types, loops, pulses

Value types (`ValueType`):

`number, boolean, pulse, text, color, point, point3d, point4d, size, anchor, index, enum, json, layer, image, video, sound, gradient, shape, textStyle, layerEffect, transform, connection, any`

- A `point4d` subtype covers edges and corner radii.
- `connection` is an opaque runtime handle from patches like WebSocket Connection. It has no literal value.
- `progress` is a `number` with a hint.

Runtime representation:
- number/index → `number`
- boolean/pulse → `boolean`
- text → `string`
- color → `{ r, g, b, a }` in 0–1
- vectors → `number[]`
- enum → string key
- json → unknown
- layer → `{ layerId, instance? }`
- media → `{ assetId | url }`

**Loops.** Any port value may be a `Loop<T>` (an array tagged as a loop).
- A patch fed loops evaluates once per index.
- Output length is the **max** of the input loop lengths. Shorter loops **wrap** (index mod len), and scalars broadcast.
- **An empty loop wins.** When any per-item input holds an empty loop, the patch runs 0 times and its outputs are empty loops, and a layer or component bound to one makes 0 copies, whatever the other loops hold. That's how a list filtered to nothing hides its rows. Whole-loop ports (`wholeLoop`) don't count toward this. The one exception is a value read from last frame (§5.2).
- Layers bound to looped values replicate, one instance per index.
- Stateful patches keep **per-index state**.
- Loops are capped at 10,000 elements with a diagnostic.

**Pulses.** A pulse is `true` for exactly one frame.
- A pulse input fires on an upstream pulse, **or** on a rising edge when a boolean state is wired into it.
- Pulses may fire on consecutive frames (Origami v187 semantics).

**Coercion** (applied at connect time and shown as a glyph on the wire):
- number ↔ boolean (`> 0`)
- number → any vector (broadcast)
- vector → number (first component)
- number ↔ text (format/parse)
- color ↔ point4d
- boolean → pulse (rising edge)
- json → any (best-effort parse)

Anything else is an invalid link, and the error suggests a converter patch.

---

## 5. Engine (`@sonobe/engine`)

### 5.1 Frame pipeline

```
input events (pointer/keyboard/device) ─┐
                                        ▼
  1. gesture recognition   (uses previous frame's layout for hit tests)
  2. patch evaluation      (topological order; back-edges read previous frame)
  3. layer prop resolution (literal or linked; loop replication)
  4. layout                (flex-lite rows/columns/grid, auto/percent/grow sizing, text measure)
  5. SceneFrame emit       (nested nodes in document order, with world transforms)
  6. layer-derived outputs (Layer Info, content sizes) become readable on the NEXT frame
```

### 5.2 Evaluation rules

- Values flow left → right. An input has ≤1 driver, and an output fans out to many.
- v1 evaluates every patch every frame, in topological order. This is correct and simple; add dirty tracking only when profiling demands it. Patches may declare `alwaysEvaluate` for documentation.
- **Cycles.** Back-edges are allowed and read the previous frame's value (one frame of latency). Direct self-edges are rejected. `delay1` is the documented feedback primitive.
- **Frame 0.** Evaluate with the authored values. "Previous-frame" patches (velocity, delay1, pulseOnChange, smoothValue) seed their history with the first value, so there are no startup spikes or false pulses. A back-edge has no previous frame yet, so it reads the input's default: on a back-edge `delay1` outputs one value on frame 0, even when the cycle carries a loop.
- **Empty loops across frames.** Last frame's empty loop never erases this frame's copies, so a cycle that goes empty for a frame refills instead of staying empty for good:
  - A back-edge that carries an empty loop into a per-item input reads as the input's default ("no value yet", like frame 0). A whole-loop input still reads the empty loop.
  - A component's copy count skips an empty loop it reads through a back-edge.
  - A layer that drew 0 copies last frame reads, for per-item readers (Interaction, Drag, a layer property), as one reference or its unreplicated output, exactly as before the first frame. Hit tests on it miss, so an Interaction on it runs once and stays idle. Whole-loop readers like Loop Count still see an empty loop.
  - Within a frame the rule above holds: an empty loop wins.
- **`empty_loop` warning.** When a layer or component makes 0 copies because an empty loop erased a non-empty one, or because a patch explained its empty output (`PatchContext.explainEmpty`, used by Loop Select for indices past the end), the runtime raises a warning that names the layer or component, where the empty loop started, what it erased, and any feedback cable involved, with a hint and ready-to-apply suggestions. Lists that are simply empty stay quiet. The warning lasts while the site has 0 copies, clears on `updateDocument`, and after frame 0 needs two frames in a row, so a list on its way to empty doesn't raise it. Only frames that look wrong pay for following the trail.
- **Same-frame precedence.**
  - Switch: turnOff > turnOn > flip.
  - Counter: jump > (increase − decrease).
- **Time.** In the real-time viewer, `dt` comes from requestAnimationFrame, capped at 64 ms. In simulation, `dt` is fixed at 1/60 s (or 1/120 s). Physics integrates at 1 ms RK4 substeps regardless.

### 5.3 Physics

- **Pop Animation / Rebound spring.** Uses Rebound's `BouncyConversion` (bounciness, speed) → Origami tension/friction → `OrigamiValueConverter` → k and c, with mass 1. Integration is RK4 at 1 ms substeps.
  - Rest threshold: 0.001 on displacement and velocity.
  - **Retargeting preserves velocity.**
  - Exact formulas are in `docs/research/semantics.md` §7.
- **Spring Animation.** Mass/tension/friction plus gesture velocity handoff.
- **Converters.** Response/damping-fraction ↔ tension/friction ↔ bounciness/speed.
- **Perceptual presets** in the UI: *Smooth, Snappy, Bouncy, Gentle*. Each maps to exact parameters and shows live code for handoff.
- **Classic Animation.** Duration plus a Penner curve. A retarget restarts from the current value over the full duration.
- **Momentum.** POP decay (0.998 per ms normal, 0.99 fast), a rubber band outside the bounds, and end bound default 99999.

### 5.4 Coordinates and layout

- **Position** is the layer's **anchor point** measured from the parent's top-left, in points, Y down.
- **Anchor** defaults to `[0, 0]` (top-left, like Figma), and pivot defaults to `[0.5, 0.5]`. This is designer-friendly and differs from Origami; importers convert.
- Groups and artboards may enable **layout**: `none | row | column | grid`, with spacing, padding, and 9-point alignment.
  - Child sizing: `fixed | auto | grow | percent`.
  - Child positioning: `relative | absolute`.
  - Padding insets only the layout flow. Children in the flow sit inside it, and their `percent` and `grow` sizes are shares of the space inside it (the content box). Children placed by Position (absolute children, and every child of a group without layout) measure Position from the parent's top-left and size `percent` and `grow` from the parent's full size, padding included. This is CSS's rule for absolutely positioned children (the padding box), so 100% × 100% at 0, 0 covers the parent exactly.
- The engine owns layout (headless and deterministic). Text measurement is injected (`TextMeasurer`): the DOM measures with canvas, and headless mode uses approximate metrics.

### 5.5 Hit testing and gestures

- Hit tests run front → back in paint order: among siblings, a higher `zPosition` is in front, and equal values keep layer order (later is in front). zPosition only reorders siblings, never lifting a layer out of its group. One function, `paintOrder`, sets this order for the hit test, both renderers, the cursor and the editor canvas, so what draws in front is what gets the touch.
- A layer receives touches only if it is enabled, has opacity > 0, and has `hitTest !== false`.
- Touches bubble to ancestors. Layers may declare `hitSlop`.
- Tap fires on touch-up if the touch moved < 10 pt. On that frame, `position` still holds the last touch position (a documented deviation from Origami, where it resets first).
- Long press = held and stationary (10 pt slop) for the duration.
- Recognizers: interaction (down/tap/position/localPosition/force), gesture (down/tap/position/translation/velocity/startPosition/localPosition), drag (position/dragging/velocity), scroll/momentum, swipe, hover, keyboard, mouse, trackpad, device motion (player only). Finger speed comes from gesture or drag; interaction has no velocity.

### 5.6 Runtime API

```ts
const rt = createRuntime(doc, { registry, textMeasurer, seed, fps });
rt.dispatch(events);                         // InputEvent[]
const frame: SceneFrame = rt.step(dtSeconds); // advance one frame
rt.getValue("pop.output"); rt.getValue("@card.scale");
rt.inspect("@card.position#3")               // { value, copies?, note? }: why a value reads as nothing
rt.trace(targets, durationMs, events?)       // columnar samples + summaries
rt.updateDocument(nextDoc)                   // hot-swap graph, keep compatible state
rt.issues()                                  // RuntimeIssue[]: code, severity, message, ids, hint?, suggestions?
```

- `inspect` notes say that a layer drew 0 copies (quoting its `empty_loop` warning), that `#n` is past the end, that an instance path runs into a component with 0 copies, or why a value is an empty loop. sim_get_values prints them after the values. Other read-outs about a value (copy counts, simulation overrides) belong in the same accessor and the same notes, not a second mechanism.

- `updateDocument` patches literal-only edits (input and property literals, patch positions outside cycles) into the compiled graph in place, and recompiles for anything else.
- `trace` replays the input log since the last restart. Past its budget (7,200 frames) it throws `TraceUnavailableError` instead of tracing a restarted copy.
- Scene node props inherit their layer's defaults. Copy them with `plainSceneFrame` before JSON or structured clone.

---

## 6. Patch library (`@sonobe/patches`)

Each patch is a catalog entry plus one module.

**The catalog entry** in `packages/patches/catalog/<category>-<n>.json` is where the patch is declared once: type, name, category, tier, aliases, summary, docs, behavior, inputs, outputs, variants, examples, pairsWellWith and the Origami mapping, following `catalog/CONVENTIONS.md`. An abridged entry from `catalog/state-1.json`:

```jsonc
{
  "type": "switch",                       // stable camelCase id
  "name": "Switch",
  "category": "state",
  "tier": 1,
  "summary": "Remembers whether something is on or off and changes when it gets a pulse.",
  "inputs": [
    { "key": "flip", "name": "Flip", "type": "pulse" /* default, description, … */ },
    { "key": "turnOn", "name": "Turn On", "type": "pulse" },
    { "key": "turnOff", "name": "Turn Off", "type": "pulse" }
  ],
  "outputs": [{ "key": "on", "name": "On", "type": "boolean" }]
  // aliases, docs, behavior, examples, pairsWellWith, origami, …
}
```

**The module** in `packages/patches/src/<category>/<type>.ts` attaches the evaluator by type string. From `src/state/switch.ts`:

```ts
export const switchPatch = definePatch<SwitchState>("switch", {
  state: () => ({ on: false }),
  evaluate(ctx) {
    const pulsed = firstPulsed(ctx, PRECEDENCE);
    if (pulsed === "turnOff") ctx.state.on = false;
    else if (pulsed === "turnOn") ctx.state.on = true;
    else if (pulsed === "flip") ctx.state.on = !ctx.state.on;
    ctx.output("on", ctx.state.on);
  },
});
```

- `definePatch(type, implementation)` merges the implementation into the catalog spec for `type`. It throws when `type` isn't a catalog patch type string.
- The implementation holds `evaluate` plus the optional `state` (per instance × loop index), `dispose`, `dynamicPorts` and `mutedBehavior`. Ports, docs, aliases and the Origami mapping always come from the catalog.
- [CONTRIBUTING.md](CONTRIBUTING.md) ("Adding or fixing a patch") has the steps.

- **Tier 1** (MVP, the ISAT core plus the most common): interaction, switch, counter, pulse, delay, wait, popAnimation, springAnimation, classicAnimation, transition, progress, reverseProgress, optionSwitch, optionPicker, math, logic, comparison, loops, text, color, point pack/unpack, velocity, smoothValue, time, whenPrototypeStarts, drag, scroll, hover, keyboard, variables, and javascript.
- **Tier 2:** data/JSON, network, sound, device info and motion, random, formatting, the remaining loops.
- **Tier 3:** camera, detection, and hardware. These are implemented where the web platform allows and are otherwise declared with `platforms`.

---

## 7. Layers

Layer types are declared in `@sonobe/core` (`layerTypes.ts`) with typed props (key, type, default, animatable, category). They are rendered by `@sonobe/renderer`.

**v1 layer types:** `group, rectangle, oval, text, image, video, shape, gradient, colorFill, hitArea, scroll? (no, scroll is a patch), textField, lottie, shader, clone, componentInstance`.

**Common props:** `enabled, position, size, anchor, pivot, opacity, scale, rotation (point3d), zPosition, cornerRadius, cornerSmoothing, color/fill, stroke, shadow (color, opacity, radius, offset), blur, blendMode, clip, layout (group), sizing, hitSlop`.

---

## 8. Renderer (`@sonobe/renderer`)

- Draws a `SceneFrame` into the DOM:
  - absolutely positioned elements with `transform: matrix3d()`, border-radius, backgrounds and gradients, box-shadow, filters, mix-blend-mode, and overflow clip
  - text as DOM text
  - media as `<img>`/`<video>`
  - shapes as SVG paths
  - shader layers as WebGL2 canvases (GLSL ES 3.0 fragment shaders with ShaderToy-style uniforms)
- Keyed reconciliation. Only changed styles are written.
- Paint order (§5.5): the DOM keeps document order. When zPosition reorders siblings, they get `z-index` ranks inside their parent's body, which is set to `isolation: isolate` (the stage, for root layers). Ranks stay under the parent's stroke and inside the stage, so they never cover the device frame, and changing a zPosition never moves an element (focused text fields keep focus). The SVG renderer behind headless screenshots draws siblings in the same order.
- Captures pointer, keyboard, and wheel events and converts them to engine `InputEvent`s in prototype coordinates.
- Device frames are drawn with CSS (no bitmap bezels). Device presets carry screen size, scale, safe areas, and corner radius.

---

## 9. Editor (`apps/editor`)

- **Layout** (all panels resizable and collapsible):

  ```
  Toolbar
  Layers | Viewer | Canvas / Patch Editor (split) | Inspector
  Bottom HUD: Console · Diagnostics · AI Activity · Performance (live fps readout in the HUD bar)
  ```

  - Side drawers: **Learn** (lessons, recipes, patch docs) and **Assistant** (BYO API key).
- **Stack:** React 19, Zustand store holding `SonobeDocument` and editor state. All mutations go through `store.apply(ops, label)`, which wraps `applyOps` and history.
- **Patch editor** is built on `@xyflow/react` with custom node rendering:
  - Port colors by type, a distinct pulse glyph, a "×N" loop badge, and live values on hover.
  - A pulse "spark" animation along cables, and a glow for true state.
  - Links:
    - drag an output → input
    - dropping on empty canvas opens **link-drag search** filtered to compatible ports
    - shift-click to fan out
    - **Ctrl+right-drag knife cut**
    - ⌘-drag (Ctrl-drag on Windows and Linux) a single patch onto a wire to splice it in; a port chooser opens when several inputs or outputs fit. A plain drag only moves the patch
    - Option-drag duplicates with its inputs
  - Adding patches:
    - **Patch picker**: double-click the canvas or ⌥⏎, type-to-search over names, aliases, and ports, docs pane, return inserts
    - single-key inserts on hover (I interaction, S switch, A pop, C classic, T transition, D delay, …)
  - Organization: **Tidy Up** (⌃T, elkjs), comments (frames), components (⌃⌘G), enter/exit component (double-click / ⌥↑).
    - Comment frames are sections. A node belongs to the innermost frame under its title bar. Tidy Up lays out each frame's nodes from the frame's top-left, refits the frame, lays out the unframed nodes where they were, and pushes frames that would overlap apart in reading order (one that started to the right of the other moves right, otherwise down). Frames otherwise stay where they are.
    - Scope follows the selection: selected comments tidy inside those frames, two or more selected nodes tidy within their own frames, nothing selected tidies everything. A comment's menu has **Tidy Up Frame**; **Tidy Up and Arrange Frames** also lays the frames out as blocks. MCP `tidy_graph` runs the same `planTidy` (`@sonobe/core/graph`).
    - Node sizes come from one shape model in `@sonobe/core/graph` (`nodeShape.ts`, `nodeSize.ts`), which follows `patch-editor.css`. The editor measures text with a canvas in its own fonts. Headless callers use a generated SF Pro and SF Mono table (`nodeMetrics.ts`, `apps/editor/scripts/measure-node-fonts.ts`) plus the live values of a deterministic runtime. Layer and interface nodes are placed automatically from measured sizes.
- **Layer ↔ patch bridges:**
  - the **Touch** button on a layer row inserts pre-wired interactions
  - clicking an inspector property creates a property link target
  - drag a cable onto an inspector property or a layer row
- **Inspector:** scrubbable number fields (drag, arrows ±1, ⇧ ±10, ⌥ ±0.1), color picker, segmented controls, and spring presets with a curve preview.
- **Canvas:** artboard with direct manipulation (select, move, resize, rotate), rulers and snapping, insert shapes and text.
- **Viewer:** live prototype, device picker, restart ⌘R, frame toggle, 1:1, "show hit targets", and pop-out window. Also serves a LAN web player (QR code), which the Sonobe Viewer iPhone app opens with native haptics (§9.2). While the prototype has an `empty_loop` warning, a notice above it names what has no copies, and Why? opens the warning in Diagnostics.
- **Command palette** (⌘K) lists every command with its shortcut, so the app is discoverable.

### 9.1 Desktop host conventions

- The editor detects the desktop with `window.sonobeHost` (`apps/desktop/electron/host-api.d.ts`). Without it, the editor runs in the browser with an in-memory or File System Access fallback.
- **RPC.** Main calls into the live document with `createRendererRpcHub().invoke(webContents, method, params)`.
  - Renderer handlers are registered with `sonobeHost.rpc.handle(method, fn)`.
  - Handlers report errors by returning `sonobeHost.rpc.fail(code, message, data)`, because the context bridge strips Error properties.
  - `document.save` is reserved for the unsaved-changes prompt.
- **Menus and clipboard.** Menu commands arrive through `sonobeHost.onCommand(id)`. Cut, Copy, and Paste are native roles, so the editor handles DOM `copy`/`cut`/`paste` events.
- **Env switches** read by the desktop main process (`apps/desktop/electron/env.ts`): `SONOBE_DEV_URL`, `SONOBE_MUTE`, `SONOBE_MCP_PORT`, `SONOBE_MCP`, `SONOBE_HOME`, `SONOBE_USER_DATA`, `SONOBE_EDITOR_DIST`, `SONOBE_TEST`, `SONOBE_LAN` (start the phone preview server at launch) and `SONOBE_LAN_PORT` (a fixed phone preview port).
- Two switches are read elsewhere: `SONOBE_GUIDES_DIR` overrides the MCP agent guides folder (`packages/mcp/src/guides.ts`, used by bundles), and `SONOBE_NODE` picks the Node binary for the packaged `sonobe` CLI launcher (`apps/desktop/scripts/build.mjs`), which otherwise uses the app's own runtime.
- **Connect Claude** reads `getMcpStatus().cliPath`, the app's bundled CLI launcher (`Resources/cli/sonobe`, `sonobe.cmd` on Windows), so the setup it shows uses a full path instead of a `sonobe` on PATH.

### 9.2 Web player and Sonobe Viewer

The web player (`apps/desktop/player`) runs the real engine and DOM renderer full screen. The LAN preview server (`electron/lan-preview.ts`) serves it for Preview on Phone and for the pop-out viewer window, and streams each new revision over a one-way WebSocket, which hot-swaps it into the running prototype.

- **Platform services.** `playerPlatform(window)` (`player/platform.ts`) gives the runtime `vibrate` where the browser has `navigator.vibrate` (Android), and `haptic` plus `vibrate` from a native host when one announces itself. The player doesn't have the editor viewer's other services yet (sound, speech, network requests, open URL; `createBrowserPlatform` in `apps/editor/src/runtime/platform.ts`).
- **Sonobe Viewer** (`apps/ios`) is a SwiftUI app with a full-screen WKWebView on the player URL. It accepts only preview links (`http(s)://<host>:<port>/p/<token>/`, from a QR scan, a paste, `sonobe-viewer://open?url=<link>`, or the `-SonobePlayerURL` launch argument), keeps navigation on that origin, and opens other links in Safari. `NSAllowsLocalNetworking` lets it load the plain-http LAN URL. It has no renderer of its own: everything a prototype does reaches the phone through the web player.
- **The bridge** is one-way, from the page to the app:
  - At document start the app defines a read-only `window.sonobeNative = { version: 1, platform: "ios", haptics: string[], vibrate: boolean }`, where `haptics` lists the Haptic Type keys the device can play.
  - The page posts `{ kind: "haptic", type, pattern? }` (`pattern` is Custom Pattern's AHAP JSON) or `{ kind: "vibrate", pattern }` (milliseconds as a number or an on/off list; 0 or `[]` stops) to `window.webkit.messageHandlers.sonobe`.
  - `haptic.supports(type)` is "the type is in `haptics`", so Haptic's Available output stays driven by the catalog's Type keys. The player ignores a malformed announcement.
  - The app plays messages only from the main frame on the preview's origin, ignores unknown kinds and types, and caps a vibration at 10 s. UIFeedbackGenerator plays the Haptic types; Core Haptics plays AHAP as is and turns vibrate patterns into continuous events. The app logs each one under the `dev.sonobe.viewer` subsystem, which `npm run test:ios` reads.
- **Signing.** `apps/ios/Config/Base.xcconfig` holds the shared settings and includes an ignored `Local.xcconfig` with the developer's team and bundle id. Simulator builds pass `CODE_SIGNING_ALLOWED=NO`.
- **Limits.** Frame pacing is WKWebView's, likely 60 Hz on ProMotion iPhones. Nothing in CI builds the app.

---

## 10. AI integration (`@sonobe/mcp`)

**Bring your own Claude subscription = MCP.**
- Users connect Claude Desktop or Claude Code (signed in with their own plan) to Sonobe's MCP server.
- Sonobe never offers claude.ai login, never reads Claude credentials, and never drives a user's subscription headlessly.
- An optional in-app assistant uses the user's own Anthropic API key only.

**Topology.**
- Electron main hosts Streamable HTTP MCP at `http://127.0.0.1:<port>/mcp`. It validates Host/Origin and requires a bearer token.
- The port and token are written to `~/.sonobe/mcp.json` (0600).
- `sonobe mcp` (the CLI) is a stdio relay to the running app. With `--headless <project>`, it serves a project folder without the app: ops, simulation, save, and screenshots drawn from the SceneFrame (SVG rasterized to PNG with `@resvg/resvg-js`, approximate text metrics, placeholders for video, Lottie and shaders). Headless mode has no editor selection and no canvas or graph capture targets.
- Tool handlers run against `SonobeHost`:

  ```ts
  interface SonobeHost {
    listDocuments(); openDocument(ref, { reload, ...control }); createDocument(request, control?); getDocument(docId?);
    saveDocument(docId?, { force, ...control }); apply(ops, { label, author, dryRun, expectedRevision, signal });
    getSelection(); screenshot(target, opts); reveal(ids); setWorking(ids, intent | null);
    captureDesign?(request, control?); fetchImage?(url, signal); putAssetFiles?(files, { docId, ...control });   // design import (§13)
    sim: { reset(opts); dispatch(simId, events); step(simId, opts); trace(simId, opts); values(simId, targets); override(simId, request) };
    history: { list(opts); undo({ txnId, signal }); };
  }
  // control = { signal?, progress?(step) }: the trailing argument of calls that can run long.
  // Requests stay plain data, because the desktop sends them over IPC.
  ```

**Tools** (annotated readOnly/destructive; every write returns deltas, ids, and diagnostics):

| Group | Tools |
|---|---|
| Discovery | `get_guide`, `list_patch_types`, `describe_patch_types`, `describe_layer_types`, `list_value_types` |
| Documents | `list_documents`, `open_document`, `create_document`, `get_document_info`, `save_document` |
| Read | `get_outline` (compact text projection), `get_layers`, `get_patches`, `get_items`, `find`, `get_selection`, `get_diagnostics`, `explain` |
| Write | `apply_ops`, `add_layers`, `add_patches`, `connect`, `set_values`, `update_layers`, `delete_items`, `rename`, `create_component`, `tidy_graph`, `import_design` |
| Simulate | `sim_reset`, `sim_dispatch`, `sim_step`, `sim_trace`, `sim_get_values`, `sim_override`, `get_screenshot` |
| Presence and history | `begin_work`, `finish_work`, `reveal`, `list_history`, `undo` |

- **Graph layout.** `tidy_graph` runs the editor's frame-aware Tidy Up (§9) with ELK: `frames` tidies inside those comments, `ids` tidies some nodes within their frames, and `frameMode: "arrange"` moves frames as blocks. Its result says which frames grew or were pushed and which nodes overlapped before. `add_patches` sizes its columns by how wide each patch draws and places them in free space clear of frames. Node sizes are estimated as the editor draws them (`packages/mcp/src/geometry.ts`: the shared shape model plus a deterministic runtime's live values after a second).
- **Graph node positions.** `get_outline` detail `full` shows `node=x,y` (or `node=auto`) on layers that have a graph node and a `nodes $in=… $out=…` line; `get_items` shows a layer's graph node. Agents move these nodes with `setNodePositions`.
- **Simulation overrides** (`sim_override`) are ordinary value ops (setInput, connect, disconnect, layer props, mute) that a session applies to its own copy of the document with `applyOps`, re-derived on every new revision. They never enter history, the live viewer or disk. `get_screenshot` with `isolate: true` draws one layer's subtree from the SceneFrame, on both hosts.
- **Runtime problems reach agents two ways.** sim_* results list the issues a simulation raised since the last call (with hints and suggestions), and in the app `get_diagnostics` adds a Live viewer section: what the person's running prototype reports right now, read through the `viewer.diagnostics` RPC because it changes without a new revision. The headless host has no live viewer and leaves the section out.
- **Resources:** guides, patch reference, document outline.
- **Prompts:** `import_screen`, `prototype_interaction`, `debug_interaction`, `explain_prototype`.

**Long calls: progress and cancellation** (`progress.ts`). Every tool handler gets a `ToolWork` as its third argument, `(args, ctx, work)`.
- **Progress.** When the client sends a `progressToken`, `work.step(message, fn, { deadlineMs })` and `work.progress(step)` send `notifications/progress`: `progress` counts the notifications, and the message says where the call is ("Downloading images: 7 of 28"). Stage messages go out at once and count updates at most every 250 ms. Nothing is sent without a token, after a cancel, or after the result.
- **Heartbeats.** While a step runs, its latest message repeats every 10 s, but only until the step's deadline, so a hung step goes quiet instead of looking alive. Progress resets Claude Code's idle watchdog; SSE keep-alives don't.
- **One signal.** `work.signal` aborts on `notifications/cancelled`, a closed HTTP stream or a closed transport. Over stdio the SDK's `ctx.mcpReq.signal` sees all three. Stateless HTTP needs more, so `createHttpHandler`:
  - parses POST bodies itself, so the SDK never clones the web `Request`. After a garbage collection, a cloned Request's signal stops following the original, so the SDK's own disconnect abort was lost.
  - holds its own AbortController per request, aborted when the response closes before it finished.
  - routes a 2025-era `notifications/cancelled`, which arrives on a POST of its own at a fresh server, to the call it names, but only when exactly one call in flight has that request id.
  - streams every 2026-07-28 response from its first byte (`responseMode: "sse"`, keep-alive every 10 s), so a silent call gets its headers at once.
- **A cancelled call never changes the document.** `work.step` rejects as soon as the call is cancelled, even when the host never settles, and aborts the host's `control.signal`. `host.apply` and `history.undo` refuse once their `signal` has aborted. An apply that has already started finishes. Steps that can't be taken back (open, create, save) wait for the host instead of claiming nothing changed.
- **Host methods that can run long** take a trailing `control`: `{ signal, progress(step) }`. They stop and free what they hold when the signal aborts, and report stages through `progress`.
- **Deadlines.** Hosts own the precise limits. `captureDesign` has one deadline (§13) and names the stage it stopped in. The tool's own step deadline is 60 s longer, only as a safety net, so the host's error arrives first.
- **The relay** forwards SSE progress, turns a `notifications/cancelled` on stdin into an aborted request (the app sees the stream close), aborts calls still running when stdin closes, and tells a 5-minute fetch timeout apart from a lost connection.
- **Clients.** A hand-written SDK client must pass `onprogress` together with `resetTimeoutOnProgress`. Without `onprogress` it sends no `progressToken`, so the server can't report progress and the client's default 60 s timeout still applies.
- **Distribution:** Claude Code plugin (`integrations/claude-code`) and `.mcpb` bundle (`integrations/claude-desktop`), both built from a checkout. The app's **Connect Claude** screen shows copy-paste setup for Claude Code and Claude Desktop, filled in for this machine (the app's bundled CLI, or Node plus a checkout). In a source checkout it also shows the commands that build and pack the `.mcpb`.

**Outline projection** (token-lean, read-only):

```
component main "Main" (prototype) 390x844
layer card rectangle "Card" @16,120 358x220 scale←grow.output
  layer title text "Title" "Popular Events"
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on bounciness=5 speed=10
patch grow transition<number> progress←pop.output start=1 end=1.08
```

---

## 11. Learnability

- **Generated reference.** Every patch has summary, behavior, ports, examples, "pairs well with", and common mistakes. The same content serves the patch picker, hover docs, `describe_patch_types`, and `docs/patches/`.
- **Concept guides** (short, visual): ISAT (Interaction → Switch → Animation → Transition), states vs pulses, loops, coordinates and layout, springs and feel, components, debugging taps.
- **Recipes:** 15+ canonical prototypes (tap to zoom, toggle/like, scrolling list, carousel, tab bar, collapsing header, pull to refresh, bottom sheet, drag and snap, swipe cards, long-press menu, timed sequence, stories, onboarding, grid with loops). Each has a runnable example project and step-by-step text.
- **In-app lessons:** step-by-step with validation that checks document state through the same queries the MCP uses.
- **Explain:** a deterministic plain-language description of any graph selection, at three audience levels.
- **Visibility:** pulse sparks, state glow, loop badges, live values, spring curve previews, a "show hit targets" overlay, and diagnostics that suggest fixes.

---

## 12. Quality gates

- `npm run typecheck`: tsc across all packages.
- `npm test`: Vitest. Golden tests cover spring curves against the Rebound formulas, pulse and loop semantics, ops/inverse round-trips, and canonical serialization stability.
- `npm run e2e`: Playwright (Chromium project only) against the editor served by Vite on port 5199, with screenshot artifacts. This is what CI runs.
- `npm run smoke -w @sonobe/desktop`: the muted Electron end-to-end run (`apps/desktop/tests/smoke.mjs`, Playwright `_electron`) covering the host API, the MCP loop, the phone preview and the pop-out viewer. It builds the shell and editor, runs by hand, and isn't part of `npm run e2e` or CI. `SONOBE_SMOKE_SKIP_EDITOR_BUILD=1` reuses `apps/editor/dist`.
- `npm run test:ios`: Sonobe Viewer's Swift unit tests and UI tests on an iOS Simulator (`apps/ios/scripts/test.mjs`), against the real web player and LAN preview server, followed by a check of the app's log for the haptics the UI test's taps played. It needs macOS with Xcode, runs by hand, and isn't part of `npm run e2e` or CI. The player's side of the bridge runs in `npm test` (`apps/desktop/player/*.test.ts`; `player.browser.test.ts` drives mobile Chromium and skips without Playwright's browser).
- Examples must load, validate with zero errors, and simulate their scripted interactions (`examples/*/test.json`).
- Automated app and QA runs are muted (`--mute-audio`).

---

## 13. Design import (`@sonobe/import`)

People prototype with their real screens instead of redrawing them. Every source produces a **design capture**, and one converter turns captures into ops.

```
 a URL (the person's dev server) ─┐                                   ┌─▶ addAsset (content-addressed images)
 HTML (pasted, or Claude from     ├─▶ render ─▶ DOM walker ─▶ capture ─┼─▶ addLayer (the screen as one tree)
   any codebase)                  │                                   └─▶ addPatch + connect (Scroll patches)
 a capture (paste, a plugin) ─────┘
```

- **Capture format** (`capture.ts`): JSON with `format: "sonobe.design-capture"`, `version: 1`, the viewport, a root frame, and images by key. Boxes are `[x, y, w, h]` in root coordinates (CSS pixels = points); colors are `#RRGGBBAA`. Nodes are `frame` (fill, gradients, background image, radii, per-side borders, shadows, clip, blur, `scroll` for scroll containers, `scrollContent` for a page's content), `text` (one style, `wraps`, `maxLines`), `image`, and `input`. `parseCapture` validates captures from outside with zod.
- **DOM walker** (`dom/walk.ts`): runs inside the rendered page and reads only layout and computed styles, so it works with any framework and CSS. It waits for load, a selector, fonts, images and a quiet DOM; resolves any CSS color through a canvas; collapses paintless wrappers; joins inline text into paragraphs positioned by their line boxes; serializes inline SVG with computed paint; captures absolutely positioned `::before`/`::after`; sorts siblings into CSS painting order; moves `position: fixed` elements to the screen level; collects the `@font-face` rules the captured text uses (re-fetching cross-origin sheets); and names nodes from `data-name`, React and Vue component names, `aria-label`, ids, icon classes and roles. Text takes the name a person gave the element holding it (`data-name`, `aria-label`, ids) over its words, but not a component, role or tag name, which every instance shares; a named inline element becomes a run of its own, and `<body data-name>` names the screen. `scripts/build-walker.ts` bundles it into `WALKER_SOURCE`, a string every host injects; a test keeps it in sync.
- **Figma** (`figma.ts`): `figmaToCapture(selection, { exportSvg, imageData })` maps structural Figma nodes (frames, instances, rectangles, circles, text, and vectors as SVG exports) onto the capture format; the plugin in `integrations/figma-plugin` supplies the plugin API and copies the result.
- **Converter** (`convert.ts`): `planImport(capture, doc, images, options)` returns the ops, the asset files to store first, the screen's ref, a summary and notes. Frames become groups (rectangles when empty, hit areas when they're only tap targets), uniform borders become strokes and other borders thin rectangles, gradients and background images become child layers, the largest outer shadow becomes the layer shadow (a spread-only ring becomes an outside stroke), single-line text hugs its text and grows from its alignment edge, and paragraphs keep their width. Identical image bytes reuse an existing asset. `replace` swaps an earlier screen in the same batch: layers found again at the same name path keep their ids and linked properties (text an earlier import named by its words is also found by its words), other items' connections to them are restored, the notes name every connection it had to drop, and content that already scrolls doesn't get a second Scroll patch. Web fonts become font assets whose `font` field (family, weight, style, unicode-range) the renderer's `createFontAssetRegistry` turns into FontFaces in the editor and the phone player.
- **Hosts**:
  - Desktop: `apps/desktop/electron/design-capture.ts` renders in a hidden window with its own session partition (sandboxed, no preload, no permissions, downloads and new windows refused, only http(s) navigations), injects the walker with `executeJavaScript` (outside the page's CSP), and downloads images with that session. `colorScheme` loads `about:blank` first, then sets `prefers-color-scheme` over the debugger: a new window has no renderer until it navigates, and CDP's Emulation commands wait for one. The debugger stays attached until cleanup, because detaching drops the emulation. `AppHost.captureDesign` serves `import_design`; `putAssetFiles` sends bytes to the editor over the `assets.put` RPC. The preload's `sonobeHost.captureDesign` serves the editor's Import Design dialog. The dialog passes a `captureId` to follow the capture (`onCaptureDesignProgress`) and to stop it (`cancelCaptureDesign`), since an AbortSignal can't cross the context bridge. Reloading or closing the editor window also stops its captures, and so does quitting the app.
  - Browser editor: HTML renders in a sandboxed iframe (`allow-scripts`, opaque origin) that posts the capture back; URLs need the desktop app.
  - Headless: `@sonobe/import/node` renders with Playwright's Chromium when it's installed, and writes new asset files straight into the project's `assets/` folder.
- **Deadlines and cleanup** (`run.ts`): `createCaptureRun` gives each capture one deadline, 90 s plus `waitMs`, and both hosts route every await through its `step`. Single steps have budgets too: loading 30 s, the color scheme 5 s, reading the layers 45 s plus `waitMs`, the screenshot 15 s. A step that would outrun the deadline gets the deadline's error instead, `capture_timeout`, which names the stage ("It stopped while reading the page's layers"). Images and fonts still downloading 5 s before the deadline become placeholders, and a screenshot that fails is left out. Both come back as notes, not failures. A cancel or the deadline destroys the capture window (or closes Playwright's browser) at once, which also ends a page stuck in a loop and settles debugger commands still waiting. Every path frees the window, and no debugger stays attached.
- **Front doors**: File → Import Design… (URL, HTML, or a Claude prompt), pasting a capture on the canvas, the `import_design` MCP tool (`url`, `html`, or `capture`), and the Chrome extension (`integrations/chrome-extension`: the service worker runs the walker in the tab's main world, embeds cross-origin images when the person allows it, and copies the capture; the element picker marks one element for the walker's `selector`). Each import is one history group.
- **Checks**: `packages/import/scripts/fidelity.ts` renders fixture pages, imports them, draws the document with the DOM renderer, and writes source, imported and difference images side by side. `apps/desktop/tests/import-smoke.mjs` runs the desktop path against a local dev server.

