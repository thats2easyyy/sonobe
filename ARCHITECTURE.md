# Sonobe Architecture

Sonobe is an open-source, AI-native desktop app for interaction prototyping. It works like Meta's Origami Studio: layers, patches, a viewer, and an inspector. It adds three things Origami doesn't have:

1. **AI-native by construction.** Every capability is a typed operation in a text-diffable document. The same operations are exposed to Claude over MCP.
2. **Learnable by construction.** Pulses and state are visible, errors teach, and every patch has generated docs, examples, and a plain-language "explain".
3. **Open and cross-platform.** MIT-licensed Electron app for macOS, Windows, and Linux, plus a web player for phones.

This document is the **contract** every contributor (human or agent) builds against. If code and this document disagree, fix one of them in the same PR.

Research that backs these decisions lives in `docs/research/`. Origami's docs are stale, so `docs/research/releases_verbatim.md` (release notes through v228) is the source of truth for "what Origami does today".

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
│   ├── mcp/        @sonobe/mcp      MCP tools over a SonobeHost interface, headless host, HTTP + stdio transports
│   └── cli/        @sonobe/cli      `sonobe` CLI: validate, fmt, run/sim, mcp relay, new, export
├── apps/
│   ├── editor/     React editor UI (Electron renderer process; also runs in a browser for dev/tests)
│   └── desktop/    Electron main + preload: windows, menus, file IO, MCP HTTP server, LAN preview server
├── integrations/
│   ├── claude-code/     Claude Code plugin (.mcp.json + skills)
│   └── claude-desktop/  .mcpb bundle manifest
├── examples/       canonical example prototypes (*.sonobe folders), used by docs, lessons, tests
└── docs/           research/, spec/, guides/ (concepts, recipes), patches/ (generated reference)
```

Dependency direction (no cycles): `core ← engine ← patches ← renderer ← editor ← desktop`, and `mcp ← cli`, where `mcp` depends on `core`, `engine`, and `patches`.

Tooling: TypeScript (strict, ESM), Vite 8 for the editor, esbuild for Electron main/preload and the CLI, Vitest for unit tests, Playwright for e2e (browser and `_electron`). Formatting uses Prettier defaults.

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
├── assets/assets.json      asset registry: id → {file, kind, name, width, height, sha256}
├── assets/<sha256>.<ext>   content-addressed media
└── .sonobe/session.json    per-user editor state (camera, selection, panel sizes). Gitignored.
```

Canonical serialization rules:
- UTF-8, LF line endings, 2-space indent, trailing newline.
- Keys in schema order; maps sorted by id.
- Short leaf objects stay on one line, so a connection change is a one-line diff.
- Numbers are rounded to 6 significant decimals, `-0` is written as `0`, and there are no volatile fields.

A `.sonobez` zip of the same layout is used for sharing (later).

### 3.2 Identifiers

- Ids are **readable, immutable slugs**: `^[A-Za-z_][A-Za-z0-9_]*$`. They are unique within a component across layers, patches, and comments.
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

Op kinds: `addLayer, updateLayer, moveLayer, removeLayer, addPatch, updatePatch, removePatch, connect, disconnect, setInput, setLayerProp, rename, addComment, updateComment, removeComment, createComponent, updateInterface, addScript, setScript, addAsset, removeAsset, setProject`.

Errors are `{ code, message, hint, path, suggestions: [{ description, ops }] }` and are written for humans first.

**History.** Every committed batch is one undo group `{ label, author: { kind: "human" | "agent", name }, ops, inverse, revision }`. Undo applies the inverse. The history panel shows agent groups ("Claude: added press animation (12 ops)"). Soft deletes go to a session trash.

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

---

## 4. Values, types, loops, pulses

Value types (`ValueType`):

`number, boolean, pulse, text, color, point, point3d, point4d, size, anchor, index, enum, json, layer, image, video, sound, gradient, shape, textStyle, layerEffect, transform, any`

- A `point4d` subtype covers edges and corner radii.
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
  5. SceneFrame emit       (flat, z-ordered render list with world transforms)
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
- The engine owns layout (headless and deterministic). Text measurement is injected (`TextMeasurer`): the DOM measures with canvas, and headless mode uses approximate metrics.

### 5.5 Hit testing and gestures

- Hit tests run front → back. A layer receives touches only if it is enabled, has opacity > 0, and has `hitTest !== false`.
- Touches bubble to ancestors. Layers may declare `hitSlop`.
- Tap fires on touch-up if the touch moved < 10 pt. On that frame, `position` still holds the last touch position (a documented deviation from Origami, where it resets first).
- Long press = held and stationary (10 pt slop) for the duration.
- Recognizers: interaction (down/tap/position/velocity), drag, scroll/momentum, swipe, hover, keyboard, mouse, trackpad, device motion (player only).

