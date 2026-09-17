# Gap-Fill Report (Completeness Critic)

> **Note on published material:** this report was written against internal research inputs (a raw patch census, per-patch batch specs, and a verbatim copy of the release notes). Those raw files quote third-party documentation and are not included in the public repository. The patch catalog in `packages/patches/catalog/` supersedes them, and the release notes are at https://origami.design/releases/.


Research date: 2026-09-16. Latest Origami Studio release: **Version 228 (09/07/2026)** ([release notes](https://origami.design/releases/)).

Scope: I read every report in `research/` (semantics, release-notes, releases_verbatim, ui-controls, file-format-interop, learning-painpoints, ai-native-design-tools, claude-byo, stack-prior-art, blender-nodes) and the patch census (`patches/report.md`, `index.json`). I also audited all 257 entries in `patches/batch-01..19.json` by script: names, categories, port counts, confidence and loop notes.

For each gap, contradiction and unverified claim I found, I researched it and wrote the result below. New patch entries are in `patches/gap-fill.json`.

Legend: **VERIFIED** = seen in a primary source during this pass (URL, file or source path given). **INFERRED** = my reasoning. **CORRECTION** = an existing report is wrong or stale and this is the fix.

---

## 0. Method and limits of this pass

- **Web search was not available.** The session's WebSearch budget (200 calls) was used up by the earlier research agents. Every fill below therefore comes from **direct primary-source fetches**:
  - `curl` of origami.design pages and `sitemap.xml`
  - raw GitHub source (`facebookarchive/origami`, `facebook/pop`)
  - the GitHub REST API (`gh api search/*`)
  - Apple DocC JSON (`developer.apple.com/tutorials/data/...`)
  - the official Origami YouTube RSS feed
  - **string-level inspection of official `.origami` sample files**
- **Sample-file inspection.** The batch researchers had already downloaded 127 official pattern, example and tutorial files into `patches/raw*`. Most were re-saved by Meta with Origami build **203.0 (799429869)**, 2025-09-30.
  - I also found two **third-party files saved by Origami 212.0 and 214.0 (Feb–Mar 2026)** at [github.com/tejas-scapia/origami](https://github.com/tejas-scapia/origami).
  - Current `.origami` graphs are FlatBuffers-style binaries (file identifier `ORGM`), so no schema is available. I only extracted **printable strings**: patch identifiers, port names, enum options, library metadata keys and **comments Meta's designers wrote inside the files**.
  - Port order was read from string order (the ports of a patch appear in reverse order next to its identifier), so it is medium confidence.
  - No code or assets were copied. Files stayed in the scratchpad.
- **Legacy source.** Where Studio behavior can't be observed, I used the archived Origami-for-Quartz-Composer macros (`src/qtz/*.qtz`, parsed with `plistlib`) and plugin source. These are ancestors, not proof of current behavior, and are marked "legacy VERIFIED, current INFERRED".
- **Not done:** installing Origami. Many remaining gaps can only be closed in the app. §6 gives a concrete checklist for someone who has it.

---

## 1. Executive summary: what changed

1. **Six factual errors or stale port lists in the existing reports** (§3, which lists 18 corrections in total):
   - The "Bottom HUD" notes are v201 only. release-notes.md claims v201 repeats v107's bullets, and the v107 notes contain no such bullets.
   - Origami Pasteboard corner smoothing is **v180**, not v177.
   - Mouse outputs, Momentum Scrolling inputs and Spring Converter outputs are stale doc port lists in semantics.md and ui-controls.md.
   - The iOS Visual Effect component has been rebuilt as a "material" component.
2. **First real identifier for a Layer Effect patch.** `builtin.blurLayerEffect` ("Blur Effect", library category **"Layer Effects"**, aliases filter/effect/layer/blur) has input **Radius** and output **Layer Effect**. It connects to a layer's **Effects** port in the **Filters** inspector category. VERIFIED in a v214-saved file. Until now the catalog had only an inferred "family".
3. **Six undocumented built-in patches or layers** found in official files and added to `gap-fill.json`:
   - **Haptic Player** (`builtin.hapticPlayer`, with macOS types)
   - **Keyboard Info** (`builtin.keyboard.info`)
   - **Facebook Login** (`builtin.facebook.login`)
   - **Data File** (`builtin.dataFile`)
   - **Text Input** native layer (`builtin.layer.textInput`)
   - **Soft Nav** Material component (`material.SoftNav`)

   Current port sets for **Spring Converter** (it also outputs **Mass**) and **Visual Effect (iOS)** are added as updates.
4. **Runtime semantics stated by Meta itself** in comments inside official pattern files. None of these were in semantics.md:
   - **Frame-0 quirk:** "at Frame 0 Origami hasn't yet loaded any values from the patch editor. Instead Origami will return a patch's default value at Frame 0 and the input value at Frame 1", which makes Velocity spike for one frame on restart.
   - **Layer Info lags one frame:** "Layer Info has a 1 frame delay".
   - **Tap arrives after position resets:** "tap events happens when touch stops. BUT when touch stops, position is zero", so a Delay 1 is needed to read where a tap landed.
   - **A loop recursion limit exists:** "…will cause recursion that ultimately hits the loop limit".
   - **Delay styles confirmed:** "When Increasing" returns true only if Value stays true for the whole Duration. "When Decreasing" outputs true immediately and holds it for the Duration.
   - **Momentum Scrolling defaults:** "Momentum Scroll defaults to the End Bounds, which by default are 99999".
   - **Feedback loops use Delay 1:** "Delay 1 returns the value from the previous frame".
5. **Legacy formulas filled in:**
   - **Long Press** = `Delay[When Increasing](touchHeld AND touchStationary, Duration)`. Movement cancels it. VERIFIED legacy wiring.
   - **Wait/Timer** "Done" is a **latched boolean**: true on completion, false again once the timer restarts. That supports the doc's boolean port over its "outputs a pulse" summary.
   - **Stopwatch** accumulates while on and pauses rather than resets.
   - **POP decay** (momentum) closed-form math with default deceleration **0.998**.
   - **Mouse scroll** velocity and "Down" synthesis heuristics.
6. **Identifier normalization.** Doc URL slugs are lowercase and contain typos (`builtin.momemtumscrolling`). Serialized identifiers are camelCase (`builtin.momentumScrolling`, `builtin.pulseOnStart`, `builtin.loop.selectReorder`). Mapping to display names is not obvious: `builtin.range` = Clip, `builtin.layer.size` = Layer Info, `builtin.textsubstring` = Trim Text. An importer must normalize case and keep an alias table. file-format-interop.md's "map via doc URL names" advice needs this refinement.
7. **Learnability evidence.**
   - The **official Origami YouTube channel's newest video is 2020-11-03**. Its RSS feed holds 15 videos, all posted Oct–Nov 2020. VERIFIED.
   - Community repos build what the built-ins lack: debug panels, Ticker, Snap-to-points, Animate-once, Timed switch, custom spring presets named Bouncy/Organic/Smooth/No Bounce, frame-accurate elapsed time, and a damped gyro. That shows unmet demand.
8. **No Origami MCP server or Origami-JSON parser exists on GitHub.** Searches for "origami mcp", "origami studio", and code search for `"builtin.bouncy"` / `"builtin.layer.binding"` found none. The AI-native niche is still open. (GitHub code search has index limits, so this is a strong but not absolute negative.)

---

## 2. Coverage audit of the research corpus

| Domain | State | Biggest remaining holes |
|---|---|---|
| Runtime semantics (semantics.md) | Strong on pulses, springs (exact Rebound/POP math), Transition/Progress, Delay legacy and the JS API. | Loop-length mismatch rule; Classic Animation retargeting; same-frame precedence (Switch, Counter); cycle latency; laziness; color interpolation space. **The frame-0 quirk and Layer Info delay were missing** (now filled, §4.1). |
| Spring formulas | Complete for Pop (Bounciness/Speed → k/c) and Rebound RK4; SwiftUI mapping derived. | Units and defaults of Spring Animation Tension/Friction; Fluid Spring Animation ports. Decay/momentum math was missing (now filled, §4.2.4). |
| Patch catalog (257 entries) | Every census entry has a batch spec (checked by script; the only duplicate name is "Oval", as both a shape and a layer). | Undocumented built-ins found in files (now filled, §4.3); release-notes-only patches (Bluetooth LE, Hand Detection, Text To Speech, Variable Font builder, Fluid Spring, Liquid Glass, Reflective Layer) still have inferred ports. |
| Port details | Doc port lists plus v203 file strings for layers. | Numeric **defaults** for most patches are unrecoverable without decoding the binary schema. Many are marked "INFERRED". |
| Layer property lists | Good: batch-15/16 list the undocumented inspector sections (Basics, Content, Layout, Stroke, Shadow, Transform, Filters) from file strings. | Liquid Glass, Reflective Layer, "3D groups", and Layer Effects beyond Blur. |
| UI and shortcuts (ui-controls.md) | Very thorough compendium with conflict table. | Canvas tool keys; view-mode toolbar; ⌘⇧A select vs deselect; whether the Layer List "Touch" button still exists after v148. |
| Learnability (learning-painpoints.md) | Excellent. | Now confirmed: no new official video tutorials since 2020. |
| AI/MCP (ai-native, claude-byo) | Strong; spec 2026-07-28 and policy wording are verified. | Origami's own LLM feature UI and provider list remain unknown. |
| Stack (stack-prior-art.md) | Strong. | Decision note: Electron 44 requires **macOS 13+**, while Origami supports **macOS 12+** (v177). A small parity gap to accept knowingly. |
| File format | Container VERIFIED; YAML legacy schema; binary FlatBuffers-like. | CLI name and JSON schema (v221). New: the per-patch library metadata keys (§4.4) and observed build strings 212.0/214.0. |

---

## 3. Contradictions and errors in existing reports (with corrections)

| # | Report / location | Claim | Evidence | Correction |
|---|---|---|---|---|
| C1 | release-notes.md §2 (v201 row) and §4.3; ui-controls.md §4.4 "(v107/v201)"; release-notes.md §3.1 | "v201 repeats v107's bullets word for word" (Bottom HUD, Enum tooltip) | `releases_verbatim.md` Version 107 (01/27/2022) lists: Audio Metering for videos, Snippets, duplicate ports, JSON previews; Fixes: recordings, snapshot, video playback, loop inspector previews, inconsistent frame rate. **No Bottom HUD, no Enum tooltip.** VERIFIED | **CORRECTION:** Bottom HUD (consoles, asset manager, loop counts, performance gauge, FPS counter) and the Enum index tooltip are **v201 (09/02/2025) only**. v107 has "Origami no longer runs at an inconsistent frame rate on slower displays". That is probably where the mix-up came from. |
| C2 | file-format-interop.md §2.1 | "v177 (09/30/2024): Origami Pasteboard now supports corner smoothing from Figma." | Verbatim: under **Version 180 — 11/11/2024** Features: "Origami Pasteboard now supports corner smoothing from Figma." VERIFIED | **CORRECTION:** v180. (ui-controls.md already had v180.) |
| C3 | semantics.md §7.11; learning-painpoints §5.5 | Momentum Scrolling has 5 inputs (doc) | v203 and **v212/214** files: `Momentum Scrolling Engine` / `builtin.momentumScrolling` with ports Sample Value, Value, Scrolling Friction, Rubber Band Friction, Start Boundary, End Boundary, Rubber Band Tension, Stick To Boundaries. Meta comment: "Momentum Scroll defaults to the End Bounds, which by default are 99999". VERIFIED | **CORRECTION:** 8 inputs. In-app title "**Momentum Scrolling Engine**". End Boundary default 99999. batch-06 already had the 8 ports; semantics.md is stale. |
| C4 | semantics.md §8.2; ui-controls.md §22 | Mouse → Down, Location | batch-06 file strings: Left, Right, Middle, Position, Scroll Velocity (matches v74 right-click, v80 scrolling, v199). VERIFIED | **CORRECTION:** use the file port set. |
| C5 | semantics.md §7.7; batch-01 Spring Converter | Outputs Tension, Friction, Bounciness, Speed | v214 file: `Spring Converter` / `builtin.springConverter` with ports Response, Damping Fraction, **Mass**, Tension, Friction, **"Bouciness"** (typo in app), Speed. VERIFIED ([tejas-scapia/origami](https://github.com/tejas-scapia/origami) `spring playground.origami`, saved by 214.0) | **CORRECTION:** add a **Mass** output (INFERRED = 1, matching the legacy POPConverterPatch mass output). Keep our label spelled correctly, but accept "Bouciness" on import. |
| C6 | batch-19 Visual Effect (iOS) | Inputs Enable, Opacity, Style (light / very light / dark) | v203 and v214 files: `ios.VisualEffect` about text "iOS-style background material, with support for thick, regular, thin & ultra thin materials, as well as light & dark appearances"; ports **Material** (Ultra thin, Thin, Regular, Thick, Ultra thick; "Material thickness determines the color tint and amount of blur applied to layers below"), **Fade** ("Fades the material effect. Use this to transition to no material"), **Appearance** (Default, Light, Dark; "Sets light and dark mode"). Built from a private layer `private.layer.blur` "Blur Effect" (Enable, Blur Radius, Blur Scale, Saturation, Opacity) plus a Color Fill. Meta comment: "The best we can do with these settings is guess. Some of the settings for these materials were taken from Apple's Design Resources sketch files…". VERIFIED | **CORRECTION:** doc page stale; see the gap-fill.json entry "Visual Effect (iOS) – current material port set". |
| C7 | batch-06 Long Press | "Cancelling on movement is not documented" | Legacy `Long Press.qtz` wiring (§4.2.1): the output is Delay(When Increasing) of (Drag AND x equals start-x AND y equals start-y, tolerance splitter default 0). VERIFIED legacy | Legacy long press **cancels on any movement**. Studio behavior INFERRED same. Our spec should add a small slop (about 10 pt, like the Interaction tap tolerance). |
| C8 | batch-14 Wait; semantics.md §5.6 | Output is a boolean vs "outputting a pulse" (doc conflict) | Legacy `Timer.qtz` (Turn On, Duration → Time, Done): `cond = Clock.time ≥ Duration` stops and resets the clock. **Done = SampleHold(value = Pulse[leading](cond), sampling = Clock.time OR that pulse)**. While running, Done samples false. On completion it samples true. After the reset, time = 0 and sampling stops, so Done **holds true** until the next Turn On restarts the clock. VERIFIED legacy wiring; QC op codes (test 4 = ≥, op 1 = OR, mode 0 = leading edge) INFERRED | Supports the doc's **boolean port** ("true when the wait is finished"): a latched completion state that clears on restart. For pulse inputs, the off-to-on edge infers a pulse, so the summary's "outputting a pulse" also holds. Spec: latched boolean (R7). |
| C9 | batch-13 Stopwatch | Pause/resume semantics INFERRED | Legacy `FBStopWatchPatch.m` ("Stop Watch 2", Brandon Walkin): per-iteration dictionaries; `timeCount += time - previousFrameTime` only while On stays true, not on the frame On changes; reset on the rising edge of Reset; outputs Time and Frames. VERIFIED legacy | Supports **Stop = pause, Start = resume, Reset = 0**. Also shows per-loop-index state. |
| C10 | semantics.md §3.1–3.2 | Evaluation algorithm lacks initialization detail | Meta comment in ~91 official files: "at Frame 0 Origami hasn't yet loaded any values from the patch editor. Instead Origami will return a patch's default value at Frame 0 and the input value at Frame 1. This causes Velocity to return the entire value…" VERIFIED | **ADD** to the runtime spec (§5, decision R1). |
| C11 | semantics.md §3.1 | "A patch's output cannot connect to its own input" (INFERRED-weak) | Still unverified. But Meta's Feedback pattern (`Logic_Feedback.origami`) and ~88 other files close feedback loops with **Delay 1**, commented "Delay 1 returns the value from the previous frame" and "Add velocity to previous position". VERIFIED idiom | Recommend: allow cycles, but make **Delay 1** the explicit, documented cycle breaker. Warn on a zero-latency self-edge. |
| C12 | ui-controls.md §1, §14.1, §28 P0 #5 | The Layer List "**Touch button**" is VERIFIED P0 | Sources are the Getting Started / Scrolling tutorials (2016–2020 era) and the docs intro. v148 (08/21/2023): "Removed quick interactions from Canvas.." VERIFIED | **UNVERIFIED for v228.** The docs intro still describes it, but whether the Layer List Touch button survived v148 is unknown (v148 names only Canvas). Keep the pattern for our product; mark its Origami status as "docs say yes, current app unconfirmed". |
| C13 | batch-12 Layer Info | Outputs Enabled, Size, Scale, Anchor, Parent | v212 file: `Layer Info` / `builtin.layer.size` ports Layer, Enabled, **Position**, Size, Scale, Anchor, Parent. Meta comments: "the only way to get the actual pixel dimensions of a layer who's size is set to Auto or Grow is with Layer Info" and "Layer Info has a 1 frame delay". VERIFIED | **ADD** a Position output and the one-frame latency. |
| C14 | batch-04 Haptic | "(AHAP file - name unknown)" | v203/v214 files: native `Haptic Player` ports Type, Play, **AHAP**; the `origami.HapticiOS` component ("Haptic iOS") publishes Play, Type, **File**. VERIFIED | Port names filled; see gap-fill.json "Haptic Player". |
| C15 | file-format-interop.md §6.1 step 4 | Map patch types via documentation URL names | Serialized identifiers are camelCase and differ from doc slugs: `builtin.momentumScrolling` vs doc slug `builtin.momemtumscrolling` (typo); `builtin.pulseOnStart` vs `builtin.pulseonstart`; `builtin.layer.textInput.info`; `builtin.loop.selectReorder`; `builtin.wirelessBroadcaster`. VERIFIED | **REFINE:** normalize case, add an alias table for typos and legacy ids (census `legacy_doc_ids` plus these). |
| C16 | stack-prior-art.md §1.1 vs ui-controls.md §2 | (implicit) | Electron 44 drops macOS 12. Origami minimum is macOS 12 (v177). VERIFIED both | Decision note, not an error: we'd start at macOS 13+. |
| C17 | learning-painpoints §3.8 Recipe B | "A velocity check would need a derivative patch (not verified)" | The Velocity patch exists (`origami.Velocity`, doc `origami.velocity`) and is used in ~91 official files for exactly this, with a restart exception for the frame-0 quirk. VERIFIED | Resolved: Velocity = current − previous frame. Handle frame 0 as Meta does (use the current value as "previous" at frame 0). |
| C18 | semantics.md §8.2 Double Tap | Single Tap after Delay: INFERRED | Meta's `Interaction_Touch` pattern comments: "this counter patch returns how many taps it receives during the Duration, and then resets to zero afterward"; "Pulse sends a pulse from Turned Off when the Duration after the initial tap has elapsed"; "Option Sender … send the Pulse … to Option 0 when there has been one single tap during the Duration, and … to Double Tap if there have been multiple taps"; "Delay set to When Decreasing makes this patch return 'True' for the Duration when a tap even[t] is received". VERIFIED (pattern build) | Supports: the Single Tap pulse fires **when the Delay window after the first tap ends** with count = 1. Double Tap in the pattern also fires at window end. The built-in patch may fire Double Tap immediately on the second tap (unverified). |

---

## 4. Gap fills (new facts)

### 4.1 Evaluation semantics from Meta-authored comments in official files (VERIFIED)

Comment text found in the official pattern and example files (bracketed number = how many sample files contain it):

1. **Frame-0 default values** [91 files]: "A quirk of Origami is that at Frame 0 Origami hasn't yet loaded any values from the patch editor. Instead Origami will return a patch's default value at Frame 0 and the input value at Frame 1. This causes Velocity to return the entire value as its output making it jump for one frame, even if seemingly nothing has changed about the incoming value. So this exception portion switches out the previous frame value at Frame 0 with the value for the current."
   - Implication: in Origami, prototype start is a **two-phase warm-up**. Our engine should evaluate the graph with authored inputs at frame 0 (fixing the quirk), and make every "previous frame" patch (Velocity, Delay 1, Pulse on Change) seed its history from the first evaluated value. v188's "Fix bug on pulse on change on first evaluation" is consistent with this.
2. **Layer Info lags one frame**: "Since we use Layer Info to convert Set Progress value to a position and Layer Info has a 1 frame delay we need a Delay 1 patch so we can get the correct position. So we set it on the second frame."
   - Layout results feed back into the patch graph **on the next frame**. Engine order is patch evaluation, then layout, then layer outputs readable next frame.
3. **Tap timing vs position**: "We need the tap pulse to register the touch position. You have to Delay 1 here, because tap events happens when touch stops. BUT when touch stops, position is zero."
   - Interaction **Position resets to 0 on touch-up**, in the same frame Tap fires. Our spec could keep last-touch position on the Tap frame. That would be a deliberate, documented deviation.
4. **Loop recursion limit**: "…If the inputs are set to Loop the Component and the output is set to the same layer this will cause recursion that ultimately hits the loop limit."
   - A maximum loop size or recursion depth exists. The value is unknown (§6). Our engine needs a cap plus a visible error.
5. **Delay styles**:
   - "Because Delay Style is set to 'When Increasing' delay will only return true if Value is 'true' for the entire Delay Duration."
   - "When Delay is set to 'When Decreasing' it means that it will output true immediately when it receives a pulse, but it will hold that true output for the duration."
   - This confirms semantics.md's legacy suppression model.
6. **Momentum Scrolling defaults**: "Ensure you start at the start position (Momentum Scroll defaults to the End Bounds, which by default are 99999)."
7. **Feedback**: "Delay 1 returns the value from the previous frame"; "Prevent jumping - Delay down by inperceptible one frame so the distance between previous touch down and this touch down isnt factored into velocity"; "Prevent flick/sliding - Reset remaining velocity on touch up"; "How much does velocity contribute to which edge will be sticking to" (inside the iOS Screen edge-swipe component).
8. **Pulses in loops**: "Because Pulse events are momentary we use a sample and hold patch to save the index value of the Pulsed item when any of the looped items receives a Pulse"; "Any will return a single true if any one of the looped items receives a pulse"; "When a value of true is passed to Include, Loop Filter will send only the value for the True index."
9. **Text Field internals**: "The text input Layer is used for keyboard input only. We render the text with another dedicated Text Layer"; "Not sure why this Delay 1 is necessary. But clear won't reset the text input unless its here". A known one-frame quirk on Set Text clear.
10. **Clip during drag**: "Clipping - prevent disconnected drag when over-dragging the bounds by storing the unclipped value during a single drag action until the next drag action starts."

### 4.2 Legacy formulas and wiring (legacy VERIFIED; current Studio INFERRED)

#### 4.2.1 Long Press (`src/qtz/Long Press.qtz`)

- Published inputs: `Enable` (to Interaction Enable), `Duration`. Outputs: `Press`, `Interaction`.
- Wiring, from the parsed connection list:
  ```
  drag = Interaction.Drag                         // held since touch-down on layer
  x0,y0 = SampleHold(touch x,y) sampled on leading edge of drag (Pulse mode 0)
  x,y   = SampleHold(touch x,y) sampling while drag
  stationary = Conditional(x0 == x, tol) AND Conditional(y0 == y, tol)   // tol splitter unset → 0
  Press = FBODelay[style 1 = Delay Increasing](stationary AND drag, Duration)
  reset x0/y0 on trailing edge of drag OR trailing edge of stationary
  ```
- Result: Press becomes true after the touch stays held **and stationary** for Duration. It turns false immediately on release or movement, because When Increasing passes falls straight through.
- Default Duration: 0.2 s per semantics.md (legacy macro). Studio doc default is 0.5 s. VERIFIED doc.

#### 4.2.2 Wait / Timer (`src/qtz/Timer.qtz`)

- Inputs `Turn On` (Pulse, leading edge), `Duration`. Outputs `Time` (published directly from QC Clock) and `Done`.
- `start = Pulse[leading](TurnOn) AND Duration` (Logic op 0), which starts QC Clock.
- `cond = Conditional[test 4](Clock.time, Duration)` (INFERRED ≥). `cond` drives the Clock **Stop** and **Reset** signals.
- `Done = SampleHold(sampleValue = Pulse[leading](cond), sampling = Clock.time OR Pulse[leading](cond))` (Logic op 1, INFERRED OR).
- Resulting behavior:
  - false while counting,
  - true on the completion frame,
  - **latched true** afterwards (sampling is off once time resets to 0),
  - false again as soon as a new Turn On restarts the clock.
- Takeaway: a latched completion boolean, consistent with the current Wait doc's output description.

#### 4.2.3 Stopwatch (`FBStopWatchPatch.m`, "Stop Watch 2")

- Processor with TimeBase time mode. Keeps per-iteration dictionaries for time, frames, previous On and previous Reset.
- `shouldReset = Reset && Reset changed this frame` (rising edge).
- If `(On && On unchanged) || shouldReset`: `frames = reset ? 0 : frames + 1`, `time = reset ? 0 : time + (t − tPrev)`.
- Outputs `Time` (seconds) and `Frames` (index).
- Takeaways: time does **not** accrue on the frame On toggles; state is per loop index.

#### 4.2.4 Decay / momentum (`POPDecayPatch.mm` + `pop/POPDecayAnimationInternal.h`)

- Legacy patch "Pop Decay Engine": inputs Start Value, Velocity, **Deceleration** (min 0, max 1, **default 0.998**), Start Animating Signal. Output Value. Per-iteration state. Property threshold 0.001. VERIFIED.
- POP decay integration, per axis, with `dt` in seconds and velocity in units/second (VERIFIED `decay_position`):
  ```
  kv = d^(1000·dt)
  v' = v · kv
  x' = x + (v/1000) · d · (1 − kv) / (1 − d)
  done when |v| < threshold · 5   (kPOPAnimationDecayMinimalVelocityFactor = 5)
  duration = max over axes of  ln( (threshold·5/1000) / (v/1000) ) / (ln(d)·1000)
  final position (dt→∞): x∞ = x + (v/1000) · d / (1 − d)
  ```
- Studio's Scroll Settings **Deceleration Rate** enum is **Normal | Fast** (VERIFIED file strings, v104). Apple's `UIScrollView.DecelerationRate` has `.normal` "The default deceleration rate for a scroll view" and `.fast` (VERIFIED DocC JSON; numeric values not shown). INFERRED mapping: Normal ≈ 0.998 per ms (the POP default), Fast ≈ 0.99 per ms (UIKit's well-known constants).
- Drag Settings `Momentum Friction` (0–950) has no verified mapping. INFERRED candidate: `d = 1 − (friction/1000)·k`. Verify in the app (§6).

#### 4.2.5 Mouse scroll (`FBOMouseScrollPatch.m`)

- Provider patch. On `NSScrollWheel`: `XVelocity = scrollingDeltaX`, `YVelocity = −scrollingDeltaY`.
- `Down = phase ∈ {Began, Changed, MayBegin}`.
- When momentum ends, it synthesizes a one-frame `Down = true` so interrupted decelerations are handled.
- "Potential stop" heuristic: if the phase is Changed and |delta| ∈ {1, 2} with no momentum, the next event-less frame zeroes velocity.
- Useful for the modern Mouse `Scroll Velocity` output and trackpad-driven scroll. Current behavior INFERRED.

#### 4.2.6 Legacy scroll internals (names only; v203 `Horizontal-Scrolling-(Completed).origami`, component `origami.LegacyScroll`)

Sub-patch names that describe the algorithm (VERIFIED names):
- `TouchVelocity`
- `Holdthepreviousvelocityforaframeafterrelease`
- `PreventVelocityJumpfrom0onfirstframe`
- `Delay1Increasing`
- `GlobalFirstTouch`
- `DirectionLocking`
- `JumpSettings`, `PhysicsSettings`, `InputSettings`

Also TODO comments: "dont reset direction locking until scroll momentum stops" and "output 'is moving' from momentum scroll - requires lower level code changes".

Implication for our gesture-velocity estimator:
- hold the last velocity for one frame after release (touch-up frames often carry a zero delta),
- ignore the first-frame jump,
- lock direction per touch.

Drag, Pop Switch and the iOS Screen are **components built on Momentum Scrolling Engine**. Their internals include `origami.AddMomentum`, `origami.ClippedPosition`, `origami.ExtractMomentumSettings`, `origami.VelocityXY`, `origami.RoundtoScreenPixels`, `origami.2PagePaging`, `origami.PinchScale`, `origami.Two-FingerGesture`, `origami.SmoothVelocity`, `origami.Slip`, `ios.EdgeSwipe`, `ios.EdgeSwipeDetection`, `ios.StickyBoundaries` and `ios.Smoothvalueondragrelease` (VERIFIED names). That is strong evidence for a clean-room layering: **one momentum/rubber-band primitive**, with Drag, Pop Switch, Scroll and Screen edge-swipe built as compositions of it.

### 4.3 Undocumented built-ins and current port sets (VERIFIED from file strings)

Details, port lists and confidence are in `patches/gap-fill.json`.

| Identifier | Display name | Found in | Ports (string order → our reading) | Notes |
|---|---|---|---|---|
| `builtin.blurLayerEffect` | Blur Effect | v214 file | Radius → **Layer Effect** | Library category **"Layer Effects"**, aliases filter/effect/layer/blur. Connects to a layer's **Effects** port (Filters category). v217 added "Hard Edges" (port name unknown). |
| `builtin.hapticPlayer` | Haptic Player | v203 Level-Meter, WhatsApp-QR-Code, instagram-direct-messages; v212/214 utils | Type (Vibrate, Selection (iOS), Impact Light/Medium/Heavy (iOS), Notification Success/Warning/Error (iOS), Alignment (macOS), Level Change (macOS), Custom Pattern (iOS)), Play, AHAP | Native engine patch; the doc "Haptic" (`origami.haptic.ios`) and "Trackpad Haptic" are components over it. Library category Device. |
| `builtin.keyboard.info` | Keyboard Info | Utilities_Text_Input, Origami-Newsletter, Text-Input-(Completed) | Type (keyboard types), Appearence [sic] (Default/Light/Dark), Height, Progress (maybe Tap) | Library category Device. Drives the "Keyboard Height" component output. Likely backs the embedded soft keyboard (v109.1). |
| `builtin.facebook.login` | Facebook Login | Loops_Index, Loops_Option, Loops_Rating patterns | Access Token | Next to a Meta GraphQL friends query (`graph.facebook.com/graphql`, and `interngraph.intern.facebook.com` for "Intern"). Probably Meta-internal or hidden. |
| `builtin.dataFile` | (instance "Apple System Colors") | Spotify-Artists-Pick, WhatsApp-QR-Code | output INFERRED JSON | Inside `ios.iOSSystemColors`. Relates to "Attach JSON files for … color libraries, or data" in System publishing. |
| `builtin.layer.textInput` | Text Input | Origami-Newsletter, Text-Input, Spotify | Enable, Text, Font Name, Font Size, Set Text, Begin Editing, End Editing, Keyboard Type, Color, Position, Position Type, Anchor, Size, Opacity, Scale, Rotation, Pivot, Alignment… | Native layer behind the iOS/Material **Text Field** components (`ios.textField` wraps it with Show Clear, Secure Text, Placeholder, outputs Editing / Text / Enter Pressed). |
| `material.SoftNav` | Soft Nav | Facebook-Notifications, Popular-Events, WhatsApp-Filters | Enable, Type (Light/Dark), Nav Type (Standard, Swipe - 1 Bar, Swipe - 3 Bars) → Action 1 Down/Tap, Action 2 Down/Tap/Long Press, Action 3 Down/Tap | "Bottom navigation bar specific to Android devices." Platform Android, category Material. Not in the docs sidebar. |
| `builtin.layer.sublayerPlaceholder` | Sublayer Placeholder | 98 files | Group-like layer ports | Serialized form of the v98 **Sublayer Container** (display string "Sublayer Placeholder"). Confirms batch-17's inferred mapping. |
| `builtin.layer.combinerBinding` / `builtin.layer.outputBinding` / `builtin.layer.binding` | layer property patches | most files | — | `binding` = single-property blue patch; `combinerBinding` = whole-vector property (e.g. Position with Type enum); `outputBinding` = layer outputs (e.g. Text Input → Text). VERIFIED ids; roles INFERRED from context. |
| `builtin.group.input` / `builtin.group.output` | component published ports | 98 files | — | Purple/blue port patches. Carry `passthroughForPortTag`, `deleteWith`, `layerID`. |
| `builtin.springConverter` | Spring Converter | v214 | Response, Damping Fraction → **Mass**, Tension, Friction, "Bouciness", Speed | DOC-DRIFT: Mass output undocumented. |
| `builtin.momentumScrolling` | **Momentum Scrolling Engine** | v203, v212/214 | 8 inputs (see C3) | Doc title "Momentum Scrolling"; doc slug misspelled `momemtumscrolling`. |
| `builtin.layer.size` | Layer Info | v212 | Layer → Enabled, **Position**, Size, Scale, Anchor, Parent | One-frame delay (§4.1). |
| `ios.VisualEffect` | Visual Effect / material | v203, v214 | Material, Fade, Appearance (+ internal private.layer.blur) | See C6. |
| `ios.DragforSlider` | Drag for Slider | Utilities_Video | Enable, Layer, Start, Reset, Settings, Container Layer → Position, Velocity, Translation | Internal helper of the iOS Slider. Drag with velocity/translation outputs; the public Drag has only Position. |

**Community-component signals** ([tejas-scapia/origami README](https://github.com/tejas-scapia/origami), VERIFIED): utilities people build themselves:
- Debug Panel (bottom sheet) with Option, Checkbox, Text, Slider and Button controls
- Bigger/Smaller, Between, **Ticker** ("Like a counter, but doesn't wrap"), Loop Min/Max, **Snap to points**, **Slip** ("Limit growth of values beyond boundaries (useful for overscroll)")
- **Animate once** ("If animation is interrupted by a subsequent pulse, restarts the animation"), **Timed switch**, **Custom spring** (presets Bouncy / Organic / Smooth / No Bounce, outputs Tension, Friction, Stiffness, Ratio)
- **Elapsed time**, **Delay 1x** (delay x frames), **Gyro** ("with built in damping and error accumulation prevention")

Each is a built-in candidate or recipe for our library.

### 4.4 Serialized library metadata (for our node-definition schema; VERIFIED key names)

Per-patch `libraryInfo` keys seen in v203–v214 graphs:
- `category`, `aliases` (search synonyms, e.g. Transition: Tween, Lerp, Interpolate; Spring Animation: Spring, Bouncy; Value at Index: Get value from Array, Object At Index)
- `tags` (`important` / `unimportant`), `hotkeys`
- `about` (description), `details`, `platform` (iOS / Android)
- `availableInComponentsOnly`, `useNewDocumentation`, `previewImagesDarkWash`, `disableStylingPreviewImages`, `disableGeneratedPreviewImages`, `exampleImages`
- `isGenerated` (seen in v212/214 files; meaning unknown)

Per-port keys:
- `category` (inspector section: Basics, Content, Layout, Stroke, Shadow, Transform, Filters, Typography, Settings, Editing, Placeholder, Device), `enumOptions`, `hidden`, `hiddenValue`, `hiddenName`, `isVariant`, `isDefaultVariant`, `passthroughForPortTag`, `referencePortTag`, `hasReference`, `min`, `max`, `inputCount`

Instance and component keys:
- `unlinkedPrototype`, local component ids `com.facebook.local.<64-bit>`, `layerID`, `deleteWith`, `canvasEditorData`, `expandedLayerGroups`, `identifier`

Build strings observed: `203.0 (799429869)`, `212.0 (875235187)`, `214.0 (894885589)`, `214.0 (898809645)`.

Recommendation (INFERRED): our node-definition schema should carry the same learnability metadata:
- `aliases` for fuzzy search
- `tags.important` to rank the picker
- per-port `category` for inspector sections
- `platform` restrictions
- `availableInComponentsOnly`
- port `hidden` defaults (progressive disclosure)

The existing batch JSON has no aliases or port categories for most patches, so this is a gap to fill when generating the catalog.

### 4.5 Spring parameterizations: Apple definitions (VERIFIED DocC JSON)

- `Spring.init(duration:bounce:)`, with **defaults `duration = 0.5`, `bounce = 0.0`**: "Creates a spring with the specified duration and bounce… Defines the pace of the spring. This is approximately…"
- `Spring.init(response:dampingRatio:)`: response "Defines the stiffness of the spring as an approximate duration in seconds"; dampingRatio "Defines the amount of drag applied as a fraction the amount needed to produce critical damping".
- `Spring.stiffness`: "Increasing the stiffness reduces the number of oscillations and will reduce the settling duration." `Spring.damping`: "Defines how the spring's motion should be damped due to the forces of friction."
- **Fluid Spring Animation (v223) recommendation** (INFERRED): accept **Response + Damping Fraction** as primary (matching Spring Converter's inputs) and **Duration + Bounce** as a type variant. Use `k = (2π/response)²`, `c = 4π·ζ/response`, mass 1, velocity-preserving retarget, and optional Gesture Active / Gesture Velocity like Spring Animation.
- Community demand for **named presets** (Bouncy / Organic / Smooth / No Bounce) is VERIFIED (§4.3), matching learning-painpoints §5.5.

### 4.6 Learnability and ecosystem facts (VERIFIED)

- **Official YouTube channel** ([RSS](https://www.youtube.com/feeds/videos.xml?channel_id=UCfPkdJ6fs46m5JzCR7LEBpA)): 15 entries, newest **2020-11-03 "Using Data with Origami Studio"**; the rest are 2020-10-20 lesson videos matching the tutorials (Scrolling Views … Create a System). No official video covers JS Patch, Shader Layer, Layer Effects, WebSockets or the AI features.
- `origami.design/research/` ("Origami Research Session") and `origami.design/i/store/library/` ("Origami Studio Component Store Library") are live **deep-link shell pages** ("Open in the Origami Live app to view the prototype" / "Open in Origami to view components"). They show a URL-based component store and link-sharing mechanism exists. The URL scheme is not visible.
- `sitemap.xml` (376 URLs) has **no new documentation pages** beyond the 256 already captured. The fluid-spring doc slugs are 404 / redirect-to-home stubs (160-byte JS redirects). VERIFIED.
- GitHub ([search](https://api.github.com/search/repositories?q=origami%20studio)): tools for Origami Studio are rare. Found: Kami (AI JS-patch copilot, last push 2024-04), MorigamiDevices (custom device presets, 2022), and tejas-scapia/origami (components, 2026-03). No MCP server, JSON converter or file parser. VERIFIED negative.

---

## 5. Recommended runtime-spec decisions for gaps Origami can't settle (INFERRED; parity-safe defaults)

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| R1 | Initialization | Evaluate all nodes with authored input values **at frame 0**. "Previous-frame" nodes (Velocity, Delay 1, Pulse on Change, Smooth Value, Delay) seed history with the first evaluated value, so frame 0 has no spikes and no false pulses. Offer an "Origami compatibility" flag to reproduce the default-at-frame-0 quirk for imported files. | Meta documents the quirk as a bug workaround (§4.1); v188 fixed one instance. |
| R2 | Layout feedback | Order: patches, then layout, then render. Layer-derived outputs (Layer Info, text size, Scroll content size) are readable **next frame**. Show a "1-frame latency" badge on those ports. | Matches Meta's "Layer Info has a 1 frame delay". |
| R3 | Cycles | Allow back-edges with one-frame latency. Auto-insert or require **Delay 1** in UI-created cycles. Reject direct self-edges. | Official feedback idiom (§4.1). |
| R4 | Loop mismatch | Output length = max of input loop lengths; shorter loops wrap (index mod len); scalars broadcast; empty loop → empty. Warn in the HUD when lengths differ. Cap loop size (e.g. 10,000) with a visible "loop limit" error. | Docs say only "zipper". A limit is VERIFIED to exist. |
| R5 | Tap & position | Tap fires on the touch-up frame. **Interaction Position keeps the last touch position on that frame** (deviation from Origami, documented), then resets to 0 on the next frame in compatibility mode. | Meta comment: position is zero when tap fires, forcing Delay 1 workarounds. |
| R6 | Long press | `LongPress = held AND stationary (slop 10 pt) for Delay`. State output, cancels on movement beyond slop. | Legacy wiring §4.2.1 + tap tolerance 10 px (semantics.md). |
| R7 | Wait | Output is a boolean: false from Start until `t_start + Duration`, then latched true until the next Start pulse, which clears it and restarts the timer. Pulse inputs infer a pulse on its rising edge. | Legacy Timer §4.2.2 + current doc port text. |
| R8 | Momentum | One primitive, **Momentum Scrolling Engine**: POP decay (d per ms; Normal 0.998, Fast 0.99), rubber-band spring outside [Start, End] bounds (Tension/Friction in Rebound QC units), Stick To Boundaries hard stop, End Boundary default 99999. Drag, Pop Switch, Scroll and Screen edge-swipe are compositions of it. | §4.2.4, §4.2.6, C3. |
| R9 | Velocity estimation | Per-touch smoothed velocity (pts/s); hold last nonzero velocity one frame after release; ignore first-frame jump; reset remaining velocity on touch-up for non-momentum drags. | Legacy scroll sub-patch names (§4.2.6). |
| R10 | Same-frame precedence | Switch: Turn Off > Turn On > Flip. Counter: Jump > (Increase − Decrease net). Document it. | Legacy Switch counter is reset-dominant (semantics.md). |
| R11 | Classic Animation retarget | Restart from the current value over the full Duration (C⁰). Offer an optional "preserve velocity" variant. | No primary evidence; QC Smooth heritage. |
| R12 | Color interpolation | Linear RGBA (legacy Color Transition split RGBA), with an optional OKLCH variant. | Legacy macro VERIFIED (semantics.md). |

---

## 6. Remaining gaps: in-app verification checklist (needs Origami Studio ≥ v228)

These can't be settled from public material. Each is a small experiment someone with the app could run, recording the result in our catalog.

1. **Loop mismatch:** Loop Builder [1,2,3] + Loop Builder [10,20,30,40,50] into `+`, then Loop Count and Loop to Array. Is the length 3 or 5, and do the values wrap?
2. **Loop limit:** set Loop Count to 100k; note the error text and threshold.
3. **Classic Animation retarget:** Duration 1, Linear; change Number 0→100 at t = 0, then →0 at t = 0.5. Record the trace (restart vs continue).
4. **Spring Animation defaults and units:** insert it and read the default Mass/Tension/Friction. Compare a step response with k/c physics to confirm raw stiffness/damping.
5. **Fluid Spring Animation (v223):** port names, defaults and step response.
6. **Switch precedence:** fire Flip + Turn On + Turn Off in the same frame (one Interaction.Tap into all three).
7. **Arc Transition:** with Start 0, Middle 1, End 0, read the output at progress 0.25. A quadratic curve gives 0.75; piecewise linear gives 0.5.
8. **Repeating Animation (Mirrored, Quadratic In):** trace a full cycle to see whether the return leg mirrors the curve.
9. **Layer Effects catalog:** list the "Layer Effects" picker category (v221 "New Layer Effects"), Blur "Hard Edges" port name, and Liquid Glass and Reflective Layer parameters.
10. **Bluetooth LE / Hand Detection / Text To Speech / Variable Font builder:** patch titles and ports from the picker.
11. **CLI (v221):** binary name and path inside the app bundle, flags, and whether it round-trips; save the JSON output of a tiny file (Interaction → Switch → Pop → Transition → Rectangle.Scale).
12. **Copy-Paste As JSON:** paste into a text editor; compare its schema with the CLI output.
13. **LLM integration:** providers in Preferences, key storage, sparkle menu location, what context is sent.
14. **Shortcuts:** ⌘⇧A behavior; canvas tool keys (R/O/T/P?); whether the Layer List Touch button still exists; ⌘⏎ vs ⌥⏎.
15. **Momentum Friction mapping:** Drag Settings Momentum Friction 0/475/950 with a fixed flick; record the travel distance.
16. **Hit-test propagation:** a Tap on a child inside a Scroll group; does the parent Interaction.Down also fire?
17. **Frame-0 quirk:** confirm it still exists in v228 (Velocity on a constant input after ⌘R).
18. **Recording formats:** container, codecs, GIF availability.

---

## 7. Additions delivered

- `patches/gap-fill.json` has 9 entries (7 new + 2 updates):
  1. Blur Effect (`builtin.blurLayerEffect`)
  2. Haptic Player (`builtin.hapticPlayer`)
  3. Keyboard Info (`builtin.keyboard.info`)
  4. Facebook Login (`builtin.facebook.login`)
  5. Data File (`builtin.dataFile`)
  6. Text Input native layer (`builtin.layer.textInput`)
  7. Soft Nav (`material.SoftNav`)
  8. Two current-port-set updates: Spring Converter (Mass output) and Visual Effect (iOS) material ports. These are named "(current port set)" to avoid silently overwriting batch entries.
- Corrections C1–C18 above should be applied when the orchestrator consolidates reports.

---

## 8. Sources (this pass)

- Origami release notes (verbatim extract, v107 and v180 sections): https://origami.design/releases/ (local `releases_verbatim.md`, `releases.html`)
- Origami sitemap: https://origami.design/sitemap.xml; shell pages https://origami.design/research/ and https://origami.design/i/store/library/
- JS Patch API page (checked for timers, Gradient; still absent): https://origami.design/documentation/concepts/scriptingapi
- Official Origami YouTube RSS: https://www.youtube.com/feeds/videos.xml?channel_id=UCfPkdJ6fs46m5JzCR7LEBpA
- Official sample files from https://origami.design/patterns/, https://origami.design/examples/, https://origami.design/tutorials/ (local `patches/raw*`: Animation_Delay, Logic_Feedback, Interaction_Touch, Utilities_Text_Input, Utilities_Video, Loops_Index, Level-Meter, Spotify-Artists-Pick, WhatsApp-Filters, Facebook-Location-Map, Scroll_Jumping, Scroll_Pull_to_Refresh, Horizontal-Scrolling-(Completed), and others)
- Third-party 2026 files (Origami 212.0 / 214.0): https://github.com/tejas-scapia/origami (`spring playground.origami`, `utils.origami`, README)
- Legacy Origami for Quartz Composer: https://github.com/facebookarchive/origami (`Origami Plugin/FBStopWatchPatch.m`, `FBStopWatchPatch.xml`, `FBOMouseScrollPatch.m`, `POPDecayPatch.mm`, `POPDecayPatch.xml`; compositions `Long Press.qtz`, `Timer.qtz`, `Scroll.qtz`, `Swipe.qtz`, `Hit Area.qtz`)
- POP: https://github.com/facebook/pop/blob/master/pop/POPDecayAnimationInternal.h, https://github.com/facebook/pop/blob/master/pop/POPDecayAnimation.h
- Apple DocC JSON: `developer.apple.com/tutorials/data/documentation/swiftui/spring/init(duration:bounce:).json`, `…/init(response:dampingratio:).json`, `…/stiffness.json`, `…/damping.json`, `…/uikit/uiscrollview/decelerationrate-swift.struct.json`, `…/normal.json`
- GitHub API searches (2026-09-16): `search/repositories?q=origami studio`, `q=origami mcp`; `search/code?q="builtin.bouncy"`, `q="builtin.layer.binding"`
