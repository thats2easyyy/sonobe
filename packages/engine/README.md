# @sonobe/engine

The headless runtime behind every Sonobe prototype. It compiles a document into an evaluation graph, runs it frame by frame (loops, pulses, per-index state, component instances, variables), resolves and lays out layers, and emits a `SceneFrame` for a renderer to draw. It also holds the building blocks the runtime and patches use: Rebound-exact springs, curves and tweens, momentum, layout, hit testing, and gesture tracking.

It's pure TypeScript with no DOM, so the same code runs in the editor viewer, the web player, Node tests, the CLI, and MCP simulation. Contract types live in `src/types.ts`; see ARCHITECTURE.md §5.

- [Runtime API](#runtime-api)
- [Semantics](#semantics)
- [Writing patch definitions](#writing-patch-definitions)
- [Testing](#testing-sonobeenginetesting)
- [Building blocks](#building-blocks)
- [Engine extensions to the contract](#engine-extensions-to-the-contract)

## Runtime API

```ts
import { createRuntime } from "@sonobe/engine";

const rt = createRuntime(doc, { registry, textMeasurer, seed: 1, fps: 60, deterministic: true, onLog });
rt.dispatch(events);                        // queue InputEvents for the next step
const frame = rt.step(dt);                  // advance one frame, get the SceneFrame
rt.getValue("pop.output");                  // item 0 of a loop unless "#n"
rt.getValue("@card.scale#2");               // layer props and outputs too
rt.trace(["pop.output"], 1000);             // simulate on a clone, with summaries
rt.updateDocument(nextDoc);                 // hot swap, keeping compatible state
```

`createRuntime(doc, options)` returns a `SonobeRuntime`, which implements the contract `Runtime` plus a few inspection members.

| Member | What it does |
|---|---|
| `frame`, `time` | The last produced frame and its time in seconds. Before the first step `frame` is `-1` and `time` is `0`. |
| `dispatch(events)` | Queues input for the next step. |
| `step(dt?)` | Advances one frame and returns the scene. Frame 0 always has `dt = 0`. Deterministic runtimes ignore `dt` and use `1 / fps`; live runtimes cap it at 64 ms. |
| `scene()` | The last produced frame, stepping once if there is none. |
| `getValue(address)` | `"patchId.port"` (outputs, or this frame's coerced inputs), `"instanceId.key"` (patch component outputs), `"@layerId.key"` (props, layer outputs, published outputs of component layers). Loops give item 0 unless the address ends in `#n`; plain values broadcast to any `#n`. Root component only. |
| `getRawValue(address)` | Like `getValue`, but returns whole Loops. |
| `updateDocument(doc)` | Recompiles and keeps state for patches whose id, type, and component path are unchanged. |
| `restart()` | Resets everything now (see [Restart](#restart)). |
| `hitTest(x, y)` | Front-most layer under a point, then its interactive ancestors, from the last scene. |
| `setLayerOutputs(key, values)` | Host-measured layer outputs by SceneNode key (`naturalSize`, `currentTime`...). Readable from the next evaluation. |
| `issues()` | Compile issues plus the most recent 200 runtime issues, deduplicated. |
| `trace(targets, durationMs, events?)` | See [Trace](#trace). |
| `needsNextFrame` | A patch called `requestNextFrame()` last frame. |
| `services` | The `RuntimeServices` handed to patches. |
| `dispose()` | Calls every `dispose` and stops the runtime. |

Options (`RuntimeOptions`): `registry` (an `EngineRegistry`; build one with `createEngineRegistry(definitions)`), `textMeasurer` (default: approximate metrics), `seed` (default 1), `fps` (default `project.fps` or 60), `deterministic`, `platform` (network, audio, speech... passed through to patches), `resolveAssetUrl`, `onLog`, and `device` overrides.

### Frame pipeline

Each `step`:

1. Performs a pending `services.restart()`.
2. Applies queued input. Hit tests use the **previous** frame's scene (before frame 0, a scene laid out from authored props).
3. Evaluates patches in compiled order.
4. Resolves layer props, replicates looped layers, runs layout, and builds the scene.
5. Stores layer geometry and replication counts, which patches read on the **next** frame (gap-fill R2).

## Semantics

### Compiling the graph

- **Scopes.** The root prototype is a scope. Each `component` patch and each `componentInstance` layer is inlined as a child scope, recursively (depth ≤ 32; a component that would contain itself raises `component_cycle`). Inner patches evaluate once per *instance path*: `"main"`, `"main/card"`, or `"main/card#2"` when the instance is replicated. That path is `ctx.componentPath`.
- **Bindings.** Every input and prop compiles to a binding: a decoded literal or default, a patch output, `"$in.key"`, a published output (`"instanceId.key"` or `"@instanceLayer.key"`), a layer output, or another layer's prop (`"@layer.prop"` reads through to whatever drives that prop, in the same frame).
- **Order.** Nodes sort topologically on the flattened graph, so grouping patches into a component never adds latency. Inside a cycle, the engine picks back-edges deterministically: edges into Delay One Frame first, then (only when nothing is free) the earliest node by id. A consumer of a back-edge evaluates before its driver and reads last frame's value. On frame 0 there is no previous value and the input uses its default.
- **Rejected wiring.** A patch output wired into its own input (`self_edge`), or a published input that reaches itself through pass-through outputs with no patch in between (`zero_latency_cycle`), uses the port default and raises an issue.
- **Natively evaluated types.** `component`, `delay1`, `variableBroadcaster`, and `variableReceiver` are evaluated by the engine. Registries may declare their specs; `createEngineRegistry` supplies fallbacks.
- **Missing pieces.** An unknown type raises `unknown_patch_type`; a spec without an evaluator raises `unimplemented_patch` and its outputs hold their defaults. Links to things that don't exist raise `dangling_link`, and the input uses its default (`isConnected` is false).

### Inputs and coercion

Each frame an input receives its driver's value coerced to the port's declared type with core `coerce` (every item of a loop is coerced). Literals decode once at compile time; `{ "loop": [...] }` literals become Loops. Unconnected inputs use the port default, with `variantDefaults` for the active variant. Patch outputs are trusted: write values of the declared type.

### Loops

- A patch fed Loops evaluates once per index. The loop count is the longest input loop; shorter loops wrap (index mod length) and plain values broadcast. Any empty input loop makes the count 0: nothing evaluates and every output is an empty Loop.
- **Length-1 rule.** Outputs are assembled into Loops only when the count isn't 1. A one-item loop evaluates once and its outputs are plain values, so a Count 1 loop behaves like a single value downstream. (Replicated component outputs are the exception below.)
- **Whole loops.** If any port of a definition is `wholeLoop`, the patch evaluates once per frame. `ctx.inputItems(key)` returns every item at its own length (plain values as one-item arrays), `ctx.input(key)` returns item 0, and writing an array or Loop to a `wholeLoop` output produces a Loop (other values become a one-item Loop).
- **Per-index state.** `definition.state()` runs once per instance path × index. When the count shrinks, removed indices are disposed and dropped; new indices start fresh.
- **Sticky outputs.** An output keeps its last written value for that index until written again. Pulse outputs reset to false before each evaluation.
- Loops are capped at 10,000 items (`loop_limit`).

### Pulses

- `ctx.pulsed(key)` fires when the driver is a pulse output that fired this frame, or when a non-pulse driver's on/off reading rises false → true for that index. Pulses on consecutive frames each count.
- Rising-edge history starts off, so a state that's already on at launch fires once on frame 0, and a loop index that appears while on fires once on its first frame.
- `ctx.input(key)` on a pulse port returns `ctx.pulsed(key)`.
- `ctx.changed(key)` is false on an instance's first frame and for new indices (gap-fill R1). Patches that compare against the previous frame seed from the first value, so frame 0 has no spikes and no false pulses.
- Same-frame precedence is each patch's own rule (Switch: turn off > turn on > flip).

### Muting

A muted patch doesn't evaluate. Its `mutedBehavior` (an engine extension on the definition) decides the outputs:

- `"bypass"` (default): each output passes the first input of the same type; others emit zero values; pulses never fire.
- `"zero"`: every output emits its zero value (Interaction, Velocity, Layer Info).
- `"evaluate"`: `evaluate` runs and the patch checks `ctx.node.muted` itself.

A muted component instance keeps every inner state without evaluating; each published output passes the first published input of the same type.

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
- **Replication.** A layer whose bound props carry Loops replicates, one copy per item, keyed `layerId#n`. Descendants of copy *n* take item *n* of their own looped props and are keyed `childId#n`. They don't replicate again, because loops of loops come from components.
- `enabled: false` sets `visible: false`. A Color Fill fills its parent. A Clone is emitted as a leaf with `props.source`, and the renderer draws the copy.
- `SceneNode.transform` is `mat4.compose` with the laid-out top-left, pivot, scale × Scale XYZ, rotations, and zPosition. `worldTransform` is the parent's world × local. `props` holds every resolved prop, text styles included. The background comes from `project.background` (white by default), and the scene size is the device screen size.
- Layer geometry from the previous frame feeds `services.layerInfo`: the anchor-point position in parent space, the laid-out size, scale × Scale XYZ, anchor, parent layer id, and content size.

### Layer references and layer outputs

- A `{ "layer": id }` input becomes a `LayerRef`. When that layer was replicated on the previous frame it becomes a Loop of references with `instance` set, so an Interaction on a looped layer evaluates per copy and its outputs loop.
- References are scoped to the instance that created them: `services.pointer(ref)` inside `"main/card#2"` targets `card#2/button`.
- Layer outputs: host-reported values from `setLayerOutputs`; Text `textSize` from the previous layout; Text Field `value`, `isFocused`, and `submitted` from `text`, `focus`, and `submit` events. Changing a Text Field's Text prop replaces what was typed.

### Services

| Service | Behavior |
|---|---|
| `random()` | Mulberry32 seeded with `options.seed`; reseeded on restart. |
| `now()` | Deterministic runtimes return `2026-01-01T00:00:00Z + time`. Live runtimes return the wall clock. |
| `pointer(ref)` | Pointer snapshot for the layer (or the whole screen for null), with local position through the layer's inverse world transform. A missing layer reads as never pressed. |
| `keyboard()`, `wheel()` | This frame's keys and text; wheel delta, position, and velocity. |
| `layerInfo(ref)` | Previous frame's geometry. |
| `device()` | `project.device` preset plus `options.device` overrides; `orientation` events swap the screen size and rotate safe areas. |
| `log(level, ...args)` | Calls `options.onLog`. Warnings and errors also become issues with the patch id. |
| `restart()` | Requests a restart before the next step. |
| `resolveAssetUrl`, `platform` | Passed through from options. `platform.deviceMotion` falls back to the last `deviceMotion` event. |

### updateDocument

`updateDocument` recompiles and moves per-path records to nodes with the same `componentPath:id` and type. State, sticky outputs, and input history carry over, remapped by port key, so springs keep their velocity. Outputs whose type changed restart from their defaults. Delay One Frame resets when its variant changes. Removed or retyped patches dispose. Variables re-resolve.

### Restart

`restart()` (or a `services.restart()` request, performed before the next step) disposes every state, sets `frame` to -1 and `time` to 0, reseeds randomness, forgets pointers, typed text, and the previous scene, and clears runtime issues. Host-reported layer outputs survive, because they describe media, not prototype state. Queued input applies to the new frame 0.

### Trace

`trace(targets, durationMs, events?)` builds a separate deterministic runtime from the document at the last restart and replays this runtime's recorded steps, document updates, and layer outputs, which reproduces the live state. The replay log keeps 7,200 frames; beyond that, traces start from a fresh runtime with the current document. It then steps at `1 / fps`, sampling `getValue(target)` after each step. `times` are seconds from the trace start: a fresh runtime's first sample is frame 0 at 0 s, and a continued one's first sample is at `1 / fps`. Plain events dispatch on the first traced frame; `{ atMs, events }` dispatch on the first frame at or after `atMs`. The clone has no platform services and no `onLog`, so traces never cause side effects, and the live runtime is never touched.

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
- `ctx.output(key, value)` and `ctx.pulse(key)` write outputs. Outputs are sticky; pulses last one frame.
- `ctx.state` is per instance path × loop index; mutate it or replace it. Keep it plain data where you can. `dispose(state, services)` runs when an index is dropped, the patch is removed or retyped, the prototype restarts, or the runtime is disposed.
- `ctx.dt` and `ctx.time` are seconds (`dt` is 0 on frame 0). `ctx.frame` counts from 0 after each restart. `ctx.loopIndex` and `ctx.loopCount` describe per-index evaluation; `ctx.componentPath` identifies the instance.
- `ctx.typeParam`, `ctx.inputCount`, and `ctx.node` (settings, name, muted) come from the document.
- Call `ctx.requestNextFrame()` while animating or waiting.
- Use `ctx.services` for randomness, clocks, pointers, layer info, device, logging, restart, assets, and platform APIs. Never use `Math.random`, `Date.now`, or DOM APIs.
- Never call `ctx.output` from a callback: store async results in `state` and output them on a later `evaluate`.
- Exceptions are caught and reported as `patch_threw`; outputs keep their last values.
- Declare `mutedBehavior` when the default bypass is wrong for the patch.

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

- `buildDoc(input, registry?)` builds a document through core `applyOps`: components first (interface inputs, layers, patches, links, connections, then published outputs), then the root graph, then extra `ops`. Invalid wiring throws with core's errors.
- `createTestRuntime(doc, definitionsOrRegistry?, options?)` accepts an `EngineRegistry`, or definitions added to (and replacing) the mocks.
- `runFrames(rt, n, events?)` dispatches `events[i]` before step *i*. Events can be an array, a record keyed by frame, or a function.
- Generators: `tap`, `drag`, `keyPress`, `idle`, `pointerEvent`, `sequence` (concatenate scripts).
- `runPatch(definition, framesOfInputs, options?)` runs one definition in isolation through the runtime's own evaluator. Inputs hold until changed; pulse inputs fire only on frames that set them (or on rising edges with `edgeInputs`). Options: `typeParam`, `inputCount`, `settings`, `muted`, `fps`, `seed`, `connected`, `services`, and `doc`. Each frame reports `outputs`, fired `pulses`, and `requestedNextFrame`. The result also collects `logs`, `issues`, `restarts`, and `states`, plus a `dispose()`.
- Mocks: `mockInteraction`, `mockSwitch`, `mockCounter`, `mockAdd`, `mockMultiply`, `mockTransition`, `mockPopAnimation`, `mockLoop`, `mockLoopSum`, `mockWhenPrototypeStarts`, `mockRestartPrototype`, `mockLogger`, `mockTime`, `mockRandom`, `mockVelocity`, `mockPulseOnChange`, `mockLayerInfo`, and `mockSplitter`. Factories: `sequenceDefinition` (scripted outputs per frame), `probeDefinition` (records component paths and disposals), and `defineMock` with `port`.

## Building blocks

- `physics/`: Rebound-exact springs and converters, curves, tweens, and momentum (`MomentumScroller`).
- `math/`: `mat4` (`compose`, `multiply`, `planeInverse`...), `vec`, and polyline simplification.
- `layout/`: `computeLayout` and the approximate `TextMeasurer`.
- `hittest/`: `hitTest` over a scene.
- `gestures/`: `PointerTracker` (taps, drags, velocity from event timeStamps, hover with `leave`, touch without hover), `KeyboardTracker`, `WheelTracker`, `TextInputTracker`, and `InputTracker` (all together).
- `runtime/`: `createRuntime`, `compileDocument`, `createEngineRegistry`, loop helpers (`makeLoop`, `isLoop`, `loopItemAt`...), `valuesEqual`, `zeroValue`, `coerceValue`, `mulberry32`, `summarizeSeries`.

## Engine extensions to the contract

These live in this package until the contract adopts them:

- `RuntimePatchDefinition.mutedBehavior?: "bypass" | "zero" | "evaluate"`.
- `SonobeRuntime`: `trace`, `getRawValue`, `needsNextFrame`, `services`, `document`, `deterministic`, `fps`.
- `PointerTracker.snapshot(target, worldInverse, exact)`: exact key matching, so a root layer `button` never matches a component's inner `button`.
