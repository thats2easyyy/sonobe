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
│   ├── renderer/   @sonobe/renderer DOM renderer for SceneFrame, pointer/keyboard capture, device frames,
│   │                                the browser's platform services for live prototypes (viewer and web player)
│   ├── import/     @sonobe/import   design capture format, DOM walker (reads a rendered page), capture → layers converter
│   ├── mcp/        @sonobe/mcp      MCP tools over a SonobeHost interface, headless host, HTTP + stdio transports
│   └── cli/        @sonobe/cli      `sonobe` CLI: new, validate, fmt, outline, describe, sim, mcp (stdio relay; --headless <dir>)
├── apps/
│   ├── editor/     React editor UI (Electron renderer process; also runs in a browser for dev/tests)
│   ├── desktop/    Electron main + preload: windows, menus, file IO, MCP HTTP server, LAN preview server,
│   │               the web player (player/) it serves to phones and the pop-out viewer, and the
│   │               sfsymbol helper (native/, Swift) that draws SF Symbols for design imports on macOS
│   └── ios/        Sonobe Viewer: an iPhone app (Swift, Xcode) that plays the web player with native haptics
├── integrations/
│   ├── claude-code/     Claude Code plugin (.mcp.json + skills)
│   ├── claude-desktop/  .mcpb bundle manifest
│   ├── chrome-extension/ Sonobe Capture for Chrome: copy a page or an element as a design capture
│   └── figma-plugin/    Sonobe Capture for Figma: copy a selection as a design capture
├── examples/       canonical example prototypes (*.sonobe folders), used by docs, lessons, tests and list_examples
├── evals/          behavioral evals: Claude Code builds each case through MCP, checked by simulation
├── .github/        workflows/ci.yml: the checks CI runs (§12)
└── docs/           research/, guides/ (numbered tutorials), patches/ (generated reference), assets/ (README screenshots)
```

Dependency direction (no cycles): `core ← engine ← patches ← renderer ← editor ← desktop`, and `mcp ← cli`, where `mcp` depends on `core`, `engine`, and `patches`, and bundles the examples registry (`examples/recipes`, which uses only `core`) for `list_examples`. `import` depends only on `core`; `mcp`, `editor`, and `desktop` use it.

Tooling: TypeScript (strict, ESM), Vite 8 for the editor, esbuild for Electron main/preload and the CLI, Vitest for unit tests, Playwright for e2e (Chromium via `npm run e2e`; `_electron` in the desktop smoke test and package verification). Formatting uses Prettier defaults. `apps/ios` is Swift and SwiftUI, built with Xcode, and isn't an npm workspace. The desktop build compiles `apps/desktop/native/sfsymbol` with `swiftc` on macOS.

---

## 3. Document model

### 3.1 On disk: a project folder

```
Checkout Flow.sonobe/
├── project.json            manifest: formatVersion, name, generator, device, root component id
├── knobs.json              knobs and presets (§3.3), only when the project has knobs
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
- Numbers keep their value: float noise within 1e-9 of the 6-decimal form is trimmed (`0.1 + 0.2` is written `0.3`), and any other number is written exactly, so `1/30` reads back as `1/30`. `-0` is written as `0`, and there are no volatile fields. The rule is idempotent, so a saved file passes `sonobe fmt --check`.
- Format versions count per file kind. `project.json` is format 2 when the project has knobs and format 1 otherwise, whatever the manifest in memory says, so a project without knobs still opens in builds that read format 1, and those builds refuse one with knobs ("saved by a newer version").

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
- Each host keeps the ids it has seen in an `IdLedger` (`createIdLedger`, passed to `applyOps` as `seenIds`) and observes every commit, undo and redo. Opening a document starts a new ledger; a reload continues it. It's never saved with the project, but drafts keep it (`seenIdsToJSON`), and restoring one merges it back (the `seenIds` option of the editor store's `replaceDocument`), so the session continues (§3.5 Drafts).
- Knob ids and preset ids follow the same rules in two project-wide namespaces of their own (the ledger's `knobs` and `presets`), apart from item ids.
- References:
  - a patch port: `patchId.portKey`
  - a layer property: `@layerId.propKey`
  - a knob's value: `$knob.knobId` (read-only, one value everywhere, never `#n`; `$knob` is reserved, like `$in` and `$out`)
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

**Knobs and presets** (`knobs.json`). A knob is a named value people tune: its type (`number`, `boolean`, `color`, `enum`, `point`, `text`), a soft range and unit (number and point) or options (enum), a group and a description. A preset is a column of knob values: every preset holds a value for every knob, `active` names the one that runs, and a `locked` preset refuses value edits. Any patch input or bindable layer property reads a knob through an ordinary link, `{ "link": "$knob.commit_distance" }`, with the usual link type rules; a published output can't. A knob-driven input behaves exactly like the literal it holds.

```jsonc
{
  "formatVersion": 1,
  "active": "proposal",
  "presets": [
    { "id": "proposal", "name": "Proposal" },
    { "id": "shipped_app", "name": "Shipped app", "locked": true }
  ],
  "knobs": [
    {
      "id": "commit_distance",
      "name": "Commit Distance",
      "group": "Throw",
      "type": "number",
      "values": { "proposal": 95, "shipped_app": 95 },   // a tune is a one-line diff
      "min": 40, "max": 200, "step": 1, "unit": "pt"
    }
  ]
}
```

- A knob's running value is its value in `active`, else the first preset's that has one, else its type's zero. Ranges are soft: typed values may go past them and are never clamped.
- A malformed file, a duplicate id, a value of the wrong kind or an empty preset list refuses to load; a missing value or a reference to a missing preset loads, with diagnostics.
- Up to 500 knobs and 16 presets.

### 3.4 In memory

`SonobeDocument = { project, components: Record<id, Component>, scripts: Record<patchId, string>, assets: Record<id, AssetRecord>, knobs?: KnobSet }`. It is plain immutable data. Updates produce new objects with structural sharing, so React selectors stay cheap and undo inverses stay trivial.

### 3.5 Ops (the only way to mutate)

`applyOps(doc, ops, ctx) → { doc, results, idMap, inverse, diagnosticsDelta, revision }`

- Batches are **atomic by default**: all ops apply or none do.
- Ops apply sequentially, and each op sees the effects of earlier ops.
- `dryRun` returns the would-be diff and diagnostics without applying anything.
- `expectedRevision` enables optimistic concurrency.
- Every op validates against the registry: unknown port → did-you-mean; type mismatch → converter suggestion.
- A field an op kind doesn't take fails with `unknown_field` and a did-you-mean, instead of being ignored, and so does one in the new layer (children included), patch or comment an add op wraps (lenient undo and redo replays skip this check).
- Update ops merge by key, and `null` removes a key (props, settings, meta, published ports). `updateInterface` also takes `replace: true`, which makes each side it's given (inputs, outputs) the whole set. Unpublishing a port disconnects its cables inside the component and on every instance, including reads of a layer instance's prop (`@chip_1.label`), and the inverse restores them. A port declared again with a type (or options) its cables and instance values no longer fit drops those the same way. A layer instance's own properties (`position`, `enabled`…) resolve before published inputs with the same key, so these cascades leave them alone. An output declared again without `link` keeps its cable; `link: null` disconnects it.
- A batch may replace an item under its id (remove, then add); ids removed by earlier batches are retired (§3.2).
- `replacePatch` changes a patch's type in place (the editor's Replace With): it keeps the id, position, custom name and bypass, and every value and cable whose port the new type has under the same key (or the one `inputMap` / `outputMap` names) with a type that fits. The rest are dropped, listed in the op result's `dropped`, and restored by the inverse. An `updatePatch` that changes `typeParam` or `inputCount` lists what it drops the same way.
- An op's side effects are spelled out in `applied` (the values `replacePatch`, a `typeParam` change or a retyped published port drop), and so are the ids it derived (`createComponent` records its `id` and `instanceId`), so lenient undo and redo replays, which don't check retired ids, land on the same documents.

Op kinds (see `Op` in `packages/core/src/types.ts`): `addLayer, updateLayer, moveLayer, removeLayer, addPatch, updatePatch, replacePatch, removePatch, setInput, connect, disconnect, rename, addComment, updateComment, removeComment, addComponent, removeComponent, createComponent, updateInterface, updateComponent, setNodePositions, setScript, addAsset, removeAsset, setProject`, and the project-level knob ops `addKnob, updateKnob, removeKnob, setKnobValue, addKnobPreset, updateKnobPreset, removeKnobPreset, applyKnobPreset`. There is no separate layer-prop op: `setInput` and `connect` accept `@layer.prop` addresses, and `$knob.<id>` as a source.

