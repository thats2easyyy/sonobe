# @sonobe/engine

The headless runtime behind every Sonobe prototype. It compiles a document into an evaluation graph, runs it frame by frame (loops, pulses, per-index state, component instances, variables), resolves and lays out layers, and emits a `SceneFrame` for a renderer to draw. It also holds the building blocks the runtime and patches use: Rebound-exact springs, curves and tweens, momentum, layout, hit testing, gesture tracking, and smooth-corner paths.

It's pure TypeScript with no DOM, so the same code runs in the editor viewer, the web player, Node tests, the CLI, and MCP simulation. Contract types live in `src/types.ts`; see ARCHITECTURE.md §5.

- [Runtime API](#runtime-api)
- [Addressing values](#addressing-values)
- [Semantics](#semantics)
- [Writing patch definitions](#writing-patch-definitions)
- [Platform services](#platform-services)
- [Testing](#testing-sonobeenginetesting)
- [Building blocks](#building-blocks)

## Runtime API

```ts
import { createRuntime } from "@sonobe/engine";

const rt = createRuntime(doc, { registry, textMeasurer, seed: 1, fps: 60, deterministic: true, onLog });
rt.dispatch(events);                        // queue InputEvents for the next step
const frame = rt.step(dt);                  // advance one frame, get the SceneFrame
rt.getValue("pop.output");                  // item 0 of a loop unless "#n"
rt.getValue("@card.scale#2");               // layer props and outputs too
rt.getValue("card#2/toggle.on");            // inside component instances
rt.inspect("@card.position#3");             // { value, copies?, note? }: why a value reads as nothing
rt.trace(["pop.output"], 1000);             // simulate on a clone, with summaries
rt.updateDocument(nextDoc);                 // hot swap, keeping compatible state
rt.refreshScene();                          // re-layout the edited document without advancing time
```

`createRuntime(doc, options)` returns a `SonobeRuntime`: the contract `Runtime` plus a few inspection members.

| Member | What it does |
|---|---|
| `frame`, `time` | The last produced frame and its time in seconds. Before the first step (and after a restart) `frame` is `-1` and `time` is `0`. |
| `dispatch(events)` | Queues input for the next step. |
| `step(dt?)` | Advances one frame and returns the scene. Frame 0 always has `dt = 0`. Deterministic runtimes ignore `dt` and use `1 / fps`; live runtimes cap it at 64 ms. |
| `scene()` | The last produced frame, stepping once if there is none. |
| `getValue(address)` | Reads a value; see [Addressing values](#addressing-values). Loops give item 0 unless the address ends in `#n`; plain values broadcast to any `#n`. |
| `getRawValue(address)` | Like `getValue`, but returns whole Loops. |
| `inspect(address)` | `{ value, copies?, note? }`: what `getValue` reads, how many copies a layer drew last frame (or a component patch's instance ran), and a note when the value reads as nothing: the layer drew 0 copies (quoting its `empty_loop` warning), `#n` is past its copies, or why a loop is empty. |
| `trace(targets, durationMs, events?)` | See [Trace](#trace). |
| `updateDocument(doc)` | Recompiles and keeps state for patches whose id, type, and component path are unchanged. |
| `refreshScene()` | Rebuilds layout and the scene from current values (after `updateDocument`) without evaluating patches or advancing time, so `hitTest` and `scene()` reflect the edit. |
| `restart()` | Resets everything now (see [Restart](#restart)). |
| `hitTest(x, y)` | Front-most layer under a point, then its interactive ancestors, from the last scene. |
| `setDevice(overrides)` | Replaces the `device` overrides while the prototype runs (the phone turning, the appearance switching). Patches read them from the next frame; they outlive restarts, and traces replay with them. |
| `setLayerOutputs(key, values)` | Host-measured layer outputs by SceneNode key (`naturalSize`, `loading`, `currentTime`, `duration`...). Readable from the next evaluation. |
| `issues()` | Compile issues plus the most recent 200 runtime issues, deduplicated, each with an optional `hint` and `suggestions` (ops that fix it). |
| `patchTimings()` | Average evaluate time per patch (all instances and loop indices) over the last ~1 s of frames, slowest first: `{ patchId, componentPath, ms }`. Empty while profiling is off. |
| `setProfiling(on)` | Turns timing on or off (off discards collected timings). `options.profile` turns it on at creation. When off, evaluation does no timing work. |
| `needsNextFrame` | Something is still moving: a patch called `requestNextFrame()` last frame, or a feedback loop's back-edge would read a different value next frame. |
| `services` | The `RuntimeServices` handed to patches. |
| `document`, `deterministic`, `fps` | The current document and mode. |
| `dispose()` | Calls every `dispose` and stops the runtime. |

Options (`RuntimeOptions`): `registry` (an `EngineRegistry`; build one with `createEngineRegistry(definitions)`), `textMeasurer` (default: approximate metrics), `seed` (default 1), `fps` (default `project.fps` or 60), `deterministic`, `platform` (network, audio, speech... passed through to patches), `resolveAssetUrl`, `mediaInfo` (host media knowledge, consulted first by `services.mediaInfo`), `onLog(level, args, source?)`, `device` overrides, and `profile`.

`onLog`'s `source` is `{ patchId, componentPath }` for lines logged while a patch evaluates (`componentPath` is the instance path, e.g. `"main/card#2"`), and undefined otherwise (async callbacks, dispose).

### Frame pipeline

Each `step`:

1. Performs a pending `services.restart()`.
2. Applies queued input. Hit tests use the **previous** frame's scene (before frame 0, a scene laid out from authored props).
3. Evaluates patches in compiled order.
4. Resolves layer props, replicates looped layers, runs layout, and builds the scene.
5. Stores layer geometry and replication counts, which patches read on the **next** frame (gap-fill R2).

## Addressing values

`getValue`, `getRawValue`, and `trace` targets accept:

| Address | Reads |
|---|---|
| `patchId.port` | A patch output, or this frame's coerced input. `instanceId.key` reads a patch component's published output. |
| `@layerId.key` | A layer prop, layer output, or a component layer's published output. |
| `instancePath/patchId.port` | A patch inside a component instance: live outputs and inputs of that instance. |
| `instancePath/$in.key` | A published input as the instance sees it. |
| `$knob.knobId` | A knob's running value: one constant everywhere, never `#n`. |
| `@instancePath/layerId.key` | A layer inside a layer component instance. |

`instancePath` is a `/`-separated list of instance ids from the root, each with an optional `#k` copy index: `card`, `card#2`, `card#2/badge`. It matches SceneNode key prefixes, so a hit-test key like `card#2/button` becomes `@card#2/button.size`. A leading root component id is accepted too (`main/card#2/toggle.on`), matching `ctx.componentPath`. An instance id may name a `component` patch or a `componentInstance` layer. Copy indices only select copies of instances that are actually replicated; an unreplicated instance ignores `#k`. The loop-index suffix still comes last: `card#2/list.output#3`. Unknown paths read as `undefined`.

## Semantics

### Compiling the graph

- **Scopes.** The root prototype is a scope. Each `component` patch and each `componentInstance` layer is inlined as a child scope, recursively (depth ≤ 32; a component that would contain itself raises `component_cycle`). Inner patches evaluate once per *instance path*: `"main"`, `"main/card"`, or `"main/card#2"` when the instance is replicated. That path is `ctx.componentPath`.
- **Bindings.** Every input and prop compiles to a binding: a decoded literal or default, a patch output, `"$in.key"`, a published output (`"instanceId.key"` or `"@instanceLayer.key"`), a layer output, or another layer's prop (`"@layer.prop"` reads through to whatever drives that prop, in the same frame).
- **Order.** Nodes sort topologically on the flattened graph, so grouping patches into a component never adds latency.
- **Cycles.** Inside a cycle, some cables become back-edges: their consumer evaluates first and reads the driver's previous-frame value (`ctx.isFeedback(key)` is true; on frame 0 there is no previous value and the input uses its default). The rule matches core's feedback-loop diagnostics:
  1. every cable into a Delay One Frame;
  2. then, while a cycle remains, one cable per remaining cycle, preferring **visually backwards** cables (source `ui.x` ≥ target `ui.x`);
  3. ties and non-backwards cycles go to the cable into the lowest target id (then source id).

  Positions compare in the nearest graph containing both patches: a patch inside a component sits where its component patch sits. Layer component instances have no position, so their cables fall through to id order.
- **Rejected wiring.** A patch output wired into its own input (`self_edge`), or a published input that reaches itself through pass-through outputs with no patch in between (`zero_latency_cycle`), uses the port default and raises an issue.
- **Natively evaluated types.** `component`, `delay1`, `variableBroadcaster`, and `variableReceiver` are evaluated by the engine. Registries may declare their specs; `createEngineRegistry` supplies fallbacks.
- **Missing pieces.** An unknown type raises `unknown_patch_type`; a spec without an evaluator raises `unimplemented_patch` and its outputs hold their defaults. Links to things that don't exist raise `dangling_link`, and the input uses its default (`isConnected` is false).

### Inputs and coercion

Each frame an input receives its driver's value coerced to the port's declared type with core `coerce` (every item of a loop is coerced). Literals decode once at compile time; `{ "loop": [...] }` literals become Loops. Unconnected inputs use the port default, with `variantDefaults` for the active variant. A color port without a declared default is transparent `{ r: 0, g: 0, b: 0, a: 0 }` (the zero value), not opaque black. Patch outputs are trusted: write values of the declared type.

`ctx.inputCount` is core's variadic count (clamped to the VariadicSpec range, else its `defaultCount`); for specs that declare `inputCountRange` instead (repeated port groups such as keyframes or gradient stops), `node.inputCount` clamped to that range (else its `defaultCount`); otherwise `node.inputCount ?? 0`.

### Loops

- A patch fed Loops evaluates once per index. The loop count is the longest input loop; shorter loops wrap (index mod length) and plain values broadcast. Any empty input loop makes the count 0: nothing evaluates and every output is an empty Loop.
- **Length-1 rule.** Outputs are assembled into Loops only when the count isn't 1. A one-item loop evaluates once and its outputs are plain values, so a Count 1 loop behaves like a single value downstream. (Replicated component outputs are the exception below.)
- **Whole loops.** If any port of a definition is `wholeLoop`, the patch evaluates once per frame. `ctx.inputItems(key)` returns every item at its own length (plain values as one-item arrays), `ctx.input(key)` returns item 0, and writing an array or Loop to a `wholeLoop` output produces a Loop (other values become a one-item Loop).
- **Per-index state.** `definition.state()` runs once per instance path × index. When the count shrinks, removed indices are disposed and dropped; new indices start fresh.
- **Sticky outputs.** An output keeps its last written value for that index until written again. Pulse outputs reset to false before each evaluation.
- Loops are capped at 10,000 items (`loop_limit`).
- **Empty loops across frames.** Last frame's empty loop never erases this frame's copies. A back-edge that carries an empty loop into a per-item input reads the input's default, as on frame 0 (a whole-loop input still sees the empty loop), and a component's copy count skips an empty loop it reads through a back-edge. Within one frame an empty loop still wins.
- **`empty_loop`.** When an empty loop erases a non-empty one, or a patch explains its empty output with `ctx.explainEmpty(reason, fixes)` (Loop Select, for indices past the end), and a layer or component makes 0 copies, the runtime raises a warning naming the site, where the empty loop started, what it erased and any feedback cable, with fixes as setInput suggestions. It needs two frames in a row after frame 0, lasts while the site has 0 copies, and clears on `updateDocument`. Only frames where something was erased or explained pay for the walk.

### Pulses

- `ctx.pulsed(key)` fires when the driver is a pulse output that fired this frame, or when a non-pulse driver's on/off reading rises false → true for that index. Pulses on consecutive frames each count.
- Rising-edge history starts off, so a boolean that's already on at frame 0 counts as rising, and a loop index that appears while on fires once on its first frame. `ctx.isPulseSource(key)` tells a real upstream pulse from a held state, so first-frame pulses can be told from states that start on.
- `ctx.input(key)` on a pulse port returns `ctx.pulsed(key)`.
- `ctx.changed(key)` is false on an instance's first frame and for new indices (gap-fill R1). Patches that compare against the previous frame seed from the first value, so frame 0 has no spikes and no false pulses.
- Same-frame precedence is each patch's own rule (Switch: turn off > turn on > flip).

### Muting

A muted patch doesn't evaluate. `PatchDefinition.mutedBehavior` decides the outputs:

- `"bypass"` (default): variant outputs pass the first variant input (a muted number Transition outputs Start, not Progress); other outputs pass the first non-variant input of the same type; either falls back to any input of the same type. A port only passes to one of the same shape, whole-loop to whole-loop and per-item to per-item, so muting never changes how many copies something makes (a muted Loop Sum outputs 0, not its loop). Unmatched outputs emit zero values (an empty Loop for a whole-loop output) and pulses never fire.
- `"zero"`: every output emits its zero value (Interaction, Velocity, Layer Info).
- `"evaluate"`: `evaluate` runs and the patch checks `ctx.muted` itself.

`ctx.muted` is true when the patch or an enclosing component instance is muted. A muted component instance keeps every inner state without evaluating; each published output passes the first published input of the same type.

### Components

- **Published inputs** read the host's driver coerced to the published type, else the instance's literal, else the interface default.
- **Copies.** Published inputs whose `loopBehavior` is `"loop"` (the default) replicate the instance when they carry Loops: copy *k* sees item *k* (wrapping), `"pass"` inputs arrive whole, and plain values broadcast. Each copy has its own state (`"main/tally#1"`), and removed copies dispose. Copy 0 shares state with the unreplicated instance, so an input changing from a plain value to a one-item loop resets nothing.
- **Published outputs** are the inner value when not replicated. A replicated instance always outputs a Loop, flattening loops from copies into one flat loop.
- **Layer components.** A `componentInstance` layer renders the component's layers as children keyed `instanceId/innerId`, then its own children. Its published input props feed the component; its size defaults to the component's size. Loops on its published inputs or on its bound common props (position, opacity...) replicate the instance as `instanceId#n`, with inner keys `instanceId#n/innerId`.
- Limitation: a component instance inside a group replicated by a *different* loop shares one set of inner patches across those copies; its inner layer references resolve to copy 0.

### Variables

A receiver resolves statically by trimmed name, scope, and type: local looks only in its own graph, global walks up through enclosing instances, and the nearest match wins (lowest id on ties). It compiles to an implicit edge from the broadcaster's `value` driver, so it sorts like a cable (a cycle through a variable reads the previous frame). Unresolved receivers raise `unresolved_variable` and a type mismatch raises `variable_type_mismatch`; both output zero values, as do receivers of muted broadcasters.

### Layers and the scene

- Props resolve per layer: literal, link (coerced to the prop type), or the layer type's default.
- **Null defaults.** Props declared with a null default (`cornerRadii`, `gradient`, `image`, `video`, `shape`, `effects`...) stay `null` in `SceneNode.props` while unset, when the document stores `null`, and when a link delivers `null`; they never become zero arrays.
- **Replication.** A layer whose bound props carry Loops replicates, one copy per item, keyed `layerId#n`. Descendants of copy *n* take item *n* of their own looped props and are keyed `childId#n`. They don't replicate again, because loops of loops come from components.
- **Repeat.** A set `repeat` prop alone decides the count: a whole number makes that many copies, and a linked loop one per item (a linked plain number is rounded down; anything else makes 1 copy and raises `repeat_not_a_count`). The layer's other looped props are then read per copy (`copy % length`), and an empty one reads the prop's default. `props.repeat` and `@layer.repeat` hold the count. A Repeat under a layer that already makes copies is ignored.
- A layer that drew 0 copies last frame reads, for per-item readers (Interaction, a layer property), as one reference, exactly as before the first frame, so an Interaction on it runs once and stays idle. Whole-loop readers like Loop Count still see an empty loop.
- `enabled: false` sets `visible: false`. A Color Fill fills its parent. A Clone is emitted as a leaf with `props.source`, and the renderer draws the copy.
- `SceneNode.transform` is `mat4.compose` with the laid-out top-left, pivot, scale × Scale XYZ, rotations, and zPosition. `worldTransform` is the parent's world × local.
- **Paint order.** `roots` and `children` stay in document order, so keys and "first copy" lookups are stable. `paintOrder(nodes)` gives the order siblings draw and take touches, back to front: zPosition ascending, ties in document order, missing or non-finite as 0. It only reorders siblings; a child never leaves its parent. The hit test, the DOM and SVG renderers, the renderer's cursor query and the editor canvas all use it. It returns the same array when nothing is lifted, and `paintIndices` returns null then. `props` holds every resolved prop, text styles included. The background comes from `project.background` (white by default), and the scene size is the device screen size.
- Layer geometry from the previous frame feeds `services.layerInfo`: the layer `type`, the anchor-point position in parent space, the laid-out size, scale × Scale XYZ, anchor, `worldTransform`, content size, and `parent`. `parent` is a `LayerRef` to the scene parent (with its loop instance), scoped like the child's reference: a component's top-level layers have the instance layer as parent, and `services.layerInfo(info.parent)` resolves inside the right instance.

### Layer references and layer outputs

- A `{ "layer": id }` input becomes a `LayerRef`. When that layer was replicated on the previous frame it becomes a Loop of references with `instance` set, so an Interaction on a looped layer evaluates per copy and its outputs loop.
- References are scoped to the instance that created them: `services.pointer(ref)` inside `"main/card#2"` targets `card#2/button`.
- Layer outputs: host-reported values from `setLayerOutputs`; Text `textSize` from the previous layout; Text Field `value`, `isFocused`, and `submitted` from `text`, `focus`, and `submit` events. Changing a Text Field's Text prop replaces what was typed.
- Layer pulse props (Text Field's `setText`, `beginEditing`, `endEditing`) fire like a patch's pulse inputs, on a pulse or a connected boolean's rising edge. A `layerPulse` input event (`{ layerId, key?, prop }`) fires one directly, as the Inspector's Fire button does; traces replay it.

### Input and gestures

- Hit tests run front to back in paint order (zPosition first, then later siblings) through world transforms; touches bubble to interactive ancestors.
- A mouse or pen **hovers** over whatever is under it, including while a button is held (re-hit-tested every frame as it moves). Touches never hover. `leave` ends hover but not a press.
- Snapshots carry `pressure` (event pressure clamped 0–1; without one, touch and pen press at 0.5 and mouse at 0), `buttons` (the DOM bitmask from the event's `buttons`, else from `button`, primary by default; chords update it on move), `cancelled` (every press that ended this frame was cancelled), and `pointerType`.

### Services

| Service | Behavior |
|---|---|
| `random()` | Mulberry32 seeded with `options.seed`; reseeded on restart. |
| `now()` | Deterministic runtimes return `2026-01-01T00:00:00Z + time`. Live runtimes return the wall clock. |
| `deterministic` | True for fixed-dt simulation (tests, trace, MCP). Patches use it for UTC clocks and budgets instead of guessing from `now()`. |
| `restartCount` | Restarts performed so far (0 before the first). |
| `pointer(ref)` | Pointer snapshot for the layer (or the whole screen for null), with local position through the layer's inverse world transform. A missing layer reads as never pressed. |
| `pointers(ref)` | Every pressed pointer whose press hit chain contains the layer (null = all), sorted by press time then id: `{ id, position, pressure, startTime, buttons }`. |
| `keyboard()`, `wheel()` | This frame's keys and text; wheel delta, position, and velocity. |
| `layerInfo(ref)` | Previous frame's geometry (see above). |
| `layerOutput(ref, key)` | A layer output by reference: host-reported, else derived (`textSize`, text field state), else undefined. |
| `mediaInfo(ref)` | `{ status, width, height, duration, name }` for an AssetRef: `options.mediaInfo` first; then outputs reported for a layer showing that reference (`naturalSize`, `loading`, `duration`) over the document's asset record. An asset id missing from the document is `"error"`; an unseen URL is undefined. |
| `device()` | `project.device` preset plus the host's overrides (`options.device`, replaced by `setDevice`); `orientation` events swap the screen size, rotate safe areas, and set `orientationAngle` when they carry `angle`. `timeZone` is `options.device.timeZone`, else `"UTC"` when deterministic, else the host's IANA zone. |
| `measureText(text, style, maxWidth)` | Measures with the injected `TextMeasurer` (the same rules as Text layer layout). |
| `readScript(file)` | `doc.scripts[file]` (a leading `scripts/` is accepted), or undefined. |
| `log(level, ...args)` | Calls `options.onLog` with the source patch. Warnings and errors also become issues (`patch_warning`, `patch_error`). |
| `issue(code, severity, message)` | Raises a runtime issue with a specific code, attributed to the evaluating patch and deduplicated until restart. |
| `restart()` | Requests a restart before the next step. |
| `resolveAssetUrl`, `platform` | Passed through from options. `platform.deviceMotion` falls back to the last `deviceMotion` event; simulated samples carry `attitude` only when the event did. |

Runtime issues raised while a patch inside a component instance evaluates carry `componentPath` (the instance path) and deduplicate per static scope; root issues omit it.

### updateDocument

`updateDocument` first tries `updateLiterals`: when the new document differs only in literal patch inputs, literal layer properties, or patch positions (outside cycles), it rewrites the compiled constant bindings in place, so scrubbing a value, dragging a layer, or a small agent write costs almost nothing and keeps all state. Inputs that read `$knob.<id>` compile to constants registered as knob readers, so a knob tune or a preset switch is written in place too; a knob that goes, changes type or options, or appears for a link that named it recompiles. Anything else recompiles and moves per-path records to nodes with the same `componentPath:id` and type. State, sticky outputs, and input history carry over, remapped by port key, so springs keep their velocity. Outputs whose type changed restart from their defaults. Delay One Frame resets when its variant changes. Removed or retyped patches dispose. Variables re-resolve. The scene updates on the next step, or immediately with `refreshScene()`.

### Restart

`restart()` (or a `services.restart()` request, performed before the next step) disposes every state, sets `frame` to -1 and `time` to 0, reseeds randomness, forgets pointers, typed text, orientation and motion, and the previous scene, clears runtime issues and the `warnOnce` ledger, and increments `restartCount`. Host-reported layer outputs survive, because they describe media, not prototype state. Queued input applies to the new frame 0.

### Trace

`trace(targets, durationMs, events?)` builds a separate deterministic runtime from the document at the last restart and replays this runtime's recorded steps, document updates, scene refreshes, and layer outputs, which reproduces the live state. The replay log keeps 7,200 frames since the last restart; beyond that, `trace` throws `TraceUnavailableError` (code `"trace_unavailable"`, see `isTraceUnavailable`) rather than tracing a restarted copy, until the prototype restarts. Replay cost grows with the frames since the restart. It then steps at `1 / fps`, sampling `getValue(target)` after each step (any address above works, including instance paths). `times` are seconds from the trace start: a fresh runtime's first sample is frame 0 at 0 s, and a continued one's first sample is at `1 / fps`. Plain events dispatch on the first traced frame; `{ atMs, events }` dispatch on the first frame at or after `atMs`. The clone has no platform services, no `onLog`, and no profiling, so traces never cause side effects, and the live runtime is never touched.

Summaries cover numbers, booleans (0/1), and vectors (the component that moves the most): `min`, `max`, `start`, `end`, `overshoot` (past the end in the direction of travel), and `settleTime`. `settleTime` is the first time after which the value stays within 0.1% of its final value, measured against the larger of the final magnitude and the range; it's null when the value was still moving within the last 50 ms. Other value types summarize to null.

## Writing patch definitions

A definition is a `PatchSpec` plus an evaluator:

```ts
import type { PatchDefinition } from "@sonobe/engine";

export const switchPatch: PatchDefinition<{ on: boolean }> = {
  type: "switch",
  name: "Switch",
  category: "state",
  summary: "Remembers whether something is on or off and changes when it gets a pulse.",
  mutedBehavior: "zero",
  inputs: [
    { key: "flip", name: "Flip", type: "pulse", description: "Pulse to switch to the opposite state." },
    { key: "turnOn", name: "Turn On", type: "pulse", description: "Pulse to turn the switch on." },
    { key: "turnOff", name: "Turn Off", type: "pulse", description: "Pulse to turn the switch off." },
  ],
  outputs: [{ key: "on", name: "On", type: "boolean", description: "True while the switch is on." }],
  state: () => ({ on: false }),
  evaluate(ctx) {
    if (ctx.pulsed("turnOff")) ctx.state.on = false;
    else if (ctx.pulsed("turnOn")) ctx.state.on = true;
    else if (ctx.pulsed("flip")) ctx.state.on = !ctx.state.on;
    ctx.output("on", ctx.state.on);
  },
};
```

Using `PatchContext`:

- `ctx.input(key)` gives this index's value, already coerced to the declared type. Reading an undeclared key raises an `unknown_port` issue and returns undefined.
- `ctx.inputItems(key)` is for `wholeLoop` ports.
- `ctx.pulsed(key)` fires on an upstream pulse or a rising edge. `ctx.changed(key)` compares with last frame for this index. `ctx.isConnected(key)` is true when a link drives the port.
- `ctx.isPulseSource(key)` is true when a pulse output drives the input (vs a held state). `ctx.isFeedback(key)` is true when the input is a back-edge that reads last frame's value.
- `ctx.output(key, value)` and `ctx.pulse(key)` write outputs. Outputs are sticky; pulses last one frame.
- `ctx.state` is per instance path × loop index; mutate it or replace it. Keep it plain data where you can. `dispose(state, services)` runs when an index is dropped, the patch is removed or retyped, the prototype restarts, or the runtime is disposed.
- `ctx.dt` and `ctx.time` are seconds (`dt` is 0 on frame 0). `ctx.frame` counts from 0 after each restart. `ctx.loopIndex` and `ctx.loopCount` describe per-index evaluation; `ctx.componentPath` identifies the instance.
- `ctx.typeParam`, `ctx.inputCount`, `ctx.muted`, and `ctx.node` (settings, name) come from the document.
- `ctx.warnOnce(key, message)` logs a warning at most once per patch instance and key until the prototype restarts (a warning that only fires on frame 0 repeats after each restart). Use `ctx.services.issue(code, severity, message)` for coded problems.
- Call `ctx.requestNextFrame()` while animating or waiting.
- Use `ctx.services` for randomness, clocks, pointers, layer info, device, text measurement, scripts, logging, issues, restart, assets, and platform APIs. Never use `Math.random`, `Date.now`, or DOM APIs.
- Never call `ctx.output` from a callback: store async results in `state` and output them on a later `evaluate`.
- Exceptions are caught and reported as `patch_threw`; outputs keep their last values.
- Declare `mutedBehavior` when the default bypass is wrong for the patch.

`RuntimePatchDefinition` is kept as an alias of `PatchDefinition` for existing callers.

## Platform services

`RuntimeServices.platform` (from `options.platform`) is how hosts expose capabilities. Every member is optional; patches log once and output idle values when one is missing, and trace clones get none. The contract types in `src/types.ts` are the host checklist:

| Member | Shape |
|---|---|
| `fetch(url, init?)` | `init: { method, headers, body: string \| { form: FetchFormField[] }, signal, onChunk }` → `{ ok, status, url?, headers?, text() }`. Form fields with media values upload files; `onChunk` streams text as it arrives. |
| `readBytes(ref)` | `Promise<ArrayBuffer>` for an asset, URL, or live capture. |
| `webSocket(url, { headers?, protocols? })` | A `PlatformWebSocket` handle: `send`, `close(code?, reason?)`, `bufferedAmount?`, and `onopen` / `onmessage(text)` / `onclose(code, reason?)` / `onerror(message?)` handlers the patch assigns. |
| `openUrl(url)` | `void`, `boolean`, or `Promise<boolean>`; false means it didn't open. |
| `speak(text, { rate, pitch, voice, volume })` | `void`, or `Promise<"ended" \| "interrupted">` when the host tracks completion; `stopSpeaking()`. |
| `vibrate(pattern)`, `haptic` | `haptic: { supports(type), play(type, pattern?) }`. |
| `deviceMotion()` | `{ acceleration, rotationRate, attitude? }`. |
| `geolocation` | `watch(onFix({ latitude, longitude, accuracy }), onError(message)) → { stop() }`. |
| `gamepads()` | `(GamepadSnapshot \| null)[]`: `{ connected, mapping, buttons[{ pressed, value }], axes, motion? }`. |
| `softKeyboard()`, `bluetooth` | Soft keyboard visibility and height; Bluetooth LE `connect({ service, characteristic, namePrefix? }) → BluetoothLink`. |
| `audio` | Keyed voices: `play(key, source: AssetRef, { from, loop, volume, rate, pitch, pan })`, `pause`, `seek(key, seconds)`, `update(key, opts)`, `stop`, `state(key) → { status, currentTime, duration, ended, loops }`, and optional `meter(source, bands) → { rms, peak, bands }`. |
| `pickMedia({ accept, multiple })`, `releaseMedia(ref)`, `snapshot(layer \| null, { scale })` | Photo and video picking, releasing host-created references, and rendering a layer to an image. |
| `media` | Capture keyed by patch instance: `openCamera(key, { facing, quality })`, `openMicrophone(key)`, `close(key)`, `captureFrame(key)`, `startRecording(key, { audio })`, `stopRecording(key) → AssetRef \| null`, `level(key)`, `frameId(layer)`, `readPixels(layer, maxSize)`. |
| `detect` | `faces`, `hands`, `qrCodes` detectors over a layer's picture. |

## Testing: `@sonobe/engine/testing`

Test helpers are ordinary modules with no Vitest imports, so the CLI, MCP, and example checks can use them too.

```ts
import { buildDoc, createTestRuntime, runFrames, tap, runPatch, mockSwitch } from "@sonobe/engine/testing";

const doc = buildDoc({
  layers: [{ id: "card", type: "rectangle", name: "Card", props: { size: [200, 120], scale: { link: "grow.output" } } }],
  patches: {
    touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
    toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
    grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "toggle.on" }, start: 1, end: 1.2 } },
  },
});
const rt = createTestRuntime(doc);          // deterministic, seed 1, mock definitions
runFrames(rt, 1);
runFrames(rt, 2, tap(100, 60));             // down on one frame, up on the next
expect(rt.getValue("@card.scale")).toBe(1.2);
```

- `buildDoc(input, registry?)` builds a document through core `applyOps`: components first (interface inputs, layers, patches, links, connections, then published outputs), then the root graph, then extra `ops`. Invalid wiring throws with core's errors. Patches are auto-placed left to right in the order listed, which decides visually backwards cables.
- `createTestRuntime(doc, definitionsOrRegistry?, options?)` accepts an `EngineRegistry`, or definitions added to (and replacing) the mocks.
- `runFrames(rt, n, events?)` dispatches `events[i]` before step *i*. Events can be an array, a record keyed by frame, or a function.
- Generators: `tap`, `drag`, `keyPress`, `idle`, `pointerEvent`, `sequence` (concatenate scripts).
- `runPatch(definition, framesOfInputs, options?)` runs one definition in isolation through the runtime's own evaluator. Inputs hold until changed; pulse inputs fire only on frames that set them (or on rising edges with `edgeInputs`). Options: `typeParam`, `inputCount`, `settings`, `muted`, `fps`, `seed`, `connected`, `services`, and `doc`. Services are deterministic (UTC, `restartCount` 0, approximate `measureText`, `readScript` from `doc`, `issue` collected per patch). Each frame reports `outputs`, fired `pulses`, and `requestedNextFrame`. The result also collects `logs`, `issues`, `restarts`, and `states`, plus a `dispose()`.
- Mocks: `mockInteraction`, `mockSwitch`, `mockCounter`, `mockAdd`, `mockMultiply`, `mockTransition`, `mockPopAnimation`, `mockLoop`, `mockLoopSum`, `mockWhenPrototypeStarts`, `mockRestartPrototype`, `mockLogger`, `mockTime`, `mockRandom`, `mockVelocity`, `mockPulseOnChange`, `mockLayerInfo`, and `mockSplitter`. Factories: `sequenceDefinition` (scripted outputs per frame), `probeDefinition` (records component paths and disposals), and `defineMock` with `port`.

## Building blocks

- `physics/`: Rebound-exact springs and converters, curves, tweens, and momentum (`MomentumScroller`).
- `math/`: `mat4` (`compose`, `multiply`, `planeInverse`...), `vec`, polyline simplification, and `squirclePath(x, y, w, h, radii, smoothing)`: smooth-corner rectangle path data shared by the renderer and Rounded Rectangle Shape. Non-finite inputs never produce NaN.
- `layout/`: `computeLayout` and the approximate `TextMeasurer`.
- `hittest/`: `hitTest` over a scene, and `paintOrder`, `paintIndices` and `stackDepth` for the sibling order every surface draws and hits in.
- `gestures/`: `PointerTracker` (taps, drags, velocity from event timeStamps, hover while held, pressure, buttons, cancelled presses, `pointers(target)`), `KeyboardTracker`, `WheelTracker`, `TextInputTracker`, and `InputTracker` (all together).
- `runtime/`: `createRuntime`, `compileDocument`, `createEngineRegistry`, loop helpers (`makeLoop`, `isLoop`, `loopItemAt`...), `valuesEqual`, `zeroValue`, `portDefault`, `coerceValue`, `mulberry32`, `summarizeSeries`.

`SonobeRuntime` adds `document`, `deterministic`, `fps`, `needsNextFrame`, `services`, `setProfiling`, and a non-optional `patchTimings` to the contract `Runtime`. `PointerTracker.snapshot(target, worldInverse, exact)` and `pointers(target, exact)` match exact scene keys, so a root layer `button` never matches a component's inner `button`.
