# Origami Studio: Patch Evaluation Semantics and Data Model

Research date: 2026-09-16. Latest Origami Studio release checked: **Version 228 (09/07/2026)**.

Scope: how the Origami patch graph actually computes. This is the foundation for our runtime engine spec (clean-room: behavior and formulas only, no proprietary code or assets).

## Legend and method

- **VERIFIED**: seen directly in a primary source: origami.design docs or release notes, BSD-licensed Facebook source on GitHub (rebound, rebound-js, pop, the archived Origami-for-Quartz-Composer plugin), or Apple Quartz Composer docs. URL cited inline.
- **INFERRED**: my reasoning from verified facts, or a recommendation for our engine. Needs confirming in the app.
- **DOC-DRIFT**: the docs disagree with, or lag behind, the release notes. The release notes win.

Source-grounding notes:
- The current Origami Studio app is closed source, so exact current internals cannot be verified.
- The strongest behavioral evidence comes from three places:
  1. the current docs, which are partly out of date,
  2. the release notes (source of truth for recent changes),
  3. the **archived open-source Origami QC plugin** (https://github.com/facebookarchive/origami, archived 2022-01-13), which Origami Studio evolved from. Its patches are the ancestors of today's patches.
- The Pop/spring math is fully verifiable: Origami's Pop Animation is defined in terms of Facebook POP and Rebound, and the docs say "Bounciness and Speed values can be passed to developers using the Pop framework for iOS, Rebound for Android, and Rebound JS for web" (https://origami.design/documentation/patches/builtin.bouncy).

All docs were downloaded as raw HTML from `https://origami.design/documentation/...` (256 pages) and text-extracted. The release notes were extracted from https://origami.design/releases/.

---

## 1. Executive summary: what our engine must do

1. **Frame-driven, dirty-driven dataflow graph** (VERIFIED + INFERRED).
   - Values flow left to right along cables, from outputs to inputs. An input takes at most one cable; an output can fan out to many ([Patches](https://origami.design/documentation/patch-editor/patches)).
   - The engine ticks once per display frame: nominally 60 fps, and 120 fps "when available" since **v216 (03/30/2026)** ([releases](https://origami.design/releases/)).
   - A patch re-evaluates when an input changed, unless it needs every-frame evaluation (JS API `alwaysNeedsToEvaluate`). Time-based patches (animations, Delay, Time, Wait, interactions) are always-evaluate.
2. **Pulses are one-frame `true` booleans.**
   - A pulse input fires on a **rising edge** of whatever is connected, so a plain boolean state can drive a pulse port ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)).
   - Since **v187 (02/18/2025)** a pulse can re-fire on consecutive frames. Before that, "a pulse had to turn off before it could pulse again."
3. **Loops are first-class arrays flowing on cables** (green cables).
   - Any patch fed a loop is evaluated once per index.
   - Layers fed a loop are replicated, one instance per index.
   - Multiple loops feeding one patch are "zippered" (interleaved index-wise).
   - Components pick per port whether a loop "Loops the Component" or is "Passed into Component" ([Loops](https://origami.design/documentation/concepts/loops)).
   - Stateful patches keep **per-index state**. VERIFIED in legacy source: the Delay, Interaction, and Pop spring patches keep per-iteration dictionaries.
4. **Springs = Rebound/POP RK4 solver** (fixed 1 ms substeps, max frame dt 64 ms, mass 1).
   - Pop Animation's (Bounciness, Speed) goes through `BouncyConversion`, then through `OrigamiValueConverter` to (tension k, friction c).
   - Exact formulas are in §7. Retargeting mid-flight keeps the current velocity (VERIFIED in rebound `setEndValue` and the legacy POPBouncyPatch).
5. **Transition** = `start + progress × (end − start)`, unclamped (it extrapolates). **Progress** = `(value − start) / (end − start)`.
6. **Hit testing**:
   - A layer must be enabled with opacity > 0 to receive touches.
   - Touches propagate to parent groups (current docs).
   - Tap = release inside the layer "as long as the touch hasn't moved". The legacy tolerance was a 10 px square.
7. **JavaScript patch**: a Hermes script that *returns* a `Patch` object. It is **not** `module.exports`. You define `inputs`/`outputs` arrays of `PatchInput`/`PatchOutput`, plus `evaluate()`, `loopAware`, `alwaysNeedsToEvaluate`, and `variants` ([JavaScript Patch API](https://origami.design/documentation/concepts/scriptingapi)).

---

## 2. Quartz Composer heritage: the evaluation model Origami grew out of

Origami began as a Quartz Composer (QC) plugin plus a set of QC macro compositions. VERIFIED from the repo README: "Origami for Quartz Composer is deprecated and no longer supported" (https://github.com/facebookarchive/origami).

### 2.1 QC execution modes (VERIFIED)

From Apple, *The Basics of Custom Patches* (https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/QuartzComposer_Patch_PlugIn_ProgGuide/plugin_1/plugin_1.html):

| Mode | Constant (value) | When it executes |
|---|---|---|
| Provider | `kQCPlugInExecutionModeProvider` (1) | "execute when the output values are needed but at most once per frame." For external sources (mouse, video, MIDI, RSS). |
| Processor | `kQCPlugInExecutionModeProcessor` (2) | "execute when the output values are needed and when input values change." |
| Consumer | `kQCPlugInExecutionModeConsumer` (3) | "execute every frame. This type of custom patch pulls data from others and renders it to a destination." Consumers get an automatic **Enable** input ([Writing Consumer Patches](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/QuartzComposer_Patch_PlugIn_ProgGuide/WritingConsumerPatches/WritingConsumerPatches.html)). |

Time modes (VERIFIED, same page):
- `kQCPlugInTimeModeNone`: "does not depend on time." Such a patch "executes only when the input values change" (Consumer page).
- `kQCPlugInTimeModeIdle`: "does not depend on time, but needs to give the system some time to process" (periodic polling, e.g. hardware).
- `kQCPlugInTimeModeTimeBase`: "has a time base defined by the system and the custom patch uses time in its computations."

Pull model and ordering (VERIFIED, [QC User Guide: Basic Concepts](https://leopard-adc.pepas.com/documentation/GraphicsImaging/Conceptual/QuartzComposerUserGuide/qc_concepts/qc_concepts.html)):
- "A consumer patch pulls (or consumes) data from processor and provider patches, operates on the data, and renders the result to a destination."
- A consumer "Executes if its Enable input is set to True."
- "The number in the top-right of the [consumer] patch… designates the execution order (also called the rendering layer)… Consumer patches are executed in numerical order from lowest to highest."
- Providers execute "on demand—that is, whenever data is requested of it, but at most once per frame."

Consequence (INFERRED, standard QC behavior): a processor or provider that no consumer (directly or transitively) depends on never executes. That is **laziness via demand from sinks**.

The central method is `execute:atTime:withArguments:`. It "reads the values from the input ports… performs computations, taking into account time, if necessary… either writes the result to the output ports or renders the content" (VERIFIED, Basics page).

QC port types (VERIFIED, table 1-1 of the Basics page): Boolean (`BOOL`), Index (`NSUInteger`), Number (`double`), String, Color (`CGColorRef`), Structure (`NSDictionary`), Image. The legacy Origami wireless patch also references a **Virtual** port type (any type) (VERIFIED, `FBWirelessInPatch.m`).

QC type conversion: QC converts implicitly between types. Cable colors signaled the conversion: yellow = none, orange = possible loss (e.g. Number→Index), red = severe (e.g. Image→Boolean). Source: secondary search summary of QC 3 behavior (INFERRED-weak; not seen on an Apple page).

QC macro patches: "A patch that contains other patches. A macro is similar to a subroutine… A macro can nest other macros" ([QC glossary](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/QuartzComposerUserGuide/qc_glossary/qc_glossary.html)). Macros expose **published input/output ports**. VERIFIED: every legacy Origami `.qtz` (Transition, Switch, Pop Animation…) is a macro with `publishedInputPorts` / `publishedOutputPorts` mapped to internal splitter ports.

QC Iterator: a macro that executes its subgraph N times per frame. Iterator Variables provide *Current Index*, *Current Position* (0–1), and *Iterations*. A consumer inside, e.g. a Sprite, renders N instances ([superfleamedia tutorial](http://superfleamedia.blogspot.com/2011/04/tutorial-iterators-in-quartz-composer.html), secondary). This is the ancestor of Origami loops.

### 2.2 How the legacy Origami plugin patches used QC modes (VERIFIED, source files in `Origami Plugin/`)

| Legacy patch | Execution mode | Time mode | Notes |
|---|---|---|---|
| `POPBouncyPatch` ("Pop Spring Engine") | Provider | None | POP spring. Keeps an array of per-iteration POPAnimator+spring. |
| `POPConverterPatch` | Processor | None | Recomputes only `if (inputBounciness.wasUpdated \|\| inputSpeed.wasUpdated)`. |
| `FBOProgressPatch` ("Multi-stop Progress") | Processor | None | Early-returns unless `inputValue.wasUpdated \|\| inputStops.wasUpdated`. |
| `FBODelayPatch` | Processor | TimeBase | Frame queue per iteration index. |
| `FBOMultiSwitchPatch` | Processor | Idle | Output = index of the last input port that `wasUpdated` and is high. |
| `FBOInteractionPatch` ("Interaction 2") | Provider | TimeBase | Reads events; per-iteration down/up/tap/drag dictionaries. |
| `FBWirelessInPatch` (Broadcaster) | **Consumer** | None | Writes its value into a document-wide keyed dictionary every frame. |
| `FBWirelessOutPatch` (Receiver) | Provider | None | Reads that dictionary. |
| `FBLastValue` | Provider ("Execute continuously") | Idle | Outputs the previous frame's value per iteration index. |
| `POPDecayPatch` | Provider | None | Decay animation, experimental. |

Two survived mechanisms:
- **Dirty flags** (`port.wasUpdated`) survive as `PatchInput.isDirty()` in today's JS API (VERIFIED, [JS API](https://origami.design/documentation/concepts/scriptingapi)).
- **Iteration detection by time** survives as per-index state for loops. POPBouncyPatch: `_iterationIdx = (time != _previousTime) ? 0 : _iterationIdx + 1;`. If `_previousTime > time` (viewer restarted), all iterations are cleared. VERIFIED.

### 2.3 Which QC ideas survived into Origami Studio (INFERRED synthesis from verified facts)

| QC concept | Origami Studio equivalent |
|---|---|
| Consumer (renders) | Layers (the layer tree is the sink set; rendering order = layer list order). |
| Processor (on input change) | Most math/logic patches ("evaluate function will run any time at least one of the inputs changes"). VERIFIED for JS ([Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics)). |
| Provider / TimeBase | Interaction, Time, animation patches, sensors. Evaluate every frame. |
| Enable port on consumers | Layer `Enable` port; `Enable` ports on Interaction, Time/Device Time (v172), Repeating Animation. |
| Macro + published ports | Components with purple (input) and blue (output) port patches; `Publish Port ⌥P`. |
| Iterator | Loops (implicit per-index evaluation, not an explicit macro). |
| `wasUpdated` | `isDirty()`, `readRising()`, `readFalling()` in JS. |
| Rendering-layer number | Layer list z-order. |
| Virtual port type | "Type variance": right-click to change a patch's type; JS `types.VARIANT`. |

---

## 3. Frame-driven evaluation in Origami Studio

### 3.1 Verified facts

- "A frame is usually 1/60th of a second" ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)). "A typical composition runs at around 60 frames per second" ([Delay 1](https://origami.design/documentation/patches/builtin.delay1)).
- **DOC-DRIFT**: v216 (03/30/2026) "Enabled 120fps support when available (iOS and macOS)." The docs still say 1/60.
- The Time patch has outputs **Time** (seconds since prototype start, from 0) and **Frame** ("When running at 60 frames per second, frames should be time * 60") ([Time](https://origami.design/documentation/patches/builtin.time)).
  - v172 (07/22/2024): Enable port added to Time and Device Time. v88: millisecond output on Device Time.
- JS patch evaluation:
  - "`Patch.evaluate()`… will be called when needed based on the Engine run loop or every single frame when Patch.alwaysNeedsToEvaluate is set to `true`."
  - "The evaluate function will run any time at least one of the inputs changes… A great deal of effort has been put into making Origami run as efficiently as possible by using a highly optimized evaluation schedule" ([Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics)).
- Engine history from the release notes:
  - v90 (06/02/2021) "Improved performance in both the engine and the renderer."
  - v103 (12/03/2021) "Renderer Sparse Updates."
  - v104 "More patches are loop aware now."
  - v107 "Origami no longer runs at an inconsistent frame rate on slower displays."
  - v215 (03/18/2026) "Performance improvements in animations when FPS drops."
  - Secondary source: an engine rebuild in 2022, "95% faster… patch evaluation 127% faster… rendering updates 161% faster" (search summary; not primary).
- **Cycles / backwards connections are allowed**:
  - v91 (06/16/2021) "Fix issue with delayed values on backwards connections."
  - v99 "Never-ending layout fix involving backwards edges."
  - v121 (08/08/2022) "Fix bug with backwards connections causing incorrect values."
  - v76 "Allow old compositions with cycles in components to be open."
  - Momentum Scrolling is documented for "a feedback loop that integrates the velocity… Feed back into the Value input and add velocity with a + patch" ([Momentum Scrolling](https://origami.design/documentation/patches/builtin.momemtumscrolling)).
  - A patch's output cannot connect to its *own* input; a patch must sit in between (search summary of the [Feedback pattern](https://origami.design/patterns/logic_feedback.html); INFERRED-weak).
- Per-frame differencing exists: Velocity "Takes the value in the current frame and subtracts the value in the previous frame" ([Velocity](https://origami.design/documentation/patches/origami.velocity)). Legacy implementation = `Value − LastValue` (VERIFIED, `Velocity.qtz` + `FBLastValue.m`).
- "Origami simply calculates from the order in which the patches are connected" (no operator precedence) ([Coming From Code](https://origami.design/tutorials/getting-started/coming-from-code)).
- Restarting: When Prototype Starts outputs "A pulse on the first frame of a prototype. Restart the prototype with ⌘R." It "also outputs a pulse when it is added" ([When Prototype Starts](https://origami.design/documentation/patches/builtin.pulseonstart); v83 added the fire-when-inserted behavior). Restart Prototype patch: pulse → restart ([Restart Prototype](https://origami.design/documentation/patches/builtin.restart.prototype)).

### 3.2 Recommended evaluation algorithm for our engine (INFERRED, consistent with all verified behavior)

```
per frame f (time t, dt = t - t_prev, clamp dt for physics per §7):
  1. Sample external inputs (touches, mouse, keyboard, sensors, network callbacks, JS promise results).
  2. Mark dirty: nodes whose inputs changed last frame; nodes flagged alwaysEvaluate
     (time-based: animations, Delay, Wait, Stopwatch, Time, Repeating*, interactions, JS with alwaysNeedsToEvaluate).
  3. Topologically order the graph with back-edges broken. A back-edge (cycle) delivers the
     source's value from the previous frame (one-frame latency, like QC Recursor / Delay 1).
  4. Evaluate dirty nodes in order. If an output value changes (by value equality), mark downstream dirty.
     Loops: evaluate per index (§6), with per-index state.
  5. Layers (sinks) apply property changes; renderer does sparse updates.
  6. End of frame: auto-clear pulse outputs that were set this frame (unless re-pulsed next frame, §5.1).
```

Laziness: patches with no path to a sink (layer, variable broadcaster, component output, or side-effect patch like Haptic, Sound Player, Network Request, Open URL) may be skipped. INFERRED from QC heritage. Not confirmed for Studio.

---

## 4. Value types and data model

### 4.1 User-facing port types (VERIFIED, [Patches](https://origami.design/documentation/patch-editor/patches))

- **Number**: "An integer or decimal."
- **Boolean**: "true/false, yes/no, on/off, 0/1… a boolean can be converted to a number 0 (off) or 1 (on) when passing values between patches."
- **Text**: any string.
- **Image**, **Video**, **Sound**: "Any image/video/sound that you drag or paste."
- **Color**: "Any RGB or HSL color."
- **Index**: "Any non-negative, integer (ex: 0, 1, 2)."
- **JSON Data**: "Any number of values of any type in JSON format."
- **Point**: "numbers in 2D, 3D, or 4D… (ex: Position X, Y, Z; Rotation X, Y, Z)."
- "Some patches can change the number of ports it has or the type of value it supports. Right-click any patch to see the options available."

### 4.2 Runtime types exposed to the JS patch (VERIFIED, [JS API: Types](https://origami.design/documentation/concepts/scriptingapi))

| `types.X` | Representation / semantics |
|---|---|
| `NUMBER` | "64-bit floating value… Default type for most Patches." |
| `PROGRESS` | "alias of NUMBER", semantically normalized 0–1. |
| `POSITION` | vec2 `{x, y}`. |
| `SIZE` | vec2 `{x: width, y: height}`; the UI treats it as a Size. |
| `ANCHOR` | vec2, "values are expected to be in the range from 0-1". |
| `POINT3D` | `{x, y, z}`. |
| `POINT4D` | `{x, y, z, w}`. |
| `COLOR` | vec4 `{x: r, y: g, z: b, w: a}`, "All values are normalized from 0-1". |
| `BOOLEAN` | true/false. |
| `PULSE` | "Similar to BOOLEAN… but it is a transient value that is not persisted over time." |
| `INTEGER` | "A numeric value that is not a fraction." |
| `ENUM` | UI shows a dropdown; JS sees an INTEGER index. |
| `STRING` | Text. |
| `JSON` | JSON object/array. |
| `IMAGE` | Image object (width, height, format, getPixelAt, setPixelAt). |
| `VARIANT` | "Sentinel… real type will be resolved at runtime via 'Type Variance'." |
| `RAW_DATA` | Appears in `variants.NETWORK`/`BASE64` groups (not in the types table). |

"Overall types that require a resource are not supported; Sound or Video for example" (JS only) ([Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics)).

Type-group helpers (VERIFIED, JS API `variants`):
- `NUMERIC` = [NUMBER, PROGRESS, POSITION, SIZE, ANCHOR, POINT3D, POINT4D, INTEGER]
- `SCALAR` = [NUMBER, PROGRESS, BOOLEAN, PULSE, INTEGER, ENUM]
- `VECTOR` = [POSITION, SIZE, ANCHOR, POINT3D, POINT4D]
- `VEC2` = [POSITION, SIZE, ANCHOR]
- `POINT` = [POSITION, ANCHOR, POINT3D, POINT4D]
- `PLUSABLE` = [INTEGER, NUMBER, PROGRESS, POSITION, SIZE, ANCHOR, POINT3D, POINT4D, STRING]
- `NETWORK` = `BASE64` = [JSON, STRING, IMAGE, RAW_DATA]
- `INTERPOLABLE` = [INTEGER, NUMBER, PROGRESS, POSITION, SIZE, ANCHOR, POINT3D, POINT4D, COLOR]
- `isBoolean()` true for BOOLEAN, PULSE

These groups are effectively Origami's **type-variance classes**, and our engine should adopt them as port-type constraints. For example, Transition, Pop Animation, and Classic Animation should accept `INTERPOLABLE`, and `+` should accept `PLUSABLE` (INFERRED).

### 4.3 Other types seen in docs and release notes (VERIFIED mentions)

- **Layer** reference: Interaction/Scroll/Drag/Hover/Clone have a `Layer` input ("Click the value ('None', by default) to select a layer") ([Drag](https://origami.design/documentation/patches/origami.drag)).
- **Interaction** object: the legacy `outputInteraction` port handed the patch object to a layer's `Interaction` port (VERIFIED `FBOInteractionPatch.m`). In Studio the link goes Interaction patch → `Layer` input instead.
- **Transform**: v193 "Fixed issue where Transform port on Text layers was having no effect."
- **Point 4D, Edges, Corner Radius**: v114 (05/03/2022) "better support for four-dimensional values including Point 4D, Edges, and Corner Radius as pack/unpack patches and in type-variant patches."
- **Spacing** (vec2 for layout) ([Spacing](https://origami.design/documentation/patches/builtin.makespacingvec2)).
- **Gradient**: v218 (04/27/2026) "Gradients as native type". **DOC-DRIFT**: not in the JS types table.
- **Text style / text attributes**: v78 "Allow JSON as an input for Text Attributes."
- **Settings objects**: Scroll Settings → `Settings` output; Drag Settings → `Settings` (opaque struct types).
- **Connection** (WebSocket), **Sound**, **Video** (Network Request since v149).
- **Variable fonts**: v226.
- Anchor presets (VERIFIED, [Coordinates](https://origami.design/documentation/concepts/coordinates)): Top Left (0,0), Top Center (.5,0), Top Right (1,0), Center Left (0,.5), Center (.5,.5), Center Right (1,.5), Bottom Left (0,1), Bottom Center (.5,1), Bottom Right (1,1).
- Coordinate system: pt/dp; origin (0,0) at the **center of the device screen**; +x right, **+y down**. Pivot is 0–1 and separate from anchor.

### 4.4 Type coercion between ports

VERIFIED:
- Boolean ↔ Number: false/off = 0, true/on = 1 ([Patches](https://origami.design/documentation/patch-editor/patches)). Logic patch inputs are "A boolean (true/false, on/off, or 0/1)" ([And](https://origami.design/documentation/patches/builtin.logic.and)).
- A state feeding a pulse port acts as a pulse on its off→on transition ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)).
- **Splitter is the explicit cast node**: "Right-click to change the value type (ex: from number to position), which can be used to cast values from one type to another" ([Splitter](https://origami.design/documentation/patches/builtin.splitter)).
- JSON values are untyped. Value at Index / Value for Key say "Use a Splitter to cast it to a specific type" ([Value at Index](https://origami.design/documentation/patches/builtin.structure.array.index), [Value for Key](https://origami.design/documentation/patches/builtin.structure.dictionary.key)). Touches JSON: "a Splitter set to position or number to cast the value" ([Touches](https://origami.design/documentation/patches/builtin.touches)).
- Release-note evidence that implicit casting exists and was tuned:
  - v72 "Option Equals better type casting"
  - v97 "More consistent conversion from JSON type to Number"
  - v118 "Fix conversion types for Set Value For Key and JSON Object patches"
  - v185 "JSON support for boolean values"
  - v194 "Fixed correct colors when casting values in patches"
  - v206 "Fix Option Equals issue with type variants"
- JS: writing a value of the wrong shape logs `WARNING: Could not convert a JavaScript value into an appropriate Origami type. Ignoring.` The output keeps its previous value (VERIFIED message; "Ignoring" implies no update).

INFERRED recommended coercion matrix (our spec; confirm against the app where possible):

| From → To | Rule |
|---|---|
| Number → Boolean/Pulse | `≠ 0` → true (QC convention). Pulse port = rising edge of that boolean. |
| Boolean/Pulse → Number/Index/Integer | true → 1, false → 0. |
| Number → Index | round-toward-zero or floor, clamped ≥ 0 (QC showed this as an "orange" lossy conversion). |
| Number → Position/Size/Anchor/Point3D/4D | broadcast scalar to all components (common in type-variant math). Unverified. |
| Vector → Number | first component (x). Unverified. |
| Number/Boolean → Text | decimal formatting / "true"/"false". |
| Text → Number | parse; NaN → 0. |
| Color ↔ Vec4 | r,g,b,a ↔ x,y,z,w (VERIFIED in the JS representation). |
| JSON → typed | via Splitter / cast: number → Number, bool → Boolean, `{x,y}` → Position (INFERRED). |
| Anything → JSON | wrap as a JSON value. |
| Enum ↔ Integer | index (VERIFIED for JS). |

---

## 5. Pulses and state patches

### 5.1 Pulse semantics (VERIFIED)

- "Pulses are used to tell patches to perform an action… pulses are On ✓ only for a single frame. The value of the cable sending the pulse is otherwise off" ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)).
- "A state is a value that persists over time… the state goes from off to on immediately in a single frame."
- Implicit pulse from state: "the port that accepts a pulse will look to when the state changes from off to on, and at that moment infer a pulse. So… you can connect the Down port directly to the Switch's Flip port."
- **v187 (02/18/2025)**: "Added support for pulsing to be able to pulse on subsequent frames. Previously, a pulse had to turn off before it could pulse again." (**DOC-DRIFT**: the docs don't mention this.)
  - INFERRED: pulses are now event-like (a per-frame "fired" flag), not pure edge detection on a boolean level.
  - Our engine should model a pulse as `{fired: bool}` per frame. A pulse input fires when the upstream pulse output fired this frame, **or** when a connected boolean went false→true.
- v188 (03/03/2025) "Fix bug on pulse on change on first evaluation." Pulse on Change must not fire on the first frame.
- Legacy implementation detail (VERIFIED `FBOInteractionPatch.m`): at the start of each execute, `Up`/`Tap` flags that were YES are reset to NO. The pulse lasts exactly one execute, i.e. one frame.
- JS: `PatchInput.readRising()` "has just changed to a nonzero/'truthy' value"; `readFalling()` the reverse; `PatchOutput.pulse()` "send a pulse on this output port" ([JS API](https://origami.design/documentation/concepts/scriptingapi)).

### 5.2 Pulse sources (VERIFIED docs)

- **Pulse**: input `On/Off` (boolean). Outputs `Turned On` (pulse when the input turns on) and `Turned Off` (pulse when it turns off) ([Pulse](https://origami.design/documentation/patches/builtin.pulse)).
- **Pulse on Change**: input `Value` (type variant, default Number). Output: "A pulse on every frame the input value changes" ([Pulse on Change](https://origami.design/documentation/patches/builtin.pulseonchange)).
- **When Prototype Starts**: pulse on the first frame (see §3.1).
- **Repeating Pulse**: input `Frequency` = "The length between pulses, in seconds." Output = pulse at regular intervals ([Repeating Pulse](https://origami.design/documentation/patches/builtin.repeatingpulse)).
  - Legacy build (VERIFIED `Repeating Pulse.qtz`): QC LFO (`inputType` 3, offset 0.5, amplitude 0.5, period = Duration) → QC Pulse (`inputMode` 0) → output. INFERRED: square wave 0/1 plus rising-edge detection, so one pulse per period.
- **Interaction.Tap**, **Double Tap**, **Scroll/Drag settings Jump** pulses, **Keyboard** (Down boolean).

### 5.3 Switch (VERIFIED docs; legacy graph VERIFIED)

Ports: inputs `Flip`, `Turn On`, `Turn Off` (pulses); output `On / Off` (boolean). Shortcut ⇧S ([States](https://origami.design/documentation/patch-editor/states)).
- Flip: "flips the state of the switch (from on to off, or vice versa)."
- Turn On: "If the switch is already on, the pulse has no effect." Turn Off likewise.
- "Switch patches output a 0 (off) or a 1 (on)."

Legacy `Switch.qtz` wiring (VERIFIED connections; QC op-code meanings INFERRED):

```
on       = Counter.count mod 2
Counter.increment_signal = Flip OR (TurnOn AND NOT on)
Counter.reset_signal     = TurnOff
```

INFERRED same-frame precedence for our spec:
1. If Turn Off fires, the state becomes off and other pulses that frame are ignored. This matches the legacy reset-dominant counter.
2. Otherwise, if Turn On fires, the state becomes on.
3. Otherwise, if Flip fires, the state inverts.

(Modern behavior unverified. Flag as an open question.)

### 5.4 Counter (VERIFIED docs, [Counter](https://origami.design/documentation/patches/builtin.counter))

- Inputs: `Increase` (pulse +1), `Decrease` (pulse −1), `Jump` (pulse), `Jump to Number`, `Maximum Count`. Output: current count (starts at 0).
- "If the counter is incremented after it reaches this maximum value, it will reset to zero. Decrementing the counter from its initial value will wrap it backwards to the maximum value. If the counter is constrained, the 'Jump to Number' value must fall within bounds, otherwise the counter will return to the starting value."
- "The counter will always remain less than this value" (i.e. range [0, Max−1]; Max ≤ 0 means unconstrained, INFERRED).
- Legacy `Counter 2.qtz` (VERIFIED graph):
  - A QC Recursor holds the number; `+Increase`, `−Decrease`; Jump or When Prototype Starts re-initializes to `Jump_to_Number`.
  - Output = `Max > 0 ? ((n mod Max) + (n mod Max < 0 ? Max : 0)) : n`.
  - The legacy version stores the raw count and outputs the wrapped value.

### 5.5 Option Switch, Option Picker, Option Sender, Option Equals (VERIFIED docs)

- **Option Switch** (formerly *Index Switch*): inputs `Set to 0`, `Set to 1`, `Set to 2` (pulses; right-click adds more). Output `Option` (index) ([Option Switch](https://origami.design/documentation/patches/builtin.indexswitch)).
  - Legacy `FBOMultiSwitchPatch`: output = index of the **last** input port (in port order) that was updated this frame and is high. Default 3 inputs. VERIFIED.
- **Option Picker** (formerly *Multiplexer*): input `Option` (index from 0) plus N typed inputs → output "The picked value" ([Option Picker](https://origami.design/documentation/patches/builtin.multiplexer)). "If you are a programmer looking for an 'if statement' or 'case statement', this patch gives similar functionality." Out-of-range behavior is undocumented (INFERRED: clamp).
- **Option Sender** (formerly *Demultiplexer*): `Option`, `Value`, `Default` → N outputs. The selected output gets Value; the others get Default ([Option Sender](https://origami.design/documentation/patches/builtin.demultiplexer)).
- **Option Equals**: the docs page is the *Legacy* version (inputs Value, options…; outputs `Option`, `Equals`) ([Option Equals Legacy](https://origami.design/documentation/patches/builtin.optionequals)). v205 (10/27/2025): "Option Equals returns -1 if Value not equal to any option." **DOC-DRIFT**: the new Option Equals has no docs page.
- v180: port-handle fixes for Or and Option Picker (3 bound inputs). v100: `Cmd+↑/↓` and `Cmd+Shift+↑/↓` reorder ports on multi-input patches.

### 5.6 Delay, Delay 1, Sample and Hold, Wait, Stopwatch, Smooth Value

**Delay** ([Delay](https://origami.design/documentation/patches/builtin.delay), VERIFIED):
- Inputs: `Value` (type variant), `Duration` (seconds), `Style` ∈ {Always, When Increasing, When Decreasing}. Output: Value.
- "When Increasing and When Decreasing options only apply to number and boolean values; otherwise… function the same as Always."
- Concept doc: "If you give a Delay patch a pulse as input, you can delay the change from on to off, extending the pulse for any amount of time you'd like" ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)). The example uses Duration 2s, Style When Decreasing.
- Shortcut D.

Legacy `FBODelayPatch.m` implementation (VERIFIED; style labels "Delay Always / Delay Increasing / Delay Decreasing"; defaults Duration 0.5, style index max 2):
- A per-iteration-index FIFO queue of past input values, one entry per frame.
- `durationInFrames = lround(Duration × fps)`. `fps` is low-pass filtered: `fps = fps×0.97 + 0.03×averageFPS`, updated once per frame.
- If `durationInFrames == 0`, output = input.
- Output = `values[count − durationInFrames]`. Old entries are trimmed, keeping a 10-frame buffer. Output is nil until enough history exists.
- Style suppression (`shouldSuppressDelay`), in order:
  - Style 0 never suppresses.
  - Non-numeric values never suppress.
  - Duration 0 always suppresses.
  - If current == previous input, no suppression.
  - If increasing and style == 1 ("Delay Increasing"), no suppression (delay).
  - If decreasing and style == 2, no suppression (delay).
  - Otherwise **suppress**: clear the queue and pass the input straight through.
  - So "When Increasing" delays rises and passes falls through immediately.
- INFERRED for our engine: implement Delay time-based (a timestamped queue) rather than frame-count-based, to be correct at 120 fps and under frame drops.

Other patches (VERIFIED docs):
- **Delay 1**: "Delay a number by one frame." Type variant ([Delay 1](https://origami.design/documentation/patches/builtin.delay1)). Use as an explicit cycle breaker.
- **Sample and Hold**: `Value`, `Sample` (boolean, "when true, the patch is sampling… When false… outputs the most recently sampled value"), `Reset` (pulse "clears the currently stored value") → Output ([Sample and Hold](https://origami.design/documentation/patches/builtin.sample)). INFERRED: while Sample is true, output tracks the input continuously (a "track and hold").
- **Wait**: `Start` (pulse), `Duration` → output "A boolean that is true when the wait is finished". **DOC-DRIFT**: the description says "before outputting a pulse" but the output port is documented as a boolean ([Wait](https://origami.design/documentation/patches/builtin.waittimer)).
- **Stopwatch**: `Start`, `Stop` (pause), `Reset` (to 0) → `Time` (seconds) ([Stopwatch](https://origami.design/documentation/patches/builtin.stopwatch)).
- **Smooth Value**: inputs `Value`, `Rising Hysteresis` (0–1), `Falling Hysteresis` (default **−1** = symmetrical, i.e. use rising), `Reset` (pulse resets to the input) ([Smooth Value](https://origami.design/documentation/patches/builtin.smoothvalue)). Separate rising/falling since v204 (10/13/2025). Formula, per frame:

  ```
  h = (value > prev) ? risingH : (fallingH == -1 ? risingH : fallingH)
  out_next = prev × h + current × (1 − h)
  ```

  It is frame-rate dependent. INFERRED: at 120 fps the smoothing is "faster" unless compensated with `h' = h^(dt×60)`.
- **Random**: `Randomize` (pulse), `Start Value`, `End Value` → `Value` (decimals) ([Random](https://origami.design/documentation/patches/builtin.random)).

---

## 6. Loops

### 6.1 Core semantics (VERIFIED, [Loops](https://origami.design/documentation/concepts/loops))

- "Loops behave similarly to Arrays or a for statement."
- "Loop patches in Origami are all colored green and any patches that get connected to a Loop patch will have a green tinted connection cable. Any time you see patches connected with a green connection cable, that connected patch graph is being evaluated for each item in the loop."
- Zero-indexed: "a Loop with a Count of 5 will be '0, 1, 2, 3, 4'."
- Layers: "instead of manually copying and pasting a Layer five times, we would connect our Layer to a Loop patch by any of it's properties… with a Count Input of five."
  - "By default looped layers will stack on top of each other on the Canvas, but when added to a Layout-enabled Group the looped layers will automatically be arranged."
  - "If you're only seeing one layer show up… make sure your Layer is a child of a Layout-enabled group."
- **Multiple loops**: "When we combine loops together by connecting multiple loops to multiple properties of a layer, Origami will try to interleave or 'zipper' the loops together."
- Interactions: "When we add an Interaction patch to a looper layer, the Interactions output will then be looped as well." "Interactions on a looped layer will have their outputs looped as well."
- Release notes:
  - v80 (01/25/2021) "Loops of Loops."
  - v72 "Uses previous loop count when layers are not rendered."
  - v143 "Fixed the order of some loop patches outputs that were inconsistent."
  - v113 "Looped layers show in Hover state."
  - v172 "control to inspect values for different loops of a component."
  - v201 "Bottom HUD with… loop counts."
  - v117 "Improve Call out layer on hover to show the first index of a loop by default."

### 6.2 Components and loop behavior (VERIFIED)

Per component input port, "Loop Behavior" is one of:
- **Pass into Component**: "Makes the loop available inside the component by passing it through without looping the component." Default in Origami **v81 and older**.
- **Loop the Component**: "The component will be evaluated for each item in the loop passing the item into the component." Default in **v82 and newer**. **DOC-DRIFT**: the v82 release notes don't mention this change; only the docs state it.
- Loops of loops: one input set to Loop the Component, another to Pass into Component. The passed loop is then independently looped inside each instance.
- "Components cannot output a loop of loops. Outputs from looped components are appended to one another into a flat loop… a flattened loop of 25 pulse outputs since 5 x 5 is 25."
- Example: a names loop fed to a Text Layer inside a component with Loop the Component creates N component instances (list cells), not N text layers.

### 6.3 Loop patches (VERIFIED docs)

| Patch (docs slug) | Inputs → Outputs | Semantics |
|---|---|---|
| Loop (`builtin.loop`) | `Count` → `Index` | Loop [0..Count−1]. |
| Loop Builder (`builtin.loop.builder`) | N typed inputs → `Index`, `Loop` | "Create a loop of any value"; type via right-click. |
| Loop Over Array (`builtin.loop.fromarray`) | `Array` (JSON) → `Index`, `Items` | Nested arrays → loops of loops. |
| Loop to Array (`builtin.loop.toarray`) | `Loop` → `Array` | |
| Loop Filter (`builtin.loop.select`) | `Input` (loop), `Include` (loop of booleans or counts) → `Loop`, `Index` | Boolean = include/exclude. Number = repeat count, e.g. [apple, carrot, orange] × [0,3,1] → [carrot, carrot, carrot, orange]. A single value × 5 → repeated 5 times. |
| Loop Select (`builtin.loop.selectreorder`) | `Input`, `Index Loop` (default 0) → `Loop`, `Index` | Gather by index: [2,1,0] → [orange, carrot, apple]; output Index [0,1,2]. |
| Loop Count | `Loop` → count | |
| Any (`builtin.loop.any`) | `Loop` (booleans), `Grouping` (default −1) → boolean (or loop of booleans if Grouping is a loop) | Any-true. |
| Running Total (`builtin.loop.sum`) | loop → loop | Prefix sums *excluding* the current value: [1,3,5] → [0,1,4]. |
| Loop Sum (`origami.loopsum`) | loop → `Sum` | Native + type variance since v193. |
| Loop Insert / Loop Insert at End / Loop Remove / Loop Remove Last | `Loop`, `Value`, `Index`, pulse → `Loop`, `Index` | Mutations are **pulse-driven**, so the patch is stateful (it holds the mutated loop). INFERRED. |
| Loop Dedupe / Loop Reverse / Loop Shuffle | `Loop` → `Loop` (+ Index) | |
| Loop Option Switch (`origami.loopoptionswitch`) | loop of pulses → `Option` | "Find the index of the last pulsed item." Stateful: holds the last index. |

**DOC-DRIFT / naming**: the URL slug `builtin.loop.select` is titled "Loop Filter" and `builtin.loop.selectreorder` is titled "Loop Select". The patches were renamed but the identifiers are stable. Our file format should similarly keep stable IDs separate from display names.

### 6.4 Loop count mismatch and broadcasting rules

- VERIFIED: only "zipper/interleave" is stated in the docs. No primary source gives the exact length rule.
- VERIFIED (legacy): per-index state keyed by iteration index; the Interaction patch reads the iterator's `inputCount` and `_currentIndex`.
- INFERRED recommendation, to confirm in the app:
  1. A scalar (non-loop) input broadcasts to every index.
  2. The output loop length = **max** of input loop lengths.
  3. Shorter loops **wrap** (index mod length). This is the common Origami/QC convention and makes "zipper" work.
  4. An empty loop (count 0) yields an empty output. Layers render 0 instances.
  5. Layer instance count = max loop length across all of the layer's bound properties.
- DECIDED (2026-09): **Count 0 means no copies, and an empty loop is loud, not hidden.** A test session's swipe deck went empty and stayed empty: a feedback cable carried last frame's empty loop back in, Loop Select dropped out-of-range indices, and nothing said why. Stitch, an open-source node prototyping app we studied for behavior, avoids that by giving every loop at least one item (an empty source gives a default item per index). Sonobe doesn't adopt that rule: it hides a list filtered to nothing instead of explaining it, and it breaks rule 4. Instead ([ARCHITECTURE.md](../../ARCHITECTURE.md) §4 and §5.2):
  - Last frame's empty loop never erases this frame's copies. A back-edge that carries an empty loop into a per-item input reads the input's default, as on frame 0, so a cycle that empties for a frame refills. Within one frame an empty loop still wins.
  - Loop Select has an Out of Range input. Skip (the default) still leaves out-of-range indices out; Clamp, Wrap and Use Fallback give one item per index, so a cycle through Loop Select, like "the card above", can't shrink.
  - The runtime raises `empty_loop` when an empty loop erases a non-empty one or a patch explains its empty output, naming the layer, where the empty loop started, what it erased and the feedback cable, with fixes. The viewer, the Diagnostics tab, simulation results and `get_diagnostics` show it, and `inspect` notes (`sim_get_values`) say why a value reads as nothing. A list that is simply empty stays quiet.
- JS patches: with `loopAware = false`, "multiple copies of the patch's JavaScript environment will be created to process each value in a loop" (VERIFIED). So per-index state is isolated. With `loopAware = true`, `PatchInput.values` is the array and `PatchOutput.values` sets a loop output ([JS API](https://origami.design/documentation/concepts/scriptingapi)).

### 6.5 Per-index state (VERIFIED legacy; INFERRED modern)

Stateful patches (Switch, Counter, animations, Delay, Sample and Hold, Interaction) hold an **independent state per loop index**. Legacy evidence:
- `POPBouncyPatch._iterations[]`
- `FBODelayPatch.valueLists[iterationKey]`
- `FBOInteractionPatch.outputDowns[iterationKey]`
- `FBLastValue.values[currentIteration]`

INFERRED spec: state storage is keyed by (node id, component-instance path, loop index). When a loop shrinks, drop the state of removed indices. When it grows, new indices start from defaults (the Pop Animation "from = to" rule avoids an initial animation, §7.6).

---

## 7. Springs and animation math (exact formulas)

### 7.1 Pop Animation patch (VERIFIED docs)

- Inputs: `Number` ("The number to animate to"), `Bounciness`, `Speed`. Output: "A number that is tweened… with a bouncy animation as it moves toward the Number input" ([Pop Animation](https://origami.design/documentation/patches/builtin.bouncy)).
- Shortcut A ([Animations](https://origami.design/documentation/patch-editor/animations)).
- Defaults: Bounciness **5**, Speed **10**. VERIFIED legacy `Pop Animation.qtz` `inputParameters`; the docs' States & Pulses example also shows Bounciness 5, Speed 10.
- **DOC-DRIFT**: v72 (09/24/2020) "Classic Animation and Pop Animation now support different data types like Position." The docs still say "numeric value."
  - INFERRED: vector types animate component-wise with independent springs.
- Legacy composition (VERIFIED `Pop Animation.qtz`): `POPConverterPatch(bounciness, speed) → tension, friction, mass` feeds `POPBouncyPatch(Value=Number)`.

### 7.2 Bounciness/Speed → Origami (QC) tension/friction: `BouncyConversion` (VERIFIED, exact)

Java: https://github.com/facebook/rebound/blob/master/rebound-core/src/main/java/com/facebook/rebound/BouncyConversion.java
JS: https://github.com/facebookarchive/rebound-js/blob/master/src/BouncyConversion.js
POP (identical math): `pop/POPAnimationExtras.mm` `+convertBounciness:speed:toTension:friction:mass:`, with constants `POPBouncy3NormalizationRange = 20.0`, `POPBouncy3NormalizationScale = 1.7`, `BouncinessNormalizedMin = 0.0`, `Max = 0.8`, `SpeedNormalizedMin = 0.5`, `Max = 200`, `FrictionInterpolationMax = 0.01`.

```
normalize(v, a, b)              = (v − a) / (b − a)
project_normal(n, a, b)         = a + n × (b − a)
linear_interpolation(t, a, b)   = t × b + (1 − t) × a
quadratic_out_interpolation(t, a, b) = linear_interpolation(2t − t², a, b)

b3_friction1(x) = 0.0007·x³ − 0.031·x² + 0.64·x + 1.28
b3_friction2(x) = 0.000044·x³ − 0.006·x² + 0.36·x + 2.0
b3_friction3(x) = 0.00000045·x³ − 0.000332·x² + 0.1078·x + 5.84

b3_nobounce(tension) =
    tension ≤ 18         → b3_friction1(tension)
    18 < tension ≤ 44    → b3_friction2(tension)
    tension > 44         → b3_friction3(tension)

BouncyConversion(bounciness, speed):
    b = normalize(bounciness / 1.7, 0, 20.0)
    b = project_normal(b, 0.0, 0.8)
    s = normalize(speed / 1.7, 0, 20.0)
    bouncyTension  = project_normal(s, 0.5, 200)                           // Origami/QC tension
    bouncyFriction = quadratic_out_interpolation(b, b3_nobounce(bouncyTension), 0.01)  // Origami/QC friction
```

Argument-order gotcha (VERIFIED):
- Java constructor is `BouncyConversion(double speed, double bounciness)`, and `SpringConfig.fromBouncinessAndSpeed(bounciness, speed)` calls `new BouncyConversion(speed, bounciness)`.
- JS constructor is `constructor(bounciness, speed)`.
- Both paths are consistent. Take care when porting.

### 7.3 Origami (QC) tension/friction → physical k, c: `OrigamiValueConverter` (VERIFIED, exact)

Java: https://github.com/facebook/rebound/blob/master/rebound-core/src/main/java/com/facebook/rebound/OrigamiValueConverter.java

```java
tensionFromOrigamiValue(o)  = o == 0 ? 0 : (o − 30.0) × 3.62 + 194.0
origamiValueFromTension(t)  = t == 0 ? 0 : (t − 194.0) / 3.62 + 30.0
frictionFromOrigamiValue(o) = o == 0 ? 0 : (o − 8.0) × 3.0 + 25.0
origamiValueFromFriction(f) = f == 0 ? 0 : (f − 25.0) / 3.0 + 8.0
```

- rebound-js (`src/OrigamiValueConverter.js`) has the **same formulas without the `== 0` guard**. Its inverse friction function is named `origamiFromFriction`.
- POP (`pop/POPAnimationPrivate.h`) writes the same mapping differently. It is algebraically identical, since 181/50 = 3.62 and 6/2 = 3:
  ```
  POP_ANIMATION_TENSION_FOR_QC_TENSION(q)   = 194.0 + ((q − 30.0)/50.0) × (375.0 − 194.0)
  POP_ANIMATION_FRICTION_FOR_QC_FRICTION(q) = 25.0 + ((q − 8.0)/2.0) × (25.0 − 19.0)
  ```
- Mass = 1.0 (POP converter `*outMass = 1.0`).
- `SpringConfig.fromOrigamiTensionAndFriction(t, f) = SpringConfig(tensionFromOrigamiValue(t), frictionFromOrigamiValue(f))`.
- `SpringConfig.fromBouncinessAndSpeed(b, s)` = BouncyConversion, then fromOrigamiTensionAndFriction.
- `SpringConfig.coastingConfigWithOrigamiFriction(f) = SpringConfig(0, frictionFromOrigamiValue(f))` (JS).
- Rebound default config: `fromOrigamiTensionAndFriction(40, 7)` → k = 230.2, c = 22.0 (VERIFIED `SpringConfig.java` / `SpringConfig.js`).
- The legacy QC "Bouncy Animation" macro had inputs `Number`, `Friction`, `Tension`, defaults **Tension 30, Friction 8**. Those are exactly the converter's anchor point, mapping to k = 194, c = 25 (VERIFIED `Bouncy Animation.qtz`).

Inverse conversion (VERIFIED, POP `+convertTension:friction:toBounciness:speed:`):

```
qcFriction = QC_FRICTION_FOR_POP_ANIMATION_FRICTION(friction)   = 8.0 + 2.0 × ((f − 25.0)/(25.0 − 19.0))
qcTension  = QC_TENSION_FOR_POP_ANIMATION_TENSION(tension)      = 30.0 + 50.0 × ((t − 194.0)/(375.0 − 194.0))
nb = POPBouncy3NoBounce(qcTension)
solve a·x² + b·x + c = 0 with a = nb − 0.01, b = 2(0.01 − nb), c = nb − qcFriction
    x1 = (−b + √(b²−4ac)) / 2a ;  x2 = (−b − √(b²−4ac)) / 2a
projectedNormalizedBounciness = (x2 < 0.8) ? x2 : x1
projectedNormalizedSpeed      = qcTension
bounciness = ((20 × 1.7) / (0.8 − 0.0)) × (projectedNormalizedBounciness − 0.0)
speed      = ((20 × 1.7) / (200 − 0.5)) × (projectedNormalizedSpeed − 0.5)
```

This is what a **Bouncy Converter** in reverse, or Spring Converter → Bounciness/Speed, needs.

### 7.4 Worked examples (computed from the formulas above)

| Bounciness | Speed | QC tension | QC friction | k (tension) | c (friction) | ζ = c / (2√k) | ω₀ = √k (rad/s) |
|---|---|---|---|---|---|---|---|
| 5 (Origami default) | 10 (Origami default) | 59.1765 | 8.6829 | 299.6188 | 27.0487 | 0.781 | 17.31 |
| 0 | 10 | 59.1765 | 11.1499 | 299.6188 | 34.4496 | 0.995 (≈critical) | 17.31 |
| 10 | 10 | 59.1765 | 6.5243 | 299.6188 | 20.5729 | 0.594 | 17.31 |
| 5 | 20 | 117.8529 | 11.4234 | 512.0276 | 35.2702 | 0.779 | 22.63 |
| 4 (POP default) | 12 (POP default) | 70.9118 | 9.8290 | 342.1006 | 30.4870 | 0.824 | 18.50 |

Observations (INFERRED from the math):
- Speed alone sets stiffness.
- Bounciness 0 gives ≈critical damping ("no bounce" polynomial fit).
- Speed 0 still gives k = 87.21, because the tension range starts at 0.5 QC.
- POP documents the valid range of `springBounciness` and `springSpeed` as [0, 20], defaults 4 and 12 (VERIFIED `pop/POPSpringAnimation.h`). Origami does not clamp in the docs.

### 7.5 Rebound spring integrator (VERIFIED, rebound-js `src/Spring.js`; Java `Spring.java`)

Constants:
- `MAX_DELTA_TIME_SEC = 0.064` (Java and JS)
- `SOLVER_TIMESTEP_SEC = 0.001` (Java and JS)
- Rest thresholds: JS `_restSpeedThreshold = 0.001`, `_displacementFromRestThreshold = 0.001`; Java `0.005` / `0.005`.

Model: the force is `a = k·(end − x) − c·v` (mass 1), integrated with RK4 at a fixed 1 ms step:

```
advance(time, realDeltaTime):
  if isAtRest() && wasAtRest: return
  dt = min(realDeltaTime, 0.064)
  accumulator += dt
  while accumulator ≥ 0.001:
     accumulator −= 0.001
     if accumulator < 0.001: previous = (x, v)
     aV = v;            aA = k·(end − tempX) − c·v        // note: JS uses tempPosition here (stale from last substep)
     tempX = x + aV·0.0005; tempV = v + aA·0.0005
     bV = tempV;        bA = k·(end − tempX) − c·tempV
     tempX = x + bV·0.0005; tempV = v + bA·0.0005
     cV = tempV;        cA = k·(end − tempX) − c·tempV
     tempX = x + cV·0.001;  tempV = v + cA·0.001
     dV = tempV;        dA = k·(end − tempX) − c·tempV
     x += (aV + 2(bV + cV) + dV)/6 · 0.001
     v += (aA + 2(bA + cA) + dA)/6 · 0.001
  if accumulator > 0: interpolate(alpha = accumulator/0.001):
     x = x·alpha + previous.x·(1−alpha);  v = v·alpha + previous.v·(1−alpha)
  if isAtRest() || (overshootClamping && isOvershooting()):
     if k > 0: start = end; x = end
     else:     end = x; start = end              // coasting spring stops where it is
     v = 0
  notify onSpringActivate (if was at rest) / onSpringUpdate / onSpringAtRest
```

- `isAtRest() = |v| < restSpeedThreshold && (|end − x| ≤ displacementThreshold || k == 0)`. Java uses `<=` for speed.
- `isOvershooting() = k > 0 && ((start < end && x > end) || (start > end && x < end))`.
- **Retargeting**:
  - `setEndValue(end)` returns early if equal and at rest. Otherwise it sets `start = current x`, sets `end`, and activates the spring. **Velocity is untouched**, so mid-flight retargets are C¹-continuous (velocity preserved).
  - `setVelocity(v)` injects velocity (gesture fling).
  - `setCurrentValue(x, skipSetAtRest)` jumps position. Unless skipped it calls `setAtRest()`, which sets `end = x` and `v = 0`.
- SpringSystem loop: on the first frame `_lastTimeMillis = currentTimeMillis − 1`; `elapsed = now − last`; advance all active springs; the loop idles when all are at rest (VERIFIED `SpringSystem.js`).
- Helper `MathUtil.mapValueInRange(value, fromLow, fromHigh, toLow, toHigh) = toLow + ((value − fromLow)/(fromHigh − fromLow))·(toHigh − toLow)`. Unclamped. It is the legacy Origami export of Transition (VERIFIED `Origami Plugin/Code Export/TransitionFunction.js`: `transition(progress, start, end) = rebound.MathUtil.mapValueInRange(progress, 0, 1, start, end)`).
- Legacy code export (VERIFIED `Code Export/SpringSetup.js`): `springSystem.createSpringWithBouncinessAndSpeed(b, s)`, with `onSpringUpdate → setProgress(spring.getCurrentValue())` and a switch callback `spring.setEndValue(on ? 1 : 0)`. This is the canonical Switch → Pop Animation → Transition chain.

### 7.6 POP solver and the legacy Pop patch runtime (VERIFIED, `pop/POPSpringSolver.h`, `POPSpringAnimationInternal.h`, `Origami Plugin/POPBouncyPatch.mm`)

- POP SpringSolver:
  - State is displacement-from-target `p = to − value`, with velocity flipped: `state.v = −velocity`.
  - Acceleration `= p·(−k/m) − v·(b/m)` (mass supported).
  - RK4, `solverDt = 0.001`, `maxSolverDt = 30.0`: if dt > 30 s the state is zeroed.
  - Fixed-step accumulator plus alpha interpolation, the same scheme as Rebound.
- POP convergence:
  - `setThreshold(t)`: `_tp = t/2`, `_tv = 25·t`, `_ta = 625·t²`. Converged if all `|p| < _tp` and `|v|² < _tv` and `|dv|² < _ta`.
  - Also converged when the last 3 frames are within `threshold/5` of the target.
  - The Origami property threshold is **0.001** (`prop.threshold = 0.001` in POPBouncyPatch).
- Legacy POPBouncyPatch behavior:
  1. Per-iteration spring (loop index). If `time` decreased (viewer restart), all iteration state is cleared.
  2. When the input `Value` changes, `spring.toValue = value`. If `inputVelocitySignal` is true, it also sets `spring.velocity = inputVelocity`. Otherwise velocity continues (retarget preserves velocity).
  3. **Lazy init**: `if (!spring.fromValue) spring.fromValue = spring.toValue;`. The first value does not animate from 0, so a Pop Animation starts at its initial Number.
  4. Dynamics inputs (Tension, Friction, Mass) update the spring constants live, without resetting state. Legacy raw-POP-unit defaults: Tension 342, Friction 20, Mass 1; ranges 0–1000.
  5. `spring.paused = NO` each frame; `animator renderTime:time` drives it from the frame time.
- INFERRED spec: Pop Animation is a critically-or-under-damped spring per component. State = (x, v, target) per index. Input change → retarget keeping v. The first evaluation sets x = target, v = 0.

### 7.7 Spring Animation, Spring Converter, Bouncy Converter, Fluid Spring Animation

**Spring Animation** (VERIFIED, [Spring Animation](https://origami.design/documentation/patches/builtin.springanimation)):
- Inputs: `Number` (target), `Mass`, `Tension`, `Friction`, `Gesture Active`, `Gesture Velocity`. Output: current value.
- "Creates a animation based on a physically modeled spring. This also allows for interruptible animations by controlling the velocity of the spring."
- Gesture Active: "If a gesture is active, the spring will animate immediately to its destination value. When this switches from On to Off, the spring will sample the Gesture Velocity and use it for the animation. This allows for throwing an object… Typically this is the value from the Down port on an Interaction or Gesture patch."
- Gesture Velocity: "sampled for the spring animation" on the falling edge of Gesture Active.
- v120 (07/25/2022): "Spring Animation now supports other types like Point and Color." (**DOC-DRIFT**: the docs say number.)
- INFERRED:
  - While Gesture Active: `x = target, v = 0` (tracking).
  - On the falling edge: `v = GestureVelocity`, then integrate `m·a = k·(target − x) − c·v`.
  - The units of Tension/Friction are undocumented. Most likely raw k and c (like UIKit/SwiftUI stiffness/damping), because Spring Converter maps SwiftUI response/damping to them. Flag as an open question.

**Spring Converter** (VERIFIED, [Spring Converter](https://origami.design/documentation/patches/builtin.springconverter)):
- Inputs: `Response` ("Approximately how long for the spring animation to reach its destination"), `Damping Fraction` ("0… oscillate endlessly, 1 means don't bounce at all").
- Outputs: `Tension`, `Friction` (for Spring Animation), `Bounciness`, `Speed` (for Pop Animation).
- "conversion from Apple's Fluid Spring dynamics values (see SwiftUI)."
- SwiftUI definitions (VERIFIED, Apple DocC JSON for `Spring.init(response:dampingRatio:)`): response "Defines the stiffness of the spring as an approximate duration in seconds"; dampingRatio "Defines the amount of drag applied as a fraction the amount needed to produce critical damping."
- Equations (VERIFIED as stated on the [Apple forums thread 739811](https://developer.apple.com/forums/thread/739811)):
  - `mass = 1`, `stiffness = (2π ÷ duration)²`, `dampingRatio = friction ÷ (2 × √(stiffness × mass))`.
  - Corrected damping: `damping = ((1 − bounce) × 4π) ÷ duration` for bounce ≥ 0.
- Therefore (INFERRED, derived): `k = (2π / response)² · m` and `c = 4π · ζ · m / response`.
  - Example: response 0.55, ζ 0.825 (SwiftUI defaults) → k = 130.51, c = 18.85.
  - Bounciness/Speed then come via the POP inverse (§7.3).

**Bouncy Converter** (VERIFIED, [Bouncy Converter](https://origami.design/documentation/patches/builtin.bouncyconverter)): `Bounciness`, `Speed` → `Friction`, `Tension`. It is the legacy POPConverterPatch. INFERRED: outputs are **physical** (POP units, k and c) per the converter code. The legacy patch also output Mass (= 1).

**Fluid Spring Animation Patch**: v223 (07/07/2026) "Fluid Spring Animation Patch." **DOC-DRIFT**: no docs page exists. INFERRED: takes Response / Damping Fraction (SwiftUI-style) directly.

### 7.8 Classic Animation and easing curves

VERIFIED ([Classic Animation](https://origami.design/documentation/patches/builtin.classicanimation)):
- Inputs: `Number` (target), `Duration` (seconds), `Curve`. Output: tweened value. Shortcut C.
- Curve options:
  - Linear
  - Quadratic In, Out, In & Out
  - Cubic In, Out, In & Out
  - Exponential In, Out, In & Out
  - Sinusoidal In, Out, In & Out
- The same curve list appears on **Curve** ([Curve](https://origami.design/documentation/patches/builtin.curve)) and **Repeating Animation**.
- Type support:
  - v72: Classic Animation supports "different data types like Position."
  - v91: "Classic animation patch supports size types."
  - v190: "Fix issue with stable animations for size types."
  - **DOC-DRIFT**: the docs say "Animate a number."
- Legacy (VERIFIED `Classic Animation.qtz`): a QC **Smooth** patch. `Number → inputValue`; `Duration → inputIncreasingDuration` and `inputDecreasingDuration`; `Curve → inputIncreasingInterpolation` and `inputDecreasingInterpolation`. Defaults: Duration **0.4**, Curve index **3**.
  - INFERRED: index 3 = "Quadratic In & Out" if the list order is [Linear, QuadIn, QuadOut, QuadInOut, …].

Curve equations: the docs give none. INFERRED as standard Penner easing, which QC's interpolation used; formulations VERIFIED in BSD jQuery Easing v1.4.1 (https://github.com/gdsmith/jquery.easing/blob/master/jquery.easing.js), with `x ∈ [0,1]`:

```
Linear:            x
Quadratic In:      x²
Quadratic Out:     1 − (1 − x)²
Quadratic In&Out:  x < .5 ? 2x² : 1 − (−2x + 2)² / 2
Cubic In:          x³
Cubic Out:         1 − (1 − x)³
Cubic In&Out:      x < .5 ? 4x³ : 1 − (−2x + 2)³ / 2
Exponential In:    x == 0 ? 0 : 2^(10x − 10)
Exponential Out:   x == 1 ? 1 : 1 − 2^(−10x)
Exponential In&Out:x == 0 ? 0 : x == 1 ? 1 : x < .5 ? 2^(20x − 10)/2 : (2 − 2^(−20x + 10))/2
Sinusoidal In:     1 − cos(xπ/2)
Sinusoidal Out:    sin(xπ/2)
Sinusoidal In&Out: −(cos(πx) − 1) / 2
```

Retargeting (INFERRED; no primary source): when `Number` changes mid-flight, restart a new tween from the *current output value* to the new target over the full Duration with the selected curve. Velocity is not preserved (C⁰ continuity only). This matches QC Smooth ("smooths an input value… over a duration"). Recommendation: implement exactly this, and optionally compensate the duration for partial distance. Flag as an open question.

**Cubic Bezier Animation** (VERIFIED, [Cubic Bezier Animation](https://origami.design/documentation/patches/builtin.cubicanimation)):
- Inputs: `Number`, `Duration`, plus 4 control-point inputs (X1, Y1, X2, Y2). Outputs: value and `Path` ("X, Y position of the input progress on the curve").
- "The cubic bezier curve is normalized and then scaled… the start point of the curve is always (0,0) and the end is always (number,number)."
- v117 "Support Slow animations in Cubic Bezier animation."

**Cubic Bezier Curve** (VERIFIED, [Cubic Bezier Curve](https://origami.design/documentation/patches/builtin.cubicbezier)): `Progress` (0–1) plus 4 control values → `Progress`, `2D Progress`. Normalized (0,0)→(1,1). INFERRED: CSS-style `cubic-bezier(x1,y1,x2,y2)`; solve x(t) = progress for t, output y(t).

**Curve**: `Progress`, `Curve` → progress remapped by the easing function.

### 7.9 Transition, Arc Transition, Progress, Reverse Progress

**Transition** (VERIFIED docs, [Transition](https://origami.design/documentation/patches/builtin.transition)): inputs `Progress`, `Start`, `End`; output value. Shortcut T.
- Examples with Start 50, End 100: p = 0 → 50, .5 → 75, 1 → 100. "The number wraps when progress exceeds the 0 to 1 range: a progress of -.5 will output 25; a progress of 2 will output 150."
  - Note: "wraps" is a misnomer; those numbers are **linear extrapolation**.
- "Right-click to change the type (ex: number, position, color)."
- v173 (08/06/2024): "Added the ability to transition percentage value in a transition patch."
- Formula (VERIFIED by the doc numbers and by the legacy `Transition.qtz` graph: `Math(End − Start) → Math(× Progress) → Math(+ Start)`):

  ```
  Transition(p, start, end) = start + p × (end − start)        // component-wise for vectors/colors, unclamped
  ```

- Color: the legacy `Color Transition.qtz` split RGBA into components and ran 4 Transition patches (VERIFIED nodes `ColorToComponents_rgb` → 4× `/transition` → `ColorFromComponents_rgb`). So colors interpolate linearly in **RGB(A) space**. INFERRED for Studio; the color space is not documented.

**Arc Transition** (VERIFIED ports, [Arc Transition](https://origami.design/documentation/patches/origami.arctransition)): `Progress`, `Start`, `Middle`, `End` → Output, "specifying a middle value it should pass through." The formula is undocumented. INFERRED options: a quadratic through the 3 points at p = 0, .5, 1 (Lagrange), or piecewise Transition. Open question.

**Progress** (VERIFIED, [Progress](https://origami.design/documentation/patches/builtin.progress)): `Value`, `Start Value`, `End Value` → Progress.
- Legacy `Progress.qtz` (VERIFIED graph): `(Value − Start) / d`, where `d = (End − Start == 0) ? 0.0001 : (End − Start)`. The divide-by-zero guard is built from a Conditional plus a Transition with End_Value 0.0001.
- Legacy multi-stop `FBOProgressPatch` (VERIFIED code, "Multi-stop Progress"; example "value 200, stops 100, 150, 250 → 1.5"):
  - `stops.count < 2` → 0.
  - `value ≤ first` → `(v − s0)/(s1 − s0)`.
  - `value ≥ last` → `(v − s[n−2])/(s[n−1] − s[n−2]) + (n − 2)`.
  - Otherwise, for the first i with `(s_i < v < s_{i+1}) || v == s_i` → `(v − s_i)/(s_{i+1} − s_i) + i`.

**Reverse Progress**: "0 to 1 becomes 1 to 0, .3 becomes .7" → `1 − p` ([Reverse Progress](https://origami.design/documentation/patches/origami.reverseprogress)). Legacy: Transition(p, 1, 0). VERIFIED.

### 7.10 Repeating Animation (and "Wave")

**Repeating Animation** (VERIFIED, [Repeating Animation](https://origami.design/documentation/patches/builtin.repeatingmotion)), docs slug `builtin.repeatingmotion`, also called "Repeating Motion" on the Animations page:
- Inputs: `Enable`, `Duration` ("The length, in seconds, of the animation in one direction"), `Curve` (same list), `Mirrored` ("animate back and forth between 0 and 1. If false, the animation will reset immediately to 0 when it hits 1"), `Reset` (pulse to beginning). Output: Progress.
- INFERRED formula, with `τ` = accumulated enabled time since Reset:
  - not mirrored: `curve(frac(τ / Duration))`
  - mirrored: `u = τ / Duration mod 2; curve(u ≤ 1 ? u : 2 − u)`
  - Open question: whether the curve is applied per leg or mirrored.

**Wave**: **no "Wave" patch exists in the current docs index** (256 pages checked). DOC-DRIFT or never existed in Studio. The legacy QC LFO patch had waveforms (used with `inputType` 3 in Repeating Pulse). INFERRED: build sine waves from `Time` → Math Expression `Math.sin(2*Math.PI*t/period)`, or offer an LFO-style patch with Sine/Triangle/Square/Sawtooth.

### 7.11 Other motion and physics patches (VERIFIED ports)

- **Pop Switch** ([Pop Switch](https://origami.design/documentation/patches/origami.popswitch)):
  - Inputs: `Enable`, `Layer`, `Gesture` ∈ {Swipe X, Swipe Y, Pinch Scale, Pinch Rotate, Pinch X, Pinch Y}, `Start Value`, `End Value`, `Flip`/`Turn On`/`Turn Off` (pulses), `Bounciness`, `Speed`.
  - Outputs: `Value`, `Progress`, `On/Off` ("true… When the current position… is closer to the end value than the start value… When the switch is flipped…").
  - This is the modern equivalent of the legacy **Swipe** macro. Legacy `Swipe.qtz` inputs: Enable, Direction, Start_Position, End_Position (default 600), Flip, Jump_to_Start, Jump_to_End, Settings. Outputs: Position, Progress, Index, Interaction.
- **Momentum Scrolling**: `Sample Value` (bool), `Value`, `Scrolling Friction` (1–100), `Rubber Band Tension` (10–1000), `Rubber Band Friction` (10–1000) → Output. For feedback loops.
- **Scroll** ([Scroll](https://origami.design/documentation/patches/builtin.layer.scroll)): inputs `Content Layer`, `Enable`, `Scroll X`/`Scroll Y` ∈ {None, Free, Paging}, `Settings`. Outputs `X`, `Y`, `Page X`, `Page Y`.
  - **Scroll Settings**: Content Size, Direction Locking, Page Size, Page Padding, Jump Style X/Y (animated or instant), Jump to X/Y (pulses), Jump Position X/Y.
  - **DOC-DRIFT**: v104 "Added Deceleration Rate to Scroll Settings" is not in the docs.
  - Scroll fixes: v186 improved momentum; v122 overshoot jump fixes; v115 out-of-bounds index; v129 reset on disable.
- **Drag** ([Drag](https://origami.design/documentation/patches/origami.drag)): `Enable`, `Layer`, `Start` (initial position), `Reset` (pulse), `Settings` → `Position`.
  - **Drag Settings**: `Clip`, `Min` (top-left point), `Max` (bottom-right), `Momentum` (bool), `Momentum Friction` (0–950).

### 7.12 Retargeting summary for our spec

| Patch | On target change mid-animation | Source |
|---|---|---|
| Pop Animation | Retarget; keep position and velocity (C¹). First value = no animation. | VERIFIED (rebound `setEndValue`, POPBouncyPatch) |
| Spring Animation | Retarget keeping velocity. Gesture Active: track target; release injects Gesture Velocity. | VERIFIED docs + INFERRED detail |
| Classic Animation / Cubic Bezier Animation | New tween from current value to new target over the full duration (velocity discontinuity). | INFERRED |
| Transition / Progress / Curve | Stateless; instantaneous. | VERIFIED |
| Smooth Value | Exponential smoothing each frame. | VERIFIED |
| Repeating Animation | Time-based; Reset pulse restarts; Enable pauses (INFERRED: hold the value). | VERIFIED ports |

---

## 8. Interaction patches, hit areas and touch propagation

### 8.1 Interaction (VERIFIED, [Interaction](https://origami.design/documentation/patches/builtin.layer.interaction))

- Inputs: `Layer` ("When no layer is specified, the touches on the whole screen are registered"), `Enable`.
- Outputs:
  - `Down`: "true when there is a touch on the layer" (state).
  - `Tap`: "A pulse that represents the moment a touch has been released from the layer (touch up) as long as the touch is inside of the layer and hasn't moved."
  - `Position`: "relative to the center of the layer's parent group or device."
  - `Force`: "A number between 0 and 6.67."
- "Layers must be enabled and have an opacity larger than 0 to receive touches." Shortcut I.
- Legacy `FBOInteractionPatch` ("Interaction 2") outputs, VERIFIED `English.lproj/FBOInteractionPatch.xml` and `.m`:
  - `Down`: "Outputs a 1 if the touch is currently down on the layer."
  - `Up`: pulse "when the layer is pressed and released"; = the value of Down at release.
  - `Tap`: pulse "when the layer is tapped while the touch is stationary."
    - Tap only if the up point is inside a **10×10 px tolerance square** centered on the down point (`kTapTolerance = 10`).
    - For mouse it also requires Down still true at release.
  - `Drag`: "Outputs a 1 if the touch started down on the layer and stays 1 until the touch is released."
  - `Interaction`: the patch object, fed to a layer's Interaction port.
  - Input `Enable`: "Turn this off to have taps pass through the layer."
  - During a drag, `Down` is re-hit-tested every frame. It turns false if the finger leaves the layer while `Drag` stays true.
  - Mouse position was converted to viewer-centered coordinates and scaled for Retina.

### 8.2 Gesture, Hover, Mouse, Keyboard, Trackpad, Touches, Long Press, Double Tap (VERIFIED)

- **Gesture** ([Gesture](https://origami.design/documentation/patches/builtin.layer.gesture)): `Layer`, `Enabled` → `Down`, `Tap`, `Position`, `Velocity` ("points per second"), `Translation` ("relative to where the touch initially started"). Built for interruptible springs.
- **Hover**: `Layer`, `Enable` → `Hover` (bool), `Position`. "Does not work on simulated or connected phones or tablets."
- **Mouse**: → `Down`, `Location` ("relative to the center of the viewer"). v74 right click; v80 mouse scrolling; v199 position on right/middle click.
- **Keyboard** (K): `Key` (text) → `Down` (bool). v114 added Arrow keys, Shift, CapsLock, Control, Option, Command, Escape, Delete, Tab. v138 right-side modifiers work; no stuck modifiers.
- **Touches** / **Trackpad**: → `Touches` JSON (position and force of every touch).
- **Long Press**: `Down` (from Interaction), `Delay` (default **0.5 s**) → `Long Press` ("Turns on when the press passes the duration"). Legacy macro default Duration 0.2.
- **Double Tap**: `Tap` (pulse), `Delay` (max interval, default **0.3 s**) → `Double Tap` (pulse), `Single Tap` (pulse "when one tap occurs in the specified delay").
  - INFERRED: Single Tap fires after the Delay elapses without a second tap.
- "Press" and "Swipe" patches: **none in the current docs**. Press = Interaction.Down; Swipe → Pop Switch / Scroll (legacy Swipe macro).

### 8.3 Hit testing and propagation

- VERIFIED (current docs): "Layers need to be enabled and have opacity larger than 0 to receive touches. Touches in Layer Groups are propagated and shared with the parent groups, allowing you to build scrolling layer groups with tappable layers inside" ([Interactions Patch](https://origami.design/documentation/patch-editor/interactions)).
- Release notes: v82 "Improved tap detection on layers"; v113 "Improved gesture patch hit test logic"; v109.1 "Fixed issue with gesture recognizers not registering on patches."
- VERIFIED (legacy `FBOInteractionController.m`), for historical reference:
  - On touch-down, the whole render tree is traversed. Consumer subpatches go in **reverse order** (topmost rendering layer first).
  - For each layer, the point is transformed into layer space with the inverse of `translate(x,y) → rotate(Z) → scale`. Scale 0 is replaced with 0.00001.
  - The point is tested against a center-origin box (`−w/2 < x < w/2`, `−h/2 < y < h/2`). Width/height of 0 means use the image bounds.
  - A layer is skipped if `alpha < 0.00001`, it is disabled, or its Interaction patch has Enable off (pass-through).
  - On a hit, the layer is appended to `hitPatches` and traversal recurses into its children (Render-In-Image subtree). The first successful hit at a level stops further sibling traversal.
  - An Interaction patch registers Down only if `hitPatches.lastObject == its layer`, i.e. the **deepest** hit layer.
  - **DOC-DRIFT**: legacy = deepest-only. Studio docs = shared with parent groups.
- INFERRED spec for our engine:
  1. Hit-test front-to-back in render order using each layer's full transform (anchor, pivot, rotation, scale, 3D).
  2. Eligible: enabled, effective opacity > 0, and (if it has an Interaction/Gesture patch) Enable = true.
  3. Deliver the touch to the deepest hit layer **and** its ancestor groups (bubbling, not exclusive), so Scroll on a parent and Tap on a child both work.
  4. A Scroll/Drag that begins moving should cancel the child's Tap. Tap requires "hasn't moved": use a slop of ~10 pt, matching legacy.
- **Hit Area** ([Hit Area](https://origami.design/documentation/patches/origami.hitarea)): an invisible interactive rectangle layer. `Enable`, `Position` (Point 3D for z), `Anchor`, `Size`, `Setup Mode` ("see where it's positioned"). Legacy macro defaults: Width 100, Height 100, Setup_Mode true, Anchor index 4.
- Coordinate conventions: see §4.3.

---

## 9. Components, published ports, patch groups

VERIFIED ([Components](https://origami.design/documentation/workflow/components)):
- "Components can be comprised of layers, patches or both. **Patch Components**… Think of them similarly to functions in programming. **Layer Components** are made up of both layers and patches."
- Create: select patches, then Component > Create Component ⌃⌘G / "Group Into Component…". "The group of patches above will be replaced by a new single patch component… with the inputs and outputs of the nodes it was connected to." v88 "Component patch grouping is smarter about input/output connections."
- "Layer property patches cannot be grouped into a patch component - to build patch groups with layers, use layer components."
- Enter ⌥↓ (double-click), exit ⌥↑ (layer components: ⌃⌥↑). v156 (12/11/2023): "Enter into a component without having to unlink it… Control+Option+Down… 'Inspect Instance'."
- "The Input ports within components are represented by purple patches and the Output ports are represented by the blue patches."
- Component Info ⇧⌘I, "Port Setup tab allows you to change the port type and other properties like default, maximum and minimum values."
- Publish Port ⌥P "will add a purple or blue patch."
- "Special port tags… using the Enable tag will reveal the eye icon… When a special tag isn't needed, use the generic Custom tag."
- Library: Add to User Library ⌘⌥L; linked components upgrade on reopen; "Unlink Component from Library." Platform-limited components.
- Release notes:
  - v98: Container Components via "Sublayer Container" layer plus "Virtual Sublayer."
  - v84: individual component upgrades.
  - v172: port categories for outputs.
  - v189: renaming a main component renames un-renamed instances.
  - v192: components grow comments.
  - v185: fixes deleting enum options/ports.
- Semantics (INFERRED spec): a component instance = an isolated subgraph with its own state per instance and per loop index (§6.5). Published input ports = boundary nodes carrying defaults/min/max. Per-port Loop Behavior (§6.2). Outputs from looped instances flatten.
- Legacy heritage (VERIFIED): QC macros with `publishedInputPorts` mapping a key (e.g. `Start_Value`) to an internal node port (e.g. `Splitter_1.input`). The splitter-as-boundary-node pattern is how Origami macros exposed typed ports.

---

## 10. Variables (formerly Wireless Broadcaster/Receiver)

VERIFIED ([Variables](https://origami.design/documentation/concepts/variables), [Variable Broadcaster](https://origami.design/documentation/patches/builtin.wirelessbroadcaster), [Variable Receiver](https://origami.design/documentation/patches/builtin.wirelessreceiver)):
- "(In previous versions of Origami these patches were named Wireless Broadcasters and Receivers…)." **DOC-DRIFT**: the [Patch Organization](https://origami.design/documentation/workflow/patchorganization) page still says "Wireless Broadcaster W and Wireless Receiver ⇧W."
- A Broadcaster "Sends a value to any Variable Receiver patch set to receive the same name." "Rename the patch to set the name of the value. Right-click the patch to change the type of the value, or to change the scope."
- Scope: Local by default ("available only within the current patch graph") or **Global** ("within the current patch graph as well as any child components").
- "Global variable values cascade downward throughout components… components can override an ancestor's global variable by defining a new global variable with the same name and type… receivers get their values from the matching global variable broadcaster that's nearest in the component hierarchy."
- Receiver: "Click the patch name to select the value to receive. Click the wireless icon to jump to the corresponding local Variable Broadcaster."
- Release notes: v78 preserve receivers on copy/paste; v97 broadcaster renaming improvements; v163 fix clicking receivers to jump.
- Legacy implementation (VERIFIED `FBWirelessInPatch.m` / `FBWirelessOutPatch.m`):
  - The broadcaster is a *Consumer*. Every frame it writes `keyedData[name] = value` into a per-document controller dictionary. On rename it deletes the old key; on disable it removes its key.
  - The receiver is a *Provider* that reads `keyedData[selectedKey]`. When created it auto-selects the most recently created key.
  - Port types: String, Number, Color, Boolean, Index, Image, Structure, Virtual.
- INFERRED spec: treat a variable as an implicit edge from broadcaster to receivers (resolved statically by name plus scope, nearest ancestor), so it sorts topologically like a cable. That avoids legacy's frame-order dependence.

---

## 11. JavaScript patch (VERIFIED, [Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics), [JS API](https://origami.design/documentation/concepts/scriptingapi))

### 11.1 Runtime and loading

- "Origami can now directly run JavaScript (ES6*) via its **Hermes** runtime."
- Add a patch by dragging a `.js` file into the patch graph, or via the Patch Picker.
- The script body is loaded as an IIFE and must `return patch;`. "Origami uses IIFE as a mechanism to load the Patch. That's why returning the patch at the end is very important." **Not** `module.exports`.
- No modules or imports; no browser APIs (DOM, BOM, WebWorkers, WebStorage, Canvas, alert).
- Editing: "Open in default editor". Origami must stay open; the temp file is deleted when Origami closes.
- Ports are matched **by index**. Renaming or retyping a port keeps connections; reordering is effectively a rename; remove-then-re-add loses connections.
- v177 (09/30/2024): duplicating a JS patch **deep-copies** the script. The docs' "Duplicated JavaScript Patches point to the same file source" is **DOC-DRIFT** for new patches. Old patches keep the shared behavior; use components for shared scripts.

### 11.2 API

```js
var patch = new Patch();
patch.inputs  = [ new PatchInput("Input", types.NUMBER, 0) ];   // only at top level; not mutable during execution
patch.outputs = [ new PatchOutput("Output", types.NUMBER) ];
patch.alwaysNeedsToEvaluate = false;   // true → evaluate every frame
patch.loopAware = false;               // false → one JS environment copy per loop index
patch.variants = [types.STRING, types.NUMBER, types.POSITION, types.COLOR]; // type variance (≥2 types + a VARIANT port)
patch.evaluate = function () { patch.outputs[0].value = patch.inputs[0].value; };
return patch;
```

- `Patch.type`: read-only current runtime type (when variant). `Patch.variants`: supported types.
- `PatchInput(name, type, [defaultValue])`: `.name`, `.type`, `.value` (ro), `.values` (ro array; loop values when loopAware, else `[value]`), `.defaultValue`, `.isDirty()`, `.readRising()`, `.readFalling()`.
- `PatchOutput(name, type, [defaultValue])`: `.value`, `.values` (settable array for loop outputs when loopAware; element types must match), `.defaultValue`, `.pulse()` (PULSE type only).
- Omitted defaults use "the default default value for the type."
- `evaluate()` takes no arguments and returns nothing. It runs "any time at least one of the inputs changes", or every frame with `alwaysNeedsToEvaluate`.
- Variance: needs `patch.variants` (>1 type) **and** at least one port typed `types.VARIANT`. If only one condition holds: console warning, fallback to the first variant or NUMBER.
- `Image`: `new Image(arrayBuffer RGBA 0–255, width, height)`, `new Image(image, size)` (resize), `new Image(size)` (empty). `.width`, `.height`, `.format` ("JPG", "PNG", "GIF"…), `.getPixelAt(x,y)` → Color, `.setPixelAt(x,y,color)` (only on JS-created images; images from patches are read-only).
- `Http.request(method, url, opts?)` → Promise with `.cancel()` (rejects "Request cancelled").
  - opts: `headers`, `urlParameters`, `body` (string/object/ArrayBuffer), `contentType` ("json" | "formData"), `disableTimeout`, `responseType` ("raw" → ArrayBuffer, "image" → Image, omitted → HttpResponse), `onData` (streaming chunk callback; NDJSON auto-parsed).
  - Helpers: `Http.get`, `Http.post`, `Http.getJson`, `Http.postJson(url, data, opts)`.
  - `HttpResponse`: `.ok`, `.headers`, `.text()`, `.json()` (undefined on parse failure), `.arrayBuffer()`, all synchronous.
- `Base64.encode(string | ArrayBuffer | Image)` → Promise<string>; `Base64.decode(str, "text" | "arraybuffer" | "image")`.
- Timers: v215 (03/18/2026) "Support setTimeout, setInterval, clearTimeout, clearInterval." **DOC-DRIFT**: not in the API page.
- Console: `console.log`; `console.watch` (track variables across evaluation cycles); max **50** messages. Conversion warning: `WARNING: Could not convert a JavaScript value into an appropriate Origami type. Ignoring.`

### 11.3 State persistence and async (INFERRED + VERIFIED fragments)

- VERIFIED: the patch object and its closure live for the lifetime of the running prototype. The docs' async examples set `patch.outputs[i].value` inside Promise callbacks after `evaluate()` returned, so outputs can change **between** evaluations.
- INFERRED: top-level `var`s and closure variables persist across `evaluate()` calls (state). A prototype restart re-runs the script, resetting state. Non-loopAware patches get one environment per loop index, so state is per index.
- JS-related release notes:
  - v126 (10/17/2022) new JS patch released
  - v127 loopAware crash fix; double logging
  - v128 enum support
  - v146 Image types
  - v148 "Fix incorrect loop output evaluation on JS patches after a restart"
  - v99 "JavaScript patch multi-threading fix"
  - v211 WebP
  - v217 network + base64
  - v219 Variant
  - v221 (06/08/2026) "JavaScript Patch LLM generation Integration"
  - v227 "Fixed JS HTTP execution when looped"; "Increased token limit for JS Patch and Layer Shader when using Anthropic provider"

### 11.4 Math Expression patch (VERIFIED, [Math Expressions](https://origami.design/documentation/concepts/mathexpressions))

- Edit via Patch Info ⌘I.
- The patch's free variables become inputs. "Any expression that is valid in JavaScript can be used, but the inputs and outputs can only be numbers."
- Multiple outputs separated by `;`; outputs named with `name = expr`. Example: `quotient = a/b; remainder = a % b`.
- Invalid expressions are not saved and highlight red.
- v90 improved performance.

---

## 12. Docs vs release notes: consolidated drift list

| Topic | Docs say | Release notes say | Date |
|---|---|---|---|
| Frame rate | "usually 1/60th of a second" | 120 fps when available | v216, 03/30/2026 |
| Pulse retrigger | one frame on, must be off otherwise | pulses can fire on consecutive frames | v187, 02/18/2025 |
| Pop/Classic Animation types | "numeric value" | "support different data types like Position"; Size types | v72 09/24/2020; v91 06/16/2021 |
| Spring Animation types | Number | "supports other types like Point and Color" | v120, 07/25/2022 |
| Fluid Spring Animation | no page | new patch | v223, 07/07/2026 |
| Option Equals | docs page is "Legacy" | returns −1 when no match | v205, 10/27/2025 |
| Gradients | not a type in JS table | native type | v218, 04/27/2026 |
| JS timers | not documented | setTimeout/setInterval/clear* | v215, 03/18/2026 |
| JS duplicate | shares the file | deep copy on duplicate | v177, 09/30/2024 |
| Wireless naming | Patch Organization: "Wireless Broadcaster W / Receiver ⇧W" | Variables page: renamed Variable Broadcaster/Receiver | (docs) |
| Component loop default | changed in v82 (docs) | v82 notes silent; v80 "Loops of Loops" | 02/2021 |
| Scroll Settings | no Deceleration Rate | "Added Deceleration Rate to Scroll Settings" | v104, 12/20/2021 |
| Smooth Value | rising + falling hysteresis (docs updated) | separate rising/falling | v204, 10/13/2025 |
| Loop Filter/Select | slug `loop.select` = "Loop Filter" | renames not in notes | n/a |
| Wait | "outputting a pulse" | output doc says boolean | (docs internal inconsistency) |
| Touch propagation | shared with parent groups | v113 improved hit test | legacy plugin was deepest-only |
| JSON naming | "JSON to Text" | renamed from "Text from JSON"; added "Text to JSON" | v207, 11/25/2025 |
| File compatibility | none | v204: last version to open pre-Oct-2023 files, upgrades to internal file version **129**; v205 cannot open ~2-year-old files | 10/2025 |
| File to JSON | none | "CLI to convert Origami file to JSON", "Copy-Paste As JSON" | v221, 06/08/2026 |
| Wave patch | not found | not found | no primary evidence it exists in Studio |

---

## 13. Consolidated runtime spec proposal (INFERRED; for our engine)

```
Graph:
  Node { id, kind, typeParam (variance), inputs[Port], outputs[Port], state (per instancePath × loopIndex) }
  Port { name, type, default, min?, max?, loopBehavior? (component inputs), value: Value | Loop<Value> }
  Edge { from (node, outPort), to (node, inPort) }  // ≤1 edge per input; variables compile to edges

Value types:
  Number(f64) Integer Index Progress Boolean Pulse Enum(int) Text Color(rgba 0..1) Position/Size/Anchor(vec2)
  Point3D Point4D Edges CornerRadius Transform Gradient JSON Image Video Sound RawData Layer(ref) Settings(opaque)
  Loop<T> wraps any T (flat; loops of loops only via components)

Tick(frameTime t, dt):
  dtPhysics = min(dt, 0.064)
  collect inputs → evaluate nodes in topo order (back-edges read previous frame)
  node evaluates if: any input dirty || alwaysEvaluate || pulse input fired
  loops: len = max(len(loop inputs)); scalars broadcast; shorter loops wrap (index mod len)   // confirm
  pulses: output pulse bit set this frame only; pulse input fires on upstream pulse OR bool rising edge
  layers: instances = max loop length over bound properties
  end frame: clear pulse bits

Springs: Rebound RK4 (§7.5), k/c from BouncyConversion + OrigamiValueConverter (§7.2–7.3), mass 1
Classic: tween(current→target, Duration, Penner curve) restarted on target change
Transition: start + p·(end − start) component-wise (colors in RGBA)
Progress: (v − s)/(e − s), guard e == s → divide by 0.0001
Delay: time-stamped queue; Style gates increasing/decreasing numeric changes
Smooth Value: out = prev·h + cur·(1 − h) (consider dt-compensation)
Hit test: front-to-back, enabled && opacity > 0, bubbling to ancestors, tap slop ≈10pt
```

---

## 14. Open questions (need in-app verification)

1. The exact **loop-length mismatch rule** (max + wrap vs min vs pad with last/default). Docs only say "zipper."
2. **Classic Animation retarget** behavior: restart from current value with full duration, remaining-time scaling, or velocity blending?
3. **Spring Animation Tension/Friction units**: raw k/c, or QC/Origami-scaled like Bouncy Converter's inputs? Default values?
4. Bouncy Converter outputs: QC-scale or physical? (Legacy output was physical POP units.)
5. **Arc Transition** formula (quadratic through Middle at p = 0.5, or piecewise).
6. **Repeating Animation** mirrored: curve applied per leg vs mirrored curve; Enable=false holds or resets?
7. Same-frame precedence of Switch Flip / Turn On / Turn Off, and of Counter Increase + Decrease + Jump.
8. **Cycle semantics**: does every back-edge add exactly one frame of latency? Are self-loops rejected?
9. Implicit coercion matrix details (Number → Position broadcast? Vector → Number?).
10. Color interpolation space for Transition/Pop/Classic on Color (RGB, linear RGB, or HSL).
11. Whether unconnected, sink-less patches are evaluated (laziness) in Studio.
12. Rest thresholds Origami Studio uses for Pop springs (legacy POP 0.001 property threshold; rebound-js 0.001; Java 0.005).
13. Fluid Spring Animation patch ports and formula (v223).
14. Whether Smooth Value / Delay are frame-count-dependent at 120 fps (v216).
15. The internal file format (version 129 era) and the JSON produced by the v221 CLI. Useful for importer compatibility.

---

## 15. Source index (primary)

- Origami Studio release notes: https://origami.design/releases/ (v72 09/24/2020 → v228 09/07/2026)
- Docs index: https://origami.design/documentation/
- Concepts: [Loops](https://origami.design/documentation/concepts/loops), [States & Pulses](https://origami.design/documentation/concepts/pulsesignal), [JavaScript Patch API](https://origami.design/documentation/concepts/scriptingapi), [Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics), [Coordinates](https://origami.design/documentation/concepts/coordinates), [Math Expressions](https://origami.design/documentation/concepts/mathexpressions), [Variables](https://origami.design/documentation/concepts/variables)
- Patch editor: [Patches](https://origami.design/documentation/patch-editor/patches), [Interactions](https://origami.design/documentation/patch-editor/interactions), [States](https://origami.design/documentation/patch-editor/states), [Animations](https://origami.design/documentation/patch-editor/animations)
- Workflow: [Components](https://origami.design/documentation/workflow/components), [Patch Organization](https://origami.design/documentation/workflow/patchorganization)
- Patch pages: `https://origami.design/documentation/patches/<slug>` for bouncy, bouncyconverter, springanimation, springconverter, classicanimation, cubicanimation, cubicbezier, curve, transition, progress, repeatingmotion, smoothvalue, pulse, pulseonchange, pulseonstart, repeatingpulse, switch, counter, delay, delay1, indexswitch, multiplexer, demultiplexer, optionequals, loop, loop.builder, loop.select, loop.selectreorder, loop.count, loop.any, loop.sum, loop.fromarray, loop.toarray, loop.mutations.*, sample, splitter, random, waittimer, stopwatch, time, layer.interaction, layer.gesture, layer.hover, layer.scroll, layer.scroll.settings, mouse, keyboard, trackpad, touches, wirelessbroadcaster, wirelessreceiver, javascript, javascript.expression, structure.*, logic.*, compare.* (builtin.*) and hitarea, drag, drag-settings, longpress, doubletap, velocity, popswitch, arctransition, reverseprogress, loopsum, loopoptionswitch (origami.*)
- Tutorials: [Coming From Code](https://origami.design/tutorials/getting-started/coming-from-code), [Introduction to Loops](https://origami.design/tutorials/smarter-interactions/introduction-to-loops), [Interactive Loops](https://origami.design/tutorials/smarter-interactions/interactive-loops)
- Rebound (Java): https://github.com/facebook/rebound: `BouncyConversion.java`, `OrigamiValueConverter.java`, `SpringConfig.java`, `Spring.java`
- rebound-js: https://github.com/facebookarchive/rebound-js/tree/master/src: `BouncyConversion.js`, `OrigamiValueConverter.js`, `SpringConfig.js`, `Spring.js`, `SpringSystem.js`, `MathUtil.js`
- POP: https://github.com/facebook/pop/tree/master/pop: `POPAnimationExtras.mm`, `POPAnimationPrivate.h`, `POPMath.mm`, `POPSpringSolver.h`, `POPSpringAnimationInternal.h`, `POPSpringAnimation.h`
- Origami for Quartz Composer (archived): https://github.com/facebookarchive/origami: `Origami Plugin/POPBouncyPatch.mm`, `POPConverterPatch.m`, `POPDecayPatch.mm`, `FBOProgressPatch.m`, `FBODelayPatch.m`, `FBOMultiSwitchPatch.m`, `FBOInteractionPatch.m`, `FBOInteractionController.m`, `FBWirelessInPatch.m`, `FBWirelessOutPatch.m`, `FBLastValue.m`, `English.lproj/FBOInteractionPatch.xml`, `Code Export/*.js`. Compositions: `Origami/Transition.qtz`, `Progress.qtz`, `Switch.qtz`, `Classic Animation.qtz`, `Pop Animation.qtz`, `Bouncy Animation.qtz`, `Repeating Pulse.qtz`, `Velocity.qtz`, `Counter 2.qtz`, `Color Transition.qtz`, `Swipe.qtz`, `Hit Area.qtz`, `Long Press.qtz`
- Apple QC: [Basics of Custom Patches](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/QuartzComposer_Patch_PlugIn_ProgGuide/plugin_1/plugin_1.html), [Writing Consumer Patches](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/QuartzComposer_Patch_PlugIn_ProgGuide/WritingConsumerPatches/WritingConsumerPatches.html), [QC Basic Concepts](https://leopard-adc.pepas.com/documentation/GraphicsImaging/Conceptual/QuartzComposerUserGuide/qc_concepts/qc_concepts.html), [QC Glossary](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/QuartzComposerUserGuide/qc_glossary/qc_glossary.html)
- SwiftUI spring: Apple DocC `Spring.init(response:dampingRatio:)`; [Apple forums 739811](https://developer.apple.com/forums/thread/739811)
- Easing equations (BSD): https://github.com/gdsmith/jquery.easing/blob/master/jquery.easing.js