- `setNodePositions { positions: { "@layerId" | "$in" | "$out": [x, y] | null } }` merges graph node positions entry by entry (rounded to whole points; `null` returns a node to automatic placement), and its inverse touches only the named keys. `updateComponent` refuses a `meta.patchEditor` object that would drop or move saved positions (`meta_conflict`); `patchEditor: null` still clears it.
- An `addPatch` without `ui` goes one column right of the rightmost patch: its drawn width plus 72 pt.

Knob ops:
- The first `addKnob` makes a "Default" preset; removing the last knob of a project that never had other presets removes `knobs.json` again.
- `setKnobValue` tunes the running preset (or `preset`) and is refused on a locked one, except in lenient undo and redo; creating a knob or changing its type may still write a locked preset.
- `updateKnob` with a new `type` converts every value through the link coercions, and is refused when a value can't convert or an input that reads the knob can't take the new type.
- `removeKnob` leaves every reader holding the running value, converted to what it takes, so the prototype behaves as it did.
- `removeKnobPreset` refuses a locked preset, and the last one while knobs remain; `applyKnobPreset` switches the running preset. `createComponent` keeps knob links inside and publishes nothing for them.
- Lenient undo and redo replays put back what a hand edit left in `knobs.json`, which loads with diagnostics: a value for a preset that isn't there, a preset without a value of its own, a running preset that isn't one, and names alike ignoring case.
- `planVariablesToKnobs` (core) turns constant Variable Broadcasters into one undoable batch of these ops.

Errors are `{ code, message, hint, address, opIndex, suggestions: [{ description, ops }] }` and are written for humans first. Links may also read layer outputs or props: `{ "link": "@layerId.key" }`.

**History.** Every committed batch is one undo group `{ label, author: { kind: "human" | "agent", name }, ops, inverse, revision }`. Undo applies the inverse. The history panel shows agent groups ("Claude: added press animation (12 ops)"). Soft deletes go to a session trash.
- A reload of outside changes is its own undo group ("Outside Sonobe: Reloaded from disk"). Undoing past it restores the document older groups were recorded against, and redo restores the reloaded version exactly, so undo then redo never reverts outside changes.
- An agent's undo checks the human-edit guard in the same step it undoes (in the editor, not across RPCs).

**Outside changes.** Other writers share project folders (the app, git, a person, `sonobe mcp --headless`).
- The app reloads outside changes when clean. With unsaved edits it holds them (`externalChange`) and Save refuses with `disk_changed` until the person keeps their edits or reloads. Changes reported during a save or open are checked once it finishes. A file that no longer parses sets `diskProblem` and marks the document as having something to save.
- The headless host remembers the files as it last read or wrote them. `save_document` (and autosave) refuse with `disk_changed` when the folder changed since, and only delete stale files the session loaded or wrote. `save_document({ force: true })` writes over the outside changes but still never deletes files the session didn't know; `open_document({ ref, reload: true })` loads the version on disk.

**Drafts.** Unsaved work survives a crash, a quit or a killed process (`apps/editor/src/state/drafts.ts`, `apps/desktop/electron/drafts.ts`).
- While the document has unsaved edits, the draft keeper writes them a second after the last change (at most five seconds while edits keep coming), once any open gesture ends. It writes only changed files, and asset bytes once. A copy that's only marked unsaved (an example) gets no draft until it's edited. The keeper only reads the document store.
- A draft is a project folder, `<userData>/Drafts/<id>.sonobe` (in the browser editor: OPFS, or localStorage with text only). Files are written one at a time with atomic renames, and `draft.json` last. It records the name, the project the draft has unsaved changes to (or none), counts, the session's seen ids, digests of the project files it started from, and every file's sha256. Files that don't match it mean a write was cut off: the draft is torn, still opens, says its last changes may be missing, and is whole again after its next write. A draft folder is never a project: opened from Finder, Open Recent or the Open panel it comes back as the draft it is, `open_document` on its path refuses (`draft_folder`) and names `draft:<id>`, and the app won't open or save a project there.
- A window claims the drafts it writes or opens (the browser uses Web Locks), and gives back one it can't read (a newer format, damaged files). The welcome screen's Recovered section and `list_documents` show only unclaimed drafts, and the welcome screen opens at launch when there are any. Restoring (`EditorSession.restoreDraft`, `open_document({ ref: "draft:<id>" })`) asks about unsaved changes, opens the draft's project first when it has one, puts the draft over it unsaved, and continues its id session. When the project changed on disk since the files the draft started from (as opened or last saved; an outside change noticed while editing doesn't move them), `externalChange` asks which version to keep. Undo history starts fresh.
- The draft goes away once the document is clean (saved, or undone to the saved state) or replaced after Don't Save, and when a window closes after Save or Don't Save. Launch deletes empty drafts and drafts untouched for 90 days, never one whose files it can't read; Discard asks first.
- SIGTERM, SIGINT and SIGHUP make the app write every window's draft (waiting at most 1.5 s) and quit without the unsaved-changes prompt; a second signal quits at once. The prompt writes the draft before it asks, in case nobody answers. A crashed editor renderer reloads, and its draft is recoverable.

### 3.6 Diagnostics

`getDiagnostics(doc, registry)` is a pure pass that returns `{ code, severity, message, itemIds, port?, suggestions }`. It checks:
- unknown types or ports
- invalid links and type mismatches
- zero-latency self-cycles
- a pulse wired into a state input ("did you mean a Switch?")
- loop length mismatches (`loop_length_mismatch`): loops of different lengths meeting at a patch's per-item inputs or at a layer's copies (its own looped properties and the layers inside it), when the document fixes both lengths (Loop Builder rows, a typed Loop Count, literal loops). A warning, or info when it looks deliberate: the longer length is a whole multiple of the shorter (stripes), or a typed Repeat shows the first items. The runtime reports lengths only it knows (§5.2).
- copies (§4): a layer people touch that makes 1 copy while looped layers side by side inside it repeat on their own (`loops_inside_single_copy`, info, with the Repeat op), a Repeat under a layer that already makes copies (`repeat_inside_repeat`), and a Repeat that follows a gesture running once per copy (`repeat_from_own_gesture`), both warnings
- a layer component's published input keyed like a layer property, which instances can never set (`input_shadowed_by_prop`, warning; `updateInterface` refuses new ones)
- unreachable or unused patches (info)
- published inputs nothing inside the component reads (`unused_input`, info) and outputs nothing inside drives (`unconnected_output`, info)
- a cable that reads an instance's output its component doesn't drive (`undriven_output`, warning, on the component holding the cable)
- missing assets
- a layer that can't receive touches because it has opacity 0 or is disabled
- variables: an unnamed broadcaster, broadcasters that share a name, scope, and type, and a variable nothing reads (info); constant broadcasters that could be knobs (`variables_could_be_knobs`, info)
- layers in a patch component, which is never drawn (ops refuse to add them)
- knobs: a link to a missing knob (`unknown_knob`) or one whose type or options can't reach its input (`knob_type_mismatch`), a value that doesn't fit its knob (`invalid_knob_value`), a preset without a value (`knob_missing_value`), a reference to a missing preset (`unknown_knob_preset`), a value outside the soft range (`knob_out_of_range`, info) and a knob nothing reads (`unused_knob`, info). Knob-table diagnostics point at the root component with `knob` and `preset` set.

Messages name items the way the editor shows them ("Photo Scale" (Transition)); ids stay in `itemIds` and suggestion ops.

The copy and loop-length checks read `loopShapes(doc, component, registry)`: which values carry loops and how long they are, as far as the document says (per-item patches take their longest per-item loop, a one-item loop comes out a plain value, whole-loop outputs start new loops, `$in` values and constants such as `$knob.<id>` never loop). The engine uses it too, to leave to diagnostics the mismatches they already report.