### 5.6 Runtime API

```ts
const rt = createRuntime(doc, { registry, textMeasurer, seed, fps });
rt.dispatch(events);                         // InputEvent[]
const frame: SceneFrame = rt.step(dtSeconds); // advance one frame
rt.getValue("pop.output"); rt.getValue("@card.scale");
rt.trace(targets, durationMs, events?)       // columnar samples + summaries
rt.updateDocument(nextDoc)                   // hot-swap graph, keep compatible state
```

---

## 6. Patch library (`@sonobe/patches`)

Each patch is one module:

```ts
export default definePatch({
  type: "popAnimation",                 // stable camelCase id
  name: "Pop Animation",
  category: "animation",
  aliases: ["spring", "bouncy", "pop"],
  summary: "Animates toward a target number with a spring defined by bounciness and speed.",
  docs: "...markdown: behavior, edge cases, tips, common mistakes...",
  inputs: [
    { key: "number", name: "Number", type: "number", default: 0, description: "Target value." },
    { key: "bounciness", name: "Bounciness", type: "number", default: 5, min: 0, description: "..." },
    { key: "speed", name: "Speed", type: "number", default: 10, min: 0, description: "..." },
  ],
  outputs: [{ key: "output", name: "Progress", type: "number", description: "Current animated value." }],
  variants: ["number", "point", "point3d", "color"],   // optional typeParam options
  state: () => ({ value: 0, velocity: 0 }),            // per instance × loop index
  evaluate(ctx) { /* read ctx.input(key), ctx.dt, ctx.state; ctx.output(key, v) */ },
  examples: [{ title: "Press to shrink", graph: "..." }],
  pairsWellWith: ["interaction", "switch", "transition"],
  origami: { id: "builtin.bouncy", name: "Pop Animation" },   // compatibility mapping (import)
});
```

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
- Captures pointer, keyboard, and wheel events and converts them to engine `InputEvent`s in prototype coordinates.
- Device frames are drawn with CSS (no bitmap bezels). Device presets carry screen size, scale, safe areas, and corner radius.

---

## 9. Editor (`apps/editor`)

- **Layout** (all panels resizable and collapsible):

  ```
  Toolbar
  Layers | Viewer | Canvas / Patch Editor (split) | Inspector
  Bottom HUD: Console · Diagnostics · AI Activity · FPS
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
    - drag a patch onto a wire to splice it in
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

---

## 10. AI integration (`@sonobe/mcp`)

**Bring your own Claude subscription = MCP.**
- Users connect Claude Desktop or Claude Code (signed in with their own plan) to Sonobe's MCP server.
- Sonobe never offers claude.ai login, never reads Claude credentials, and never drives a user's subscription headlessly.
- An optional in-app assistant uses the user's own Anthropic API key only.

**Topology.**
- Electron main hosts Streamable HTTP MCP at `http://127.0.0.1:<port>/mcp`. It validates Host/Origin and requires a bearer token.
- The port and token are written to `~/.sonobe/mcp.json` (0600).
- `sonobe mcp` (the CLI) is a stdio relay to the running app. With `--headless <project>`, it serves a project folder without the app (ops, simulation, and save; no screenshots).
- Tool handlers run against `SonobeHost`:

  ```ts
  interface SonobeHost {
    listDocuments(); openDocument(ref); getDocument(docId?); apply(ops, { label, author, dryRun, expectedRevision });
    getSelection(); screenshot(target, opts); reveal(ids); setWorking(ids, intent | null);
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
| Write | `apply_ops`, `add_layers`, `add_patches`, `connect`, `set_values`, `update_layers`, `delete_items`, `rename`, `create_component`, `tidy_graph` |
| Simulate | `sim_reset`, `sim_dispatch`, `sim_step`, `sim_trace`, `sim_get_values`, `get_screenshot` |
| Presence and history | `begin_work`, `finish_work`, `reveal`, `list_history`, `undo` |

- **Resources:** guides, patch reference, document outline.
- **Prompts:** `prototype_interaction`, `debug_interaction`, `explain_prototype`.
- **Distribution:** Claude Code plugin (`integrations/claude-code`) and `.mcpb` bundle (`integrations/claude-desktop`). The app's **Connect Claude** screen offers copy-paste and one-click setup.

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
- `npm run e2e`: Playwright against the editor in the browser plus an Electron smoke test, with screenshot artifacts.
- Examples must load, validate with zero errors, and simulate their scripted interactions (`examples/*/test.json`).
- Automated app and QA runs are muted (`--mute-audio`).
