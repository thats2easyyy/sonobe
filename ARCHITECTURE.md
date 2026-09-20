# Sonobe Architecture

Sonobe is an open-source, AI-native desktop app for interaction prototyping. It works like Meta's Origami Studio: layers, patches, a viewer, and an inspector. It adds three things Origami doesn't have:

1. **AI-native by construction.** Every capability is a typed operation in a text-diffable document. The same operations are exposed to Claude over MCP.
2. **Learnable by construction.** Pulses and state are visible, errors teach, and every patch has generated docs, examples, and a plain-language "explain".
3. **Open and cross-platform.** MIT-licensed Electron app for macOS, Windows, and Linux, plus a web player for phones.

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
│   │                                diagnostics, canonical serialization, migrations, outline projection
│   ├── engine/     @sonobe/engine   runtime: graph compile + frame evaluation, loops, pulses, per-index state,
│   │                                physics (springs, decay), layout, hit testing, gesture recognition
│   ├── patches/    @sonobe/patches  built-in patch library: definitions + evaluators + docs + examples
│   ├── renderer/   @sonobe/renderer DOM renderer for SceneFrame, pointer/keyboard capture, device frames
│   ├── import/     @sonobe/import   design capture format, DOM walker (reads a rendered page), capture → layers converter
│   ├── mcp/        @sonobe/mcp      MCP tools over a SonobeHost interface, headless host, HTTP + stdio transports
│   └── cli/        @sonobe/cli      `sonobe` CLI: new, validate, fmt, outline, describe, sim, mcp (stdio relay; --headless <dir>)
├── apps/
│   ├── editor/     React editor UI (Electron renderer process; also runs in a browser for dev/tests)
│   └── desktop/    Electron main + preload: windows, menus, file IO, MCP HTTP server, LAN preview server
├── integrations/
│   ├── claude-code/     Claude Code plugin (.mcp.json + skills)
│   ├── claude-desktop/  .mcpb bundle manifest
│   ├── chrome-extension/ Sonobe Capture for Chrome: copy a page or an element as a design capture
│   └── figma-plugin/    Sonobe Capture for Figma: copy a selection as a design capture
├── examples/       canonical example prototypes (*.sonobe folders), used by docs, lessons, tests
└── docs/           research/, guides/ (numbered tutorials), patches/ (generated reference), assets/ (README screenshots)
```

Dependency direction (no cycles): `core ← engine ← patches ← renderer ← editor ← desktop`, and `mcp ← cli`, where `mcp` depends on `core`, `engine`, and `patches`. `import` depends only on `core`; `mcp`, `editor`, and `desktop` use it.

Tooling: TypeScript (strict, ESM), Vite 8 for the editor, esbuild for Electron main/preload and the CLI, Vitest for unit tests, Playwright for e2e (Chromium via `npm run e2e`; `_electron` in the desktop smoke test and package verification). Formatting uses Prettier defaults.

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
- Renaming changes `name`, never `id`. Ids are never reused within a session.
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

Op kinds (see `Op` in `packages/core/src/types.ts`): `addLayer, updateLayer, moveLayer, removeLayer, addPatch, updatePatch, removePatch, setInput, connect, disconnect, rename, addComment, updateComment, removeComment, addComponent, removeComponent, createComponent, updateInterface, updateComponent, setScript, addAsset, removeAsset, setProject`. There is no separate layer-prop op: `setInput` and `connect` accept `@layer.prop` addresses.

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
- **Frame 0.** Evaluate with the authored values. "Previous-frame" patches (velocity, delay1, pulseOnChange, smoothValue) seed their history with the first value, so there are no startup spikes or false pulses.
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
rt.trace(targets, durationMs, events?)       // columnar samples + summaries
rt.updateDocument(nextDoc)                   // hot-swap graph, keep compatible state
```

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
- **Layer ↔ patch bridges:**
  - the **Touch** button on a layer row inserts pre-wired interactions
  - clicking an inspector property creates a property link target
  - drag a cable onto an inspector property or a layer row
- **Inspector:** scrubbable number fields (drag, arrows ±1, ⇧ ±10, ⌥ ±0.1), color picker, segmented controls, and spring presets with a curve preview.
- **Canvas:** artboard with direct manipulation (select, move, resize, rotate), rulers and snapping, insert shapes and text.
- **Viewer:** live prototype, device picker, restart ⌘R, frame toggle, 1:1, "show hit targets", and pop-out window. Also serves a LAN web player (QR code).
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
    listDocuments(); openDocument(ref); getDocument(docId?); apply(ops, { label, author, dryRun, expectedRevision });
    getSelection(); screenshot(target, opts); reveal(ids); setWorking(ids, intent | null);
    captureDesign?(request); fetchImage?(url, signal); putAssetFiles?(files, { docId });   // design import (§13)
    sim: { reset(opts); dispatch(simId, events); step(simId, opts); trace(simId, opts); values(simId, targets) };
    history: { list(opts); undo(txnId?); };
  }
  ```

**Tools** (annotated readOnly/destructive; every write returns deltas, ids, and diagnostics):

| Group | Tools |
|---|---|
| Discovery | `get_guide`, `list_patch_types`, `describe_patch_types`, `describe_layer_types`, `list_value_types` |
| Documents | `list_documents`, `open_document`, `create_document`, `get_document_info`, `save_document` |
| Read | `get_outline` (compact text projection), `get_layers`, `get_patches`, `get_items`, `find`, `get_selection`, `get_diagnostics`, `explain` |
| Write | `apply_ops`, `add_layers`, `add_patches`, `connect`, `set_values`, `update_layers`, `delete_items`, `rename`, `create_component`, `tidy_graph`, `import_design` |
| Simulate | `sim_reset`, `sim_dispatch`, `sim_step`, `sim_trace`, `sim_get_values`, `get_screenshot` |
| Presence and history | `begin_work`, `finish_work`, `reveal`, `list_history`, `undo` |

- **Resources:** guides, patch reference, document outline.
- **Prompts:** `import_screen`, `prototype_interaction`, `debug_interaction`, `explain_prototype`.
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
  - Desktop: `apps/desktop/electron/design-capture.ts` renders in a hidden window with its own session partition (sandboxed, no preload, no permissions, downloads and new windows refused, only http(s) navigations), injects the walker with `executeJavaScript` (outside the page's CSP), and downloads images with that session. `AppHost.captureDesign` serves `import_design`; `putAssetFiles` sends bytes to the editor over the `assets.put` RPC. The preload's `sonobeHost.captureDesign` serves the editor's Import Design dialog.
  - Browser editor: HTML renders in a sandboxed iframe (`allow-scripts`, opaque origin) that posts the capture back; URLs need the desktop app.
  - Headless: `@sonobe/import/node` renders with Playwright's Chromium when it's installed, and writes new asset files straight into the project's `assets/` folder.
- **Front doors**: File → Import Design… (URL, HTML, or a Claude prompt), pasting a capture on the canvas, the `import_design` MCP tool (`url`, `html`, or `capture`), and the Chrome extension (`integrations/chrome-extension`: the service worker runs the walker in the tab's main world, embeds cross-origin images when the person allows it, and copies the capture; the element picker marks one element for the walker's `selector`). Each import is one history group.
- **Checks**: `packages/import/scripts/fidelity.ts` renders fixture pages, imports them, draws the document with the DOM renderer, and writes source, imported and difference images side by side. `apps/desktop/tests/import-smoke.mjs` runs the desktop path against a local dev server.