Hosts that diagnose every revision use `createDiagnosticsCache(registry)`. It returns exactly what `getDiagnostics` would, but re-checks only components that changed (or that show a changed component), and inside a changed component only the inputs and layer properties whose literal values changed (plus the copy checks when a Repeat, a Layout, a Positioning, a Loop's Count or a literal loop changed). A scrub or a drag at 1,000 patches costs well under a millisecond. A knob tune or a preset switch re-runs only the cheap knob-table checks; a change to knob ids, names, types or options also re-checks the components that read knobs.

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
- **An empty loop wins.** When any per-item input holds an empty loop, the patch runs 0 times and its outputs are empty loops, and a layer or component bound to one makes 0 copies, whatever the other loops hold (unless its Repeat decides the count; see Copies). That's how a list filtered to nothing hides its rows. Whole-loop ports (`wholeLoop`) don't count toward this. The one exception is a value read from last frame (§5.2).
- **Copies.** Layers bound to looped values replicate, one instance per index:
  - How many: every layer has a `repeat` property (subtype `count`). Unset (Auto), the layer makes one copy per item of the longest loop on its own per-item properties (for a component instance, its loop inputs too). A whole number (0–10,000) makes exactly that many, and a linked loop of any item type one per item. A linked plain number counts too (rounded down, at least 0); any other value makes 1 copy with a `repeat_not_a_count` warning.
  - With Repeat set it alone decides: the layer's other looped properties are read one item per copy (`copy % length`), and an empty one reads the property's default on every copy. A typed 0 makes no copies quietly; an empty loop on Repeat is an empty loop (the `empty_loop` rules in §5.2 apply).
  - Layers inside a copy take its copy index, one each, and read their own loops the same way. Children of a layer that makes one copy replicate as siblings inside it. A Repeat under a layer that already makes copies is ignored (loops of loops need a component).
  - The scene's `props.repeat` and a read of `@layer.repeat`, by a link or by `getValue`, are the copy count, not the loop it counts (0 for a layer inside one that makes none). Links to it, layer references and layer outputs read the previous frame's count.
  - Which is on top: copies draw in index order, the last in front, unless `zPosition` says otherwise (§5.5).
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
- **`loop_length_mismatch` at runtime.** When a layer's copies meet a loop of another length that the document doesn't fix (a filtered list, a count from data) and it doesn't look deliberate (§3.6), the runtime warns, naming the layer, the property and both lengths. Right after a count changes, gestures still read last frame's copies, so the warning needs two frames in a row. It lasts while the lengths differ and clears on `updateDocument`.
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
- Recognizers: interaction (down/tap/position/localPosition/force), gesture (down/tap/position/translation/velocity/startPosition/localPosition), drag (position/dragging/velocity), scroll/momentum, swipe, hover, keyboard, mouse, trackpad, device motion (on phones, through the web player). Finger speed comes from gesture or drag; interaction has no velocity.

### 5.6 Runtime API

```ts
const rt = createRuntime(doc, { registry, textMeasurer, seed, fps });
rt.dispatch(events);                         // InputEvent[]
const frame: SceneFrame = rt.step(dtSeconds); // advance one frame
rt.getValue("pop.output"); rt.getValue("@card.scale");
rt.inspect("@card.position#3")               // { value, copies?, note? }: why a value reads as nothing
rt.trace(targets, durationMs, events?)       // columnar samples + summaries
rt.updateDocument(nextDoc)                   // hot-swap graph, keep compatible state
rt.setDevice({ darkMode: true })             // replace the host's device overrides, from the next frame
rt.issues()                                  // RuntimeIssue[]: code, severity, message, ids, hint?, suggestions?
```

- `RuntimeOptions.device` and `setDevice` are what the host knows about the device on top of the project's `device` settings. They outlive restarts, and traces replay with the current ones. The editor's viewer passes where it runs (`platform` "desktop", or "web" in a browser) and follows the system's appearance for Dark Mode; the web player passes the phone's (§9.2).

- `inspect` notes say that a layer drew 0 copies (quoting its `empty_loop` warning) or sits inside a layer that did, that `#n` is past the end, that an instance path runs into a component with 0 copies, or why a value is an empty loop. Layer addresses report `copies` for every layer, with notes like "Layer "Card" has 1 copy, so there's no #2" and "copy #0 of 4" for a read without `#n`. A component patch's ports report how many copies of its instance ran. sim_get_values prints the notes after the values. Other read-outs about a value (simulation overrides) belong in the same accessor and the same notes, not a second mechanism.
- `getValue` of a layer property with `#n` reads what that copy draws: loops wrap, and an empty loop reads the default under Repeat.
- A `layerPulse` input event (`{ layerId, key?, prop }`) fires a layer's pulse prop on that step as a connection would; the editor's Inspector Fire button sends it to the live viewer, never to the document.

- `updateDocument` patches literal-only edits (input and property literals, patch positions outside cycles) into the compiled graph in place, and recompiles for anything else.
- Knobs compile to constants: every input that reads `$knob.<id>` gets a constant binding registered as a knob reader, so a tune or a preset switch is an in-place write too, on the viewer, the phone, simulations and trace replays alike. A knob that goes, changes type or options, appears for a link that named it, or feeds a patch whose ports come from its node recompiles, keeping state. Knobs nothing reads never force a recompile. `getValue("$knob.<id>")` returns a knob's running value.
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

**Common props:** `enabled, repeat, position, size, anchor, pivot, opacity, scale, rotation (point3d), zPosition, cornerRadius, cornerSmoothing, color/fill, stroke, shadow (color, opacity, radius, offset), blur, blendMode, clip, layout (group), sizing, hitSlop`.

**Text Field.** `text` and `focused` reach the field only when they change, so typing isn't overwritten every frame. Its pulse props act every time: `setText` puts `textToSet` in the field, and `beginEditing` / `endEditing` focus and dismiss it. A layer's pulse prop fires like a patch's pulse input (a pulse output's true, or a connected boolean turning on). The engine applies these commands through its text-input tracker on the step they fire, and a field with state its props don't show carries it on its SceneNode (`textField`: the text it holds, plus a `textRevision` and an `editRevision`). Renderers act when a revision changes, so no one-frame flag has to be caught; the SVG renderer draws the text the field holds.

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
- `@sonobe/renderer/svg` draws static SVGs without a DOM: a `SceneFrame` (`sceneToSvg`, headless screenshots) and a patch graph model with node boxes (`graphToSvg`, graph screenshots of a component nobody has open, in the patch editor's dark or light theme). `@sonobe/renderer/theme` holds the editor's color tokens for both themes; the editor's `tokens.ts` re-exports them and `graphToSvg` draws with them, so the two can't drift.
- **Platform services for live prototypes** (`platform.ts`): `createBrowserPlatform` gives the runtime network requests, links, speech, keyed audio voices, WebSockets, location, gamepads, device motion (asking iOS for permission inside the next tap), the soft keyboard, picking and reading media, and camera and microphone capture, behind one mute switch (`getMuteStore`: `SONOBE_MUTE`, `?mute=1`, the desktop host's `sonobeHost.muted`, an automated browser, or the desktop's pop-out viewer window being open). Blocked sounds, and a motion permission request refused for want of a gesture, retry on the next gesture, which for a touch or pen is pointerup. `createLiveVideoOverlays` (`liveMedia.ts`) shows live camera feeds inside video layers. The editor's viewer and the web player (§9.2) share both; simulations never get them.

---

## 9. Editor (`apps/editor`)

- **Layout** (all panels resizable and collapsible):

  ```
  Toolbar
  Layers | Viewer | Canvas / Patch Editor (split) | Inspector (Properties | Knobs)
  Bottom HUD: Console · Diagnostics · AI Activity · Performance (live fps readout in the HUD bar)
  ```

  - Side drawer: **Learn** (lessons, recipes, patch docs). The **Assistant** (BYO API key) opens as a sheet on the right, and its **Design with Claude** box floats on the canvas.
- **Stack:** React 19, Zustand store holding `SonobeDocument` and editor state. All mutations go through `store.apply(ops, label)`, which wraps `applyOps` and history.
  - Applies with the same `coalesceKey` merge into one undo step in three ways: within a time window (1 s), through an explicit gesture (`begin`/`update`/`end`, for scrubs and drags, which views may wait on), or as a run (`run: true`, for preset switches) that merges for as long as its step is the newest and ends at any other edit, without holding a gesture open.
- **Patch editor** is built on `@xyflow/react` with custom node rendering:
  - Port colors by type, a distinct pulse glyph, a "×N" loop badge, and live values on hover.
  - One watched loop copy per session (the patch editor bridge's `watchedCopy`): inline values, hover cards and inspector read-outs show item k of a loop (k mod its length) instead of the "×N" summary, and inside a looped layer or patch instance the live scope reads copy k (`card#3/…`). A looped port's hover card lists every copy, and hovering a row watches it. The "Copy #k of N" chip steps through copies, the live scope chip lists a looped instance's copies, and clicking a copy on the canvas or pressing it in the viewer watches it. Opening another prototype goes back to the summary.
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
    - Comment frames are sections. A node belongs to the innermost frame under its title bar (`frameContents` in `frames.ts`), and dragging a frame moves its nodes and the frames inside it. Tidy Up lays out each frame's nodes from the frame's top-left, refits the frame, lays out the unframed nodes where they were, and pushes frames that would overlap apart in reading order (one that started to the right of the other moves right, otherwise down). Frames otherwise stay where they are. Nodes keep their reading order where the flow allows, the layer and interface nodes it lays out are saved (`setNodePositions`), and tidying again changes nothing.
    - Scope follows the selection: selected comments tidy inside those frames, two or more selected nodes tidy within their own frames, nothing selected tidies everything. A comment's menu has **Tidy Up Frame**; **Tidy Up and Arrange Frames** also lays the frames out as blocks. MCP `tidy_graph` runs the same `planTidy` (`@sonobe/core/graph`).
    - Node sizes come from one shape model in `@sonobe/core/graph` (`nodeShape.ts`, `nodeSize.ts`), which follows `patch-editor.css`. The editor measures text with a canvas in its own fonts. Headless callers use a generated SF Pro and SF Mono table (`nodeMetrics.ts`, `apps/editor/scripts/measure-node-fonts.ts`) plus the live values of a deterministic runtime. Layer and interface nodes are placed automatically from measured sizes.
    - An input or layer property that reads `$knob.<id>` has no cable: `deriveGraph` gives its port a `knob` chip (the knob's name and running value), and the shape model sizes the chip. The patch editor draws it where the inline value would be (`InlineValue.tsx` `KnobChip`, checked against the estimate in `e2e/knobs.spec.ts`); clicking it shows the knob in the Knobs tab, and the port's menu unlinks the input to the knob's running value.
- **Layer ↔ patch bridges:**
  - the **Touch** button on a layer row inserts pre-wired interactions
  - clicking an inspector property creates a property link target
  - drag a cable onto an inspector property or a layer row
- **Inspector:** scrubbable number fields (drag, arrows ±1, ⇧ ±10, ⌥ ±0.1), color picker, segmented controls, and spring presets with a curve preview. Repeat has a count field that shows Auto while unset, and "4 copies" while a loop drives it.
  - Two tabs, **Properties | Knobs** (`layoutStore.inspectorTab`). The Knobs tab stays put as the selection changes, with a line back to Properties.
  - **Make Knob…** (a field's context menu, on unconnected number, on/off, color, choice, point and text fields) makes a knob holding the field's value in every preset (on a mixed selection the first target's, which the popover names), with a soft range worked out once from the value and the port (`suggestKnobRange`) and stored, and links every selected target to it, in one undo step. **Use Knob ▸** links a knob whose type fits. A knob-driven field shows the knob's chip, "Knob · 4 uses" and the knob's control (it tunes the running preset), with Show in Knobs and Unlink, which keeps the running value. The Spring section reads knob-driven inputs as their knobs' values, and a spring preset applied there tunes those knobs.
- **Knobs tab** (`apps/editor/src/panels/knobs/`): the project's knobs, knobs without a group first, then groups in the order of their first knob.
  - A preset bar: one chip per preset (the running one filled, locked ones with a lock; a chip's menu renames, locks or deletes it), + for a copy of the running preset (the copy runs next, so the original stays as it was), and a ⋯ menu with New Knob…, New Preset, Copy Differences (a Markdown table) and Convert Variables to Knobs… (`planVariablesToKnobs`, with a checkbox per broadcaster).
  - Rows tune the running preset live, without a restart. Numbers get a slider (`ui/Slider.tsx`) over the soft range and a field that takes values past it (the slider pins with a caret); other types use the Inspector's controls through `knobAsPort`. Slider ticks mark the other presets' values and copy one on click. A ≠ mark and "Only differences" compare the running preset with its partner, the preset that ran before it (else the next in order); the filter keeps the row being tuned or holding focus until the person leaves it, and Show in Knobs turns it off for a knob it hides.
  - A locked running preset makes the rows read-only, with Switch to and Unlock. A row's menu edits the knob, copies the partner's value, shows its uses, and removes it (every input keeps the running value). ↑ and ↓ move between rows.
  - Undo: a drag or scrub is one step ("Tune Commit Distance to 110 pt (Proposal)"), and a run of preset switches is one step ("Switch Presets") until another edit.
  - Commands: **Show Knobs** (⌘5, also View > Knobs in the desktop menu), **Flip Presets** (⌘', to the partner; everywhere but text fields), New Knob…, New Preset, Copy Knob Differences, Convert Variables to Knobs…. Knob diagnostics in the HUD open the tab on their knob.
  - Copying items carries a snapshot of the knobs their links read: pasting keeps a link where the same knob exists with the same type, and pastes the value elsewhere.
- **Layers panel:** a ×N badge on layers that make copies (with a repeat icon when Repeat decides) and a z badge on layers with a Z Position. Bring to Front and Send to Back say when a sibling's Z Position still wins.
- **Canvas:** artboard with direct manipulation (select, move, resize, rotate), rulers and snapping, insert shapes and text. **Design with Claude** (the header's sparkle, ⌘K, or a layer's Redesign with Claude…): a box at the bottom of the canvas sends the request to the in-app Assistant with the canvas's context (the component, its screens, the picked layer and `styleDigest`), and draws the HTML Claude is writing over the artboard in a sandboxed preview (`panels/design`). The preview never writes the document; the finished page imports once through `import_design`, as one undo step, and the new screen is selected. Without the Assistant (no key, or the browser), the box copies a prompt for Claude Code or Claude. On macOS, **Open in Claude Code** (there, or in the box's footer) starts the person's own `claude` in Terminal with that prompt, in the linked code folder (§10).
- **Viewer:** live prototype, device picker, restart ⌘R, frame toggle, 1:1, "show hit targets", and pop-out window. Also serves a LAN web player (QR code), which the Sonobe Viewer iPhone app opens with native haptics (§9.2). Restarting restarts the phones and the pop-out viewer too. While the prototype has an `empty_loop` warning, a notice above it names what has no copies, and Why? opens the warning in Diagnostics. When the running knob preset changes, from any source, a caption names it over the stage for 1.5 s.
  - **The restart offer** (`runtime/staleState.ts`). Edits hot-swap and keep state. When an edit arrives while an `empty_loop` warning is up, the runtime host waits until the new document has run three frames and 300 ms have passed, then steps a fresh headless copy (no platform services) for two frames. If the copy draws a layer the live prototype still draws no copies of, the notice says "The prototype kept state from before your edit" with a Restart button, and the `viewer.diagnostics` RPC adds a `stale_state` info diagnostic for `get_diagnostics`. A restart, or the copies coming back, clears it. If the copy draws nothing either, the wiring empties the loop, and the notice keeps Why?.
- **Command palette** (⌘K) lists every command with its shortcut, so the app is discoverable.

### 9.1 Desktop host conventions

- The editor detects the desktop with `window.sonobeHost` (`apps/desktop/electron/host-api.d.ts`). Without it, the editor runs in the browser with an in-memory or File System Access fallback.
- **RPC.** Main calls into the live document with `createRendererRpcHub().invoke(webContents, method, params)`.
  - Renderer handlers are registered with `sonobeHost.rpc.handle(method, fn)`.
  - Handlers report errors by returning `sonobeHost.rpc.fail(code, message, data)`, because the context bridge strips Error properties.
  - A page that reloads or crashes (a crashed editor reloads itself) takes its handlers with it. The calls it hadn't answered fail at once with `page_gone` (MCP `editor_reloaded`, whose hint points to the draft), its method list is forgotten, and new calls wait up to 10 s for the next page to register their method instead of timing out. The app host forgets the old page's document (its docId, cached snapshot and simulations). A `document.info` the page went away under is asked again of the new page, since it changes nothing.
  - `document.save` backs the unsaved-changes prompt (`interactive`) and `save_document` (`noDialog`, and `path` for a folder main already checked and approved). `document.recoverDraft({ id })` restores a draft, and `drafts.flush` writes the window's draft now (main calls it before quitting on a signal and when the prompt opens).
  - `design.preview` takes an MCP client's `preview_design` draft (its session, fields, whole html so far and status) and draws it over the artboard in the Assistant's sandboxed preview (`panels/design`), with the pill "Claude Code is writing “Checkout”". It changes nothing, so it isn't an agent write and Read only still shows it. Its params are checked like any other call's (html at most 1,500,000 characters), and a draft with no update for 15 minutes leaves the canvas.
  - Panels register optional methods only while they're mounted, so main can tell what's there: `canvas.bounds`, `graph.bounds` and `viewer.layerBounds` for screenshots (`graph.bounds` waits for a fit or reveal to stop moving), and the patch editor's `graph.geometry({ component })`: `{ component, shownComponent, revision, nodes: [id, x, y, width, height, measured][] }` for the component it shows, where `measured` is 0 for off-screen nodes React Flow hasn't rendered (their size is the editor's estimate) and `revision` is -1 while the drawn graph lags the document mid-gesture.
- **Menus and clipboard.** Menu commands arrive through `sonobeHost.onCommand(id)`. Cut, Copy, and Paste are native roles, so the editor handles DOM `copy`/`cut`/`paste` events.
- **Env switches** read by the desktop main process (`apps/desktop/electron/env.ts`): `SONOBE_DEV_URL`, `SONOBE_MUTE`, `SONOBE_MCP_PORT`, `SONOBE_MCP`, `SONOBE_HOME`, `SONOBE_USER_DATA`, `SONOBE_EDITOR_DIST`, `SONOBE_TEST`, `SONOBE_LAN` (start the phone preview server at launch) and `SONOBE_LAN_PORT` (a fixed phone preview port). `SONOBE_MUTE` mutes every window's audio and also reaches the pages, since system speech plays past Chromium's mute: editor windows get `sonobeHost.muted` (a `--sonobe-muted` argument the preload reads), and the pop-out viewer loads with `?mute=1`.
- Four switches are read elsewhere: `SONOBE_GUIDES_DIR` overrides the MCP agent guides folder (`packages/mcp/src/guides.ts`, used by bundles), and `SONOBE_EXAMPLES_DIR` the examples folder `list_examples` and `get_example` read (`packages/mcp/src/examples.ts`, §10); `SONOBE_NODE` picks the Node binary for the packaged `sonobe` CLI launcher (`apps/desktop/scripts/build.mjs`), which otherwise uses the app's own runtime; and `SONOBE_SFSYMBOL` names the sfsymbol helper that draws SF Symbols in headless design imports (`packages/mcp/src/headless.ts`, §13). The launcher sets it to the app's `Resources/bin/sfsymbol` when that exists; without it, headless imports keep SF Symbol placeholders.
- **SF Symbols helper.** `apps/desktop/native/sfsymbol/main.swift` is a small macOS program. `scripts/build.mjs` compiles it with `swiftc` (cached by source and compiler) into `dist/bin/sfsymbol`, electron-builder ships it outside app.asar in `Resources/bin`, and `scripts/verify-package.mjs` checks that it draws. Without Xcode's command line tools the build only warns. `electron/symbols.ts` gives design captures its renderer on macOS 13 or later.
- **Connect Claude** reads `getMcpStatus().cliPath`, the app's bundled CLI launcher (`Resources/cli/sonobe`, `sonobe.cmd` on Windows), so the setup it shows uses a full path instead of a `sonobe` on PATH.

### 9.2 Web player and Sonobe Viewer

The web player (`apps/desktop/player`) runs the real engine and DOM renderer full screen. The LAN preview server (`electron/lan-preview.ts`) serves it for Preview on Phone and for the pop-out viewer window, and streams each new revision over a one-way WebSocket, which hot-swaps it into the running prototype.

- **Platform services.** `playerPlatform(window, options)` (`player/platform.ts`) is the editor viewer's `createBrowserPlatform` (§8): sound, speech, Network Request, Open URL, WebSockets, location, device motion, media and camera, and `navigator.vibrate` where the browser has it (Android). A native host that announces itself replaces `haptic` and `vibrate`. The player draws live camera feeds with `createLiveVideoOverlays` and resets the services when the prototype restarts or another document arrives. Browsers give location, device motion on iOS, the camera and the microphone only to secure pages: the pop-out window's `127.0.0.1` page is one, and a phone's `http://` LAN address isn't, so those services stay off on the phone.
- **Device info** (`player/device.ts`). On a phone or tablet (a native host, or a coarse main pointer) the player tells the runtime `platform: "mobile"`, the system's appearance, the `env(safe-area-inset-*)` insets that reach over the drawn prototype (in its points, past the letterbox), the rotation from `screen.orientation` as `orientationAngle`, and `devicePixelRatio`, and calls `setDevice` when the phone turns or the appearance switches. In a desktop browser and the pop-out window it passes `platform: "web"` and the appearance only. The screen size stays the project's, since the player scales the prototype to fit, and the interface keeps the project's orientation.
- **The socket** carries `hello`, `document` (`{ docId, name, revision, doc, scriptsPaused? }`), `offline`, and `restart`. The editor calls `sonobeHost.notifyPrototypeRestarted()` whenever its prototype restarts (⌘R, the viewer's Restart, `restart_viewer`, trusting its scripts, opening another document in the window); main restarts the players when that window's document is the one they show (`AppHost.activeTargetId()`). `LanPreviewHandle.restart()` first sends any revision the players don't have, then `{ type: "restart" }`, so a phone starts over on what the editor restarted. The player restarts its runtime and resets its services. File > Open, New Prototype and the examples keep the window's `docId`, so that restart is what starts the phone over on the new document; the player also starts fresh for a new `docId` (`open_document`).
- **Scripts wait for trust on the phone too.** Main reads the editor's script trust from `document.info` (`AppHost.scriptsPaused(docId)`) and sends `scriptsPaused: true` while the project's scripts wait. The player's registry then runs no `javascript` patch (`player/scripts.ts`, the twin of the editor's `withScriptTrust`); trusting restarts the prototype, and the restart sends the document again without the flag. This matters because scripts fetch through the platform's `fetch`.
- **The page's CSP** allows code only from the player's own origin, no framing, and no form posts. It lets prototypes reach other hosts the way the editor's viewer can: `connect-src 'self' http: https: ws: wss: blob: data:` (Network Request, JSON File, scripts, WebSocket Connection, and the platform reading picked photos, captures and data: files for Base64 Encode and uploads) and `img-src`/`media-src` with `data: blob: http: https:` (the images, videos and sounds those return, and Base64 Decode's data URLs). The pop-out window's links still go to the system browser.
- **One viewer plays sound.** While the pop-out window is open, the editor's own viewer is muted (mute reason `viewerWindow`, from `sonobeHost.onViewerWindowStatus`) and its note says the window plays the sound, so start sounds, loops and speech don't play twice out of phase. Both runtimes still run: start-triggered requests, WebSockets and the camera open once in each.
- **The menu.** A three-finger tap anywhere opens a small sheet: Restart Prototype (this player only), Reload, and, when the native host lists the action, Open Another Prototype. `player/gesture.ts` decides: fingers pass to the prototype until a third lands; then the player owns the touch, sends the prototype a pointer cancel for each finger it already had, and keeps every later event of those fingers, and of fingers that land before they all lift, away from it (touch events too, so no clicks or focus changes). It opens the menu when all fingers lift within 600 ms, none having moved more than 24 px. Mouse and pen input always pass. A one-time tip ("Tap with three fingers for the menu") shows on touch screens; the player remembers it in localStorage, and in Sonobe Viewer through the bridge.
- **Sonobe Viewer** (`apps/ios`) is a SwiftUI app with a full-screen WKWebView on the player URL. It accepts only preview links (`http(s)://<host>:<port>/p/<token>/`, from a QR scan, a paste, `sonobe-viewer://open?url=<link>`, or the `-SonobePlayerURL` launch argument), keeps navigation on that origin, and opens other links in Safari. A scanned, pasted or deep link whose host is off the local network (not loopback, private, link-local or 100.64/10, `.local` or a single-label name) waits for an alert that names the host, since Sonobe itself only serves on the local network; Recent changes only once a link opens. `NSAllowsLocalNetworking` lets it load the plain-http LAN URL. The Info.plist describes the camera, microphone and location for prototypes, which get them on a secure (https) link. It has no renderer of its own and no menu of its own: everything a prototype does, and the three-finger menu, reach the phone through the web player. It has no shake menu, because shaking belongs to Device Motion prototypes.
- **The bridge** is one-way, from the page to the app:
  - At document start the app defines a read-only `window.sonobeNative = { version: 2, platform: "ios", haptics: string[], vibrate: boolean, actions: string[], menuTipSeen: boolean }`, where `haptics` lists the Haptic Type keys the device can play, `actions` the menu actions the app takes (`"openAnother"`), and `menuTipSeen` says the app already showed the three-finger tip. The player reads `actions` and `menuTipSeen` only from version 2.
  - The page posts `{ kind: "haptic", type, pattern? }` (`pattern` is Custom Pattern's AHAP JSON) or `{ kind: "vibrate", pattern }` (milliseconds as a number or an on/off list; 0 or `[]` stops) to `window.webkit.messageHandlers.sonobe`, and from version 2 `{ kind: "openAnother" }` (back to the connect screen) and `{ kind: "menuTipSeen" }` (remembered in UserDefaults, since the app's web view keeps no storage between launches).
  - `haptic.supports(type)` is "the type is in `haptics`", so Haptic's Available output stays driven by the catalog's Type keys. The player ignores a malformed announcement.
  - The app plays messages only from the main frame on the preview's origin, ignores unknown kinds and types, and caps a vibration at 10 s. UIFeedbackGenerator plays the Haptic types; Core Haptics plays AHAP as is and turns vibrate patterns into continuous events. The app logs each one under the `dev.sonobe.viewer` subsystem, which `npm run test:ios` reads.
- **Signing.** `apps/ios/Config/Base.xcconfig` holds the shared settings and includes an ignored `Local.xcconfig` with the developer's team and bundle id. Simulator builds pass `CODE_SIGNING_ALLOWED=NO`.
- **Limits.** Frame pacing is WKWebView's, likely 60 Hz on ProMotion iPhones. Nothing in CI builds the app.

---

## 10. AI integration (`@sonobe/mcp`)

**Bring your own Claude subscription = MCP.**
- Users connect Claude Desktop or Claude Code (signed in with their own plan) to Sonobe's MCP server.
- Sonobe never offers claude.ai login, never reads Claude credentials, and never drives a user's subscription headlessly.
- Open in Claude Code (the canvas's Design with Claude box) writes a one-time script and opens it in the person's Terminal: their own `claude`, in a folder they chose, with the prompt they wrote. They drive that session with their own plan; Sonobe doesn't run it headlessly or read its output or credentials. When no `sonobe` server is configured there, the script passes Sonobe's relay with `--mcp-config` for that session only.
- An optional in-app assistant uses the user's own Anthropic API key only.
- The in-app assistant reads a person's code only from a folder they link in a native dialog, kept in the app's data and never in the document, through three read-only tools of its own that aren't MCP tools (`list_code_files`, `search_code`, `read_code_file`). They stay inside that folder, skip hidden, secret and binary files, redact key-shaped text, and cap what one chat reads.

**Topology.**
- Electron main hosts Streamable HTTP MCP at `http://127.0.0.1:<port>/mcp`. It validates Host/Origin and requires a bearer token.
- The port and token are written to `~/.sonobe/mcp.json` (0600).
- `sonobe mcp` (the CLI) is a stdio relay to the running app. With `--headless <project>`, it serves a project folder without the app: ops, simulation, save, and screenshots drawn from the SceneFrame (SVG rasterized to PNG with `@resvg/resvg-js`, approximate text metrics, placeholders for video, Lottie and shaders). Headless mode has no editor selection; it draws `graph` and `canvas` screenshots from the document (see Looking inside components below).
- **Sessions** (`clients.ts`). The app knows which sessions are connected, not just that its server listens:
  - The relay sends a per-process id in a `sonobe-client` header on every POST. On `/clients` it says hello with the client's `clientInfo` and the session's folder (`CLAUDE_PROJECT_DIR`, else its working folder), heartbeats every 30 s, and says goodbye when stdin closes or on SIGINT/SIGTERM (Claude Code stops stdio servers with SIGINT). An app without `/clients` answers 404, and the relay keeps relaying.
  - `createClientRegistry` holds the sessions: connected, gone after a goodbye or 75 s of silence, forgotten after 10 minutes. Clients without the relay share one anonymous row.
  - The client id rides the HTTP transport's per-request call scope (`CallScope.clientId`), so every tool call counts toward its session. Over stateless HTTP, initialize's `clientInfo` is gone by `tools/call`, so edits are attributed by the name the hello announced.
  - Working badges are kept per session (`WorkIntent.client`), so two sessions don't replace each other's.
  - `getMcpStatus` returns the sessions, and the toolbar's Claude button is green only while one is connected.
- Tool handlers run against `SonobeHost`:

  ```ts
  interface SonobeHost {
    listDocuments(); listDrafts?(); openDocument(ref, { reload, ...control }); createDocument(request, control?); getDocument(docId?);
    saveDocument(docId?, { force, path, ...control }); apply(ops, { label, author, dryRun, expectedRevision, signal });
    getSelection(); screenshot(target, { component, simId, atMs, isolate, ... }); reveal(ids, { component, focus });
    graphGeometry?({ component });   // the open patch editor's node boxes, or null
    setWorking({ ids, intent } | null, { author, client });
    captureDesign?(request, control?); fetchImage?(url, signal); putAssetFiles?(files, { docId, ...control });   // design import (§13)
    showDesignPreview?(update, control?);   // preview_design's draft on the canvas (§13)
    sim: { reset(opts); dispatch(simId, events); step(simId, opts); trace(simId, opts); values(simId, targets); override(simId, request) };
    history: { list(opts); undo({ txnId, signal }); };
  }
  // control = { signal?, progress?(step) }: the trailing argument of calls that can run long.
  // Requests stay plain data, because the desktop sends them over IPC.
  ```

**Tools** (annotated readOnly/destructive; every write returns deltas, ids, and diagnostics):

| Group | Tools |
|---|---|
| Discovery | `get_guide`, `list_patch_types`, `describe_patch_types`, `describe_layer_types`, `list_value_types`, `list_examples`, `get_example` |
| Documents | `list_documents`, `open_document`, `create_document`, `get_document_info`, `save_document` |
| Read | `get_outline` (compact text projection, or a style digest), `get_layers`, `get_patches`, `get_items`, `find`, `get_selection`, `get_diagnostics`, `explain` |
| Write | `apply_ops`, `add_layers`, `add_patches`, `connect`, `set_values`, `update_layers`, `delete_items`, `rename`, `create_component`, `tidy_graph`, `preview_design`, `import_design` |
| Knobs | `get_knobs`, `set_knobs`, `apply_knob_preset` |
| Simulate | `sim_reset` (with `preset` and `knobs`), `sim_dispatch`, `sim_step`, `sim_trace`, `sim_get_values`, `sim_override`, `get_screenshot` |
| Presence and history | `begin_work`, `finish_work`, `reveal`, `restart_viewer`, `list_history`, `undo` |

- **Unknown fields fail.** Every tool's input refuses a field its schema doesn't take, at any depth, with the tool, the field and the closest known field (`packages/mcp/src/inputs.ts`, one check in the tool wrapper). zod would strip it and the call would quietly do something else. Loose objects and records stay open, core checks op fields (§3.5), and MCP's `_meta` is tolerated.
- **Examples as patterns.** `list_examples` and `get_example` serve the verified examples from their registry (`examples/recipes`): what each teaches, its key patches, its patch chain and common mistakes from its README, the scenarios its `test.json` passes, and its recipe as `apply_ops` batches that rebuild it on a blank document (after `import_design` of the capture `detail: "design"` gives, for an example that starts from a design). The graph-basics guide maps code idioms (a tap handler, `useState`, a ternary, `ForEach`, `withSpring`) to the patches that do the same.
- **Saving never asks.** `save_document` never opens a dialog. With `path` it saves into a new or empty folder (Save As) and keeps working there. Without one, a document that was never saved goes to `~/Documents/<Name>.sonobe`, or fails with `path_needed` while it's "Untitled". `create_document` and `save_document({ path })` follow one set of folder rules on both hosts (`projectTarget.ts`): `.sonobe` is added, and the folder must be new or empty and not inside another project. The app also keeps agent paths in home, a mounted drive or the temp folder, outside hidden folders and its own data folder. The person's Save panel refuses folders inside a project or with other files too, and reopens next to the project.
- **Recovered drafts** (§3.5): `list_documents` lists them as `draft:<id>`, `open_document` takes that ref, and `get_document_info` says when unsaved work is kept as a draft.
- **Graph layout.** `tidy_graph` runs the editor's frame-aware Tidy Up (§9) with ELK: `frames` tidies inside those comments, `ids` tidies some nodes within their frames, and `frameMode: "arrange"` moves frames as blocks. Its result says how each frame's size changed (wider, shorter), which frames were pushed, and which nodes overlapped before, with their boxes; a dry run is the way to check a whole graph for overlaps. `add_patches` sizes its columns by how wide each patch draws and places them in free space clear of frames.
- **Node boxes** come from `resolveGraphGeometry` (`packages/mcp/src/geometry.ts`), which `tidy_graph`, `add_patches` and `get_items` share. It estimates them with the shared shape model plus a deterministic runtime's live values after a second, cached per revision. When the app's patch editor shows the component at that revision, the sizes it measured, and where it placed layer and interface nodes, replace the estimates (`SonobeHost.graphGeometry`, the `graph.geometry` RPC, §9.1). Results say which it was. `get_items` prints each patch's and layer node's box (`· ui 460,520 · 286×124`) and the nodes whose boxes overlap it, and lists the nodes a comment frames and which of them overlap, so an agent sees when its own placement collides.
- **Graph node positions.** `get_outline` detail `full` shows `node=x,y` (or `node=auto`) on layers that have a graph node and a `nodes $in=… $out=…` line; `get_items` shows a layer's graph node. Agents move these nodes with `setNodePositions`.
- **Looking inside components.** `get_screenshot` with `component` draws one component: `graph` is its patch graph, `canvas` its artboard at frame 0 with authored values, and `@layer` a layer inside it. The app captures the editor when the person is viewing that component, after any fit or reveal has stopped moving. Otherwise it draws the component from the document in its hidden scene window, as headless servers always do: graphs with `graphToSvg` (`@sonobe/renderer/svg`, in the theme the person's editor shows, dark when headless, boxes from `resolveGraphGeometry`), canvases by running the component alone at frame 0 (`packages/mcp/src/componentViews.ts`). `frame: <commentId>` crops a graph to one comment frame for big graphs; both hosts draw that crop from the document, since it knows where the frame is. A screenshot never moves the person. Targets a component can't have (the viewer, a patch component's canvas, one component inside a simulation) fail with the target that works.
- **Reveal** takes `component` or instance paths (`card_1/tap_photo`). Without `focus` it never changes the person's view or selection, and items in a component they aren't viewing come back not revealed, with the reason. With `focus` the editor opens that component, selects the items, fits the view to them and raises the window.
- **Simulation overrides** (`sim_override`) are ordinary value ops (setInput, connect, disconnect, layer props, mute, `setKnobValue`, `applyKnobPreset`) that a session applies to its own copy of the document with `applyOps`, re-derived on every new revision. They never enter history, the live viewer or disk. `get_screenshot` with `isolate: true` draws one layer's subtree from the SceneFrame, on both hosts.
- **Knobs.** `set_knobs` compiles to the knob ops in one batch, in a fixed order (presets with locks held back, `convertVariables`, knobs and values, connections, removals, locks), so one call can make, fill and lock a reference preset; it matches knobs and presets by id or name and reports what it inferred (type, value, range) for new knobs. `apply_knob_preset` changes what the person's viewer runs; `sim_reset({ preset, knobs })` runs another preset or values in one simulation only. A session simulates `applyOverrides(withKnobOverride(personDoc, knobs), ops)`, one mechanism for both, and a reset clears both unless `keepOverrides`, which keeps them under a new preset or values. `sim_get_values` reads `$knob.<id>`. `set_values` skips knob-driven inputs and points to `set_knobs`.
- **Runtime problems reach agents two ways.** sim_* results list the issues a simulation raised since the last call (with hints and suggestions), and in the app `get_diagnostics` adds a Live viewer section: what the person's running prototype reports right now, read through the `viewer.diagnostics` RPC because it changes without a new revision, including the restart offer as `stale_state` (§9). The headless host has no live viewer and leaves the section out.
- **Restarting the live prototype.** `restart_viewer` calls the optional `SonobeHost.restartViewer`: in the app, the `viewer.restart` RPC restarts the editor's runtime as ⌘R does, and phones and the pop-out viewer follow (§9.2). The headless host has no live viewer, so the tool returns `no_live_viewer` and points to `sim_reset`.
- **Resources:** guides, patch reference, and each document's outline and diagnostics (both publish `resources/updated` on a new revision).
- **Prompts:** `import_screen`, `prototype_interaction`, `debug_interaction`, `explain_prototype`.

**Long calls: progress and cancellation** (`progress.ts`). Every tool handler gets a `ToolWork` as its third argument, `(args, ctx, work)`.
- **Progress.** When the client sends a `progressToken`, `work.step(message, fn, { deadlineMs })` and `work.progress(step)` send `notifications/progress`: `progress` counts the notifications, and the message says where the call is ("Downloading images: 7 of 28"). Stage messages go out at once and count updates at most every 250 ms. Nothing is sent without a token, after a cancel, or after the result.
- **Heartbeats.** While a step runs, its latest message repeats every 10 s, but only until the step's deadline, so a hung step goes quiet instead of looking alive. Progress resets Claude Code's idle watchdog; SSE keep-alives don't.
- **One signal.** `work.signal` aborts on `notifications/cancelled`, a closed HTTP stream or a closed transport. Over stdio the SDK's `ctx.mcpReq.signal` sees all three. Stateless HTTP needs more, so `createHttpHandler`:
  - parses POST bodies itself, so the SDK never clones the web `Request`. After a garbage collection, a cloned Request's signal stops following the original, so the SDK's own disconnect abort was lost.
  - holds its own AbortController per request, aborted when the response closes before it finished.
  - routes a 2025-era `notifications/cancelled`, which arrives on a POST of its own at a fresh server, to the call it names, but only when exactly one call in flight from the same sender (the same `sonobe-client` header, or none) has that request id.
  - streams every 2026-07-28 response from its first byte (`responseMode: "sse"`, keep-alive every 10 s), so a silent call gets its headers at once.
- **A cancelled call never changes the document.** `work.step` rejects as soon as the call is cancelled, even when the host never settles, and aborts the host's `control.signal`. `host.apply` and `history.undo` refuse once their `signal` has aborted. An apply that has already started finishes. Steps that can't be taken back (open, create, save) wait for the host instead of claiming nothing changed.
- **Host methods that can run long** take a trailing `control`: `{ signal, progress(step) }`. They stop and free what they hold when the signal aborts, and report stages through `progress`.
- **Deadlines.** Hosts own the precise limits. `captureDesign` has one deadline (§13) and names the stage it stopped in. The tool's own step deadline is 60 s longer, only as a safety net, so the host's error arrives first.
- **The relay** forwards SSE progress, turns a `notifications/cancelled` on stdin into an aborted request (the app sees the stream close), aborts calls still running when stdin closes, and tells a 5-minute fetch timeout apart from a lost connection.
- **Clients.** A hand-written SDK client must pass `onprogress` together with `resetTimeoutOnProgress`. Without `onprogress` it sends no `progressToken`, so the server can't report progress and the client's default 60 s timeout still applies.
- **The in-app assistant** calls the same tools over an in-memory transport, passing its Stop signal and asking for progress, so Stop cancels a running tool and its chip shows the tool's steps. Each call is pinned to the sending window's document: the agent adds that window's `docId` to tools that take one (a test keeps every tool classified). While Claude writes `import_design`'s html, the agent forwards it (`input_json_delta`) to the canvas preview as `design_draft` events, before the tool runs. Before a `replace` of a layer the person didn't pick and the assistant didn't make in this chat, or one changed since it did, it asks the person, naming what would go from an `import_design` dry run. Its budget counts cache reads at a tenth and cache writes at 1.25×, as they're billed.
- **Distribution:** Claude Code plugin (`integrations/claude-code`) and `.mcpb` bundle (`integrations/claude-desktop`), both built from a checkout. The app's **Connect Claude** screen shows copy-paste setup for Claude Code and Claude Desktop, filled in for this machine (the app's bundled CLI, or Node plus a checkout). Its Claude Code command installs the relay at user scope (`claude mcp add --scope user sonobe`), so every project gets the tools; a headless server stays with one project (local scope). In a source checkout it also shows the commands that build and pack the `.mcpb`.

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

With knobs, a knob block comes first whenever the root is shown, and readers print as links:

```
knobs 1 · running proposal "Proposal" · presets proposal "Proposal", shipped_app "Shipped app" locked
knob pop_bounce number "Pop Bounce" group="Press" 0…20 step=0.5 proposal=8 shipped_app=5

component main "Main" (prototype) 390x844
patch pop popAnimation number←toggle.on bounciness←$knob.pop_bounce speed=10
```

---

## 11. Learnability

- **Generated reference.** Every patch has summary, behavior, ports, examples, "pairs well with", and common mistakes. The same content serves the patch picker, hover docs, `describe_patch_types`, and `docs/patches/`.
- **Concept guides** (short, visual): ISAT (Interaction → Switch → Animation → Transition), states vs pulses, loops, coordinates and layout, springs and feel, components, knobs and presets, debugging taps.
- **Recipes:** 15+ canonical prototypes (tap to zoom, toggle/like, scrolling list, carousel, tab bar, collapsing header, pull to refresh, bottom sheet, drag and snap, swipe cards, long-press menu, timed sequence, stories, onboarding, grid with loops, and a swipe deck built from an imported design with knobs and a locked reference preset). Each has a runnable example project and step-by-step text, and Claude reads them as patterns through `list_examples` and `get_example` (§10).
- **In-app lessons:** step-by-step with validation that checks document state through the same queries the MCP uses.
- **Explain:** a deterministic plain-language description of any graph selection, at three audience levels.
- **Visibility:** pulse sparks, state glow, loop badges, live values, spring curve previews, a "show hit targets" overlay, and diagnostics that suggest fixes.

---

## 12. Quality gates

- `npm run typecheck`: tsc across all packages.
- `npm test`: Vitest. Golden tests cover spring curves against the Rebound formulas, pulse and loop semantics, ops/inverse round-trips, and canonical serialization stability.
- `npm run e2e`: Playwright (Chromium project only) against the editor served by Vite on port 5199 (`SONOBE_E2E_PORT` picks another), with screenshot artifacts.
- CI (`.github/workflows/ci.yml`) runs `npm run typecheck`, `npm test` and `npm run e2e` on every push to main and every pull request, on macOS with Node 24, after installing Playwright's Chromium, so `npm test` also runs the player's mobile Chromium test and builds and checks the sfsymbol helper.
- `npm run smoke -w @sonobe/desktop`: the muted Electron end-to-end run (`apps/desktop/tests/smoke.mjs`, Playwright `_electron`) covering the host API, the MCP loop, the phone preview and the pop-out viewer. It builds the shell and editor, runs by hand, and isn't part of `npm run e2e` or CI. `SONOBE_SMOKE_SKIP_EDITOR_BUILD=1` reuses `apps/editor/dist`. `npm run smoke:drafts -w @sonobe/desktop` (after building both) kills the app with SIGTERM and SIGKILL and recovers the draft.
- `npm run test:ios`: Sonobe Viewer's Swift unit tests and UI tests on an iOS Simulator (`apps/ios/scripts/test.mjs`), against the real web player and LAN preview server, followed by a check of the app's log for the haptics the UI test's taps played. It needs macOS with Xcode, runs by hand, and isn't part of `npm run e2e` or CI. The player's side of the bridge runs in `npm test` (`apps/desktop/player/*.test.ts`; `player.browser.test.ts` drives mobile Chromium and skips without Playwright's browser).
- Examples must load, validate with zero errors, and simulate their scripted interactions (`examples/*/test.json`).
- `node evals/run.ts`: behavioral evals (`evals/README.md`). Claude Code runs headless against `sonobe mcp --headless` on each case's start project with only Sonobe's tools, and the finished project is simulated and checked on layer properties. It records pass or fail, turns, tokens, time, tools, and each error code with whether the next call to that tool succeeded. It uses the person's Claude account, runs by hand, and isn't part of `npm test` or CI; `npm test` covers the runner and checks every case's start fails and its reference solution passes.
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
- **SF Symbols** (`symbols.ts`, `dom/symbols.ts`): HTML marks a symbol with `<svg data-sf-symbol="heart.fill"></svg>`, sized, weighted and colored by CSS `font-size`, `font-weight` and `color` (plus `data-sf-palette` and `data-sf-scale`). Both capture hosts read the page through `walkPage`: `SYMBOL_COLLECT_SOURCE` waits for the page the way the walker does and lists the placeholders; the host's `SymbolRenderer` draws each distinct one; `SYMBOL_APPLY_SOURCE` puts the drawings in with ids made unique per symbol; then the walker runs. A drawn symbol is an ordinary SVG image layer named after the symbol at icon rank, so `data-name`, the placeholder's own `aria-label` or component name, or a named wrapper that disappears still names it. The renderer is the sfsymbol helper (§9.1): `--batch` takes JSON lines, and SwiftUI's `Image(systemName:)` draws each symbol into a PDF context, whose paths and soft masks become SVG. SwiftUI lays a symbol out by its frame but doesn't clip it there, so a badge can reach past it: the answer's `overflow` says how far, the drawing covers that too, the page lays out the frame and paints the rest around it, and the layer grows to hold all of it. Symbols with masks inside masks (which resvg can't draw) come back as 3x PNGs; unknown names come back with the closest names; Apple's usage restrictions come along as notes. A host that can't draw them (not a Mac, macOS 12, no helper, the browser editor, the Chrome extension) leaves 1em gray placeholders named after the symbol, and a note says why. Symbol artwork is drawn on the person's Mac at import time and never stored in this repository.
- **Figma** (`figma.ts`): `figmaToCapture(selection, { exportSvg, imageData })` maps structural Figma nodes (frames, instances, rectangles, circles, text, and vectors as SVG exports) onto the capture format; the plugin in `integrations/figma-plugin` supplies the plugin API and copies the result.
- **Converter** (`convert.ts`): `planImport(capture, doc, images, options)` returns the ops, the asset files to store first, the screen's ref, a summary and notes. Frames become groups (rectangles when empty, hit areas when they're only tap targets), uniform borders become strokes and other borders thin rectangles, gradients and background images become child layers, the largest outer shadow becomes the layer shadow (a spread-only ring becomes an outside stroke), single-line text hugs its text and grows from its alignment edge, and paragraphs keep their width. Identical image bytes reuse an existing asset. `replace` swaps an earlier screen in the same batch: layers found again at the same name path keep their ids and linked properties (text an earlier import named by its words is also found by its words, and images, checkbox marks and text field boxes by the names earlier imports gave them), other items' connections to them are restored, layers not found again never take an old layer's id, the notes name every connection it had to drop, `dropped` lists the old layers not found again, and a note names them, and content that already scrolls doesn't get a second Scroll patch. Web fonts become font assets whose `font` field (family, weight, style, unicode-range) the renderer's `createFontAssetRegistry` turns into FontFaces in the editor and the phone player.
- **Hosts**:
  - Desktop: `apps/desktop/electron/design-capture.ts` renders in a hidden window with its own session partition (sandboxed, no preload, no permissions, downloads and new windows refused, only http(s) navigations), injects the walker with `executeJavaScript` (outside the page's CSP), draws SF Symbols with the bundled helper (`electron/symbols.ts`), and downloads images with that session. `colorScheme` loads `about:blank` first, then sets `prefers-color-scheme` over the debugger: a new window has no renderer until it navigates, and CDP's Emulation commands wait for one. The debugger stays attached until cleanup, because detaching drops the emulation. `AppHost.captureDesign` serves `import_design`; `putAssetFiles` sends bytes to the editor over the `assets.put` RPC. The preload's `sonobeHost.captureDesign` serves the editor's Import Design dialog. The dialog passes a `captureId` to follow the capture (`onCaptureDesignProgress`) and to stop it (`cancelCaptureDesign`), since an AbortSignal can't cross the context bridge. Reloading or closing the editor window also stops its captures, and so does quitting the app.
  - Browser editor: HTML renders in a sandboxed iframe (`allow-scripts`, opaque origin) that posts the capture back; URLs need the desktop app.
  - Canvas preview (`apps/editor/src/panels/design`): while the in-app Assistant writes `import_design`'s html, the editor draws it in a sandboxed iframe over the artboard (`allow-scripts` only, opaque origin, a CSP with `connect-src 'none'`; Claude's own scripts are dropped and only Tailwind's CDN script runs; desktop windows refuse subframe navigations other than `about:srcdoc`). It captures and writes nothing. MCP clients feed it too: `preview_design` keeps each session's draft beside the host (`packages/mcp/src/designPreviews.ts`, per document and session, dropped after 15 idle minutes, since servers are made per request), grows it one `append` at a time, and sends the whole draft through `SonobeHost.showDesignPreview`, which the desktop routes to the window showing that document over the `design.preview` RPC. The Assistant isn't given `preview_design`, since its `import_design` html already streams.
  - Headless: `@sonobe/import/node` renders with Playwright's Chromium when it's installed, and writes new asset files straight into the project's `assets/` folder. It draws SF Symbols with the helper `SONOBE_SFSYMBOL` names (`symbolHelper`).
- **Deadlines and cleanup** (`run.ts`): `createCaptureRun` gives each capture one deadline, 90 s plus `waitMs`, and both hosts route every await through its `step`. Single steps have budgets too: loading 30 s, the color scheme 5 s, reading the layers 45 s plus `waitMs`, drawing SF Symbols 20 s (past it they stay placeholders, with a note), the screenshot 15 s. A step that would outrun the deadline gets the deadline's error instead, `capture_timeout`, which names the stage ("It stopped while reading the page's layers"). Images and fonts still downloading 5 s before the deadline become placeholders, and a screenshot that fails is left out. Both come back as notes, not failures. A cancel or the deadline destroys the capture window (or closes Playwright's browser) at once, which also ends a page stuck in a loop and settles debugger commands still waiting. Every path frees the window, and no debugger stays attached.
- **Front doors**: File → Import Design… (URL, HTML, or a Claude prompt), pasting a capture on the canvas, the `import_design` MCP tool (`url`, `html`, `capture`, or `preview`: the draft `preview_design` drew on the person's canvas while Claude wrote it, imported without sending it again), the Chrome extension (`integrations/chrome-extension`: the service worker runs the walker in the tab's main world, embeds cross-origin images when the person allows it, and copies the capture; the element picker marks one element for the walker's `selector`), the canvas's Design with Claude box (through the Assistant's `import_design`), and `dryRun`, which plans an import without adding anything. Each import is one history group.
- **Checks**: `packages/import/scripts/fidelity.ts` renders fixture pages, imports them, draws the document with the DOM renderer, and writes source, imported and difference images side by side. `apps/desktop/tests/import-smoke.mjs` runs the desktop path against a local dev server.

