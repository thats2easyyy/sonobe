# Patch catalog

This folder is the plan and source text for every built-in Sonobe patch. Each entry becomes a `definePatch` module in `@sonobe/patches`, and the same text feeds the patch picker, hover docs, the generated reference, and the MCP `describe_patch_types` tool.

- `CONVENTIONS.md` is the contract for entries.
- `index.json` lists every patch type, and `census-decisions.json` records what happened to each Origami census row.
- The `<category>-<n>.json` files hold the entries.

Two checks keep the catalog honest:

```sh
node packages/patches/catalog/validate.ts   # conventions: fields, examples, Origami mapping, census coverage
npx vitest run packages/patches             # the validator, contract shape, cross-patch consistency, and this README's counts
```

## At a glance

- **199 patches** in 16 categories, spread over 23 chunk files.
- **170** map to an Origami census id, **14** map to an Origami patch that has no published id, and **15** are Sonobe-native.
- **177** are supported everywhere, **20** are web-limited, and **2** can't run on the web yet.

## By category

| Category | Picker label | Patches | Tier 1 | Tier 2 | Tier 3 | Chunks |
|---|---|---:|---:|---:|---:|---|
| `interaction` | Interaction | 14 | 10 | 4 | 0 | interaction-1, interaction-2 |
| `animation` | Animation | 18 | 10 | 8 | 0 | animation-1, animation-2 |
| `state` | State & Time | 16 | 13 | 3 | 0 | state-1, state-2 |
| `logic` | Logic | 11 | 10 | 1 | 0 | logic-1 |
| `math` | Math | 20 | 15 | 5 | 0 | math-1, math-2 |
| `loops` | Loops | 20 | 6 | 14 | 0 | loops-1, loops-2 |
| `text` | Text | 11 | 2 | 9 | 0 | text-1 |
| `color` | Color | 7 | 3 | 4 | 0 | color-1 |
| `data` | Data & Network | 25 | 0 | 25 | 0 | data-1, data-2 |
| `device` | Device | 11 | 0 | 5 | 6 | device-1 |
| `media` | Media | 14 | 0 | 6 | 8 | media-1 |
| `shapes` | Shapes | 8 | 0 | 8 | 0 | shapes-1 |
| `layers` | Layers & Effects | 5 | 0 | 4 | 1 | layers-1 |
| `utility` | Utility | 17 | 8 | 9 | 0 | utility-1, utility-2 |
| `components` | Components | 1 | 1 | 0 | 0 | components-1 |
| `scripting` | Scripting | 1 | 1 | 0 | 0 | scripting-1 |
| **Total** | | 199 | 79 | 105 | 15 | 23 files |

## By status

| Status | Meaning | Patches | Tier 1 | Tier 2 | Tier 3 |
|---|---|---:|---:|---:|---:|
| `supported` | Works the same in the desktop app, the web player, and headless simulation | 177 | 79 | 97 | 1 |
| `web-limited` | Needs a permission, a secure page, a tap, a particular browser, or special hardware | 20 | 0 | 8 | 12 |
| `unsupported-web` | Needs a model Sonobe doesn't ship; loads from files and outputs idle values | 2 | 0 | 0 | 2 |

What limits the 20 web-limited patches:

- **Permission or a secure page:** `camera`, `microphone`, `location`, `deviceMotion`, `gameController`
- **A tap or key press first:** `openUrl`, `photoPicker`, `soundPlayer`, `textToSpeech`
- **Browser coverage:** `bluetoothLe`, `qrCodeDetection`, `vibrate`, `haptic`, `glassEffect` (refraction)
- **Cross-site rules:** `networkRequest`, `webSocketConnection`, `audioMetering`, `snapshot`, `objectDetection`
- **Estimated:** `softKeyboard`, whose height comes from the browser's visual viewport

`faceDetection` and `handDetection` are `unsupported-web` until Sonobe ships detection models.

## Low-confidence entries

These entries are complete specs, but part of what they say rests on inference or on a contract that doesn't exist yet. Check them first when Origami parity or an implementation surprises you.

### Origami never published the port list

The census knows these patches only by name (release notes, file strings, or tutorials), so their ports are reconstructed:

`fluidSpringAnimation`, `objectJoin`, `textToJson`, `textToSpeech`, `bluetoothLe`, `handDetection`, `glassEffect` (Liquid Glass), `size`, `sizeUnpack`, `edges`, `edgesUnpack`, `cornerRadii`, `cornerRadiiUnpack`, `component` (Patch Component)

### Behavior Sonobe had to decide

Origami doesn't document these behaviors, so an imported file could behave differently:

- `springAnimation`: Tension and Friction are raw stiffness and damping.
- `arcTransition`: one quadratic through Start, Middle, and End instead of two straight segments.
- `classicAnimation`, `cubicBezierAnimation`: a new target restarts the tween over the full duration.
- `repeatingAnimation`: the curve applies per leg, and the mirrored return plays the forward leg in reverse.
- `switch`, `counter`, `stopwatch`, `wait`: same-frame precedence between pulses.
- `doubleTap`: Double Tap fires on the second tap, not when the window closes.
- `longPress`: once recognized it stays on through movement, and setting Layer adds a stay-still check.
- `popSwitch`: On commits at release using flick projection instead of following the gesture.
- `optionPicker`, `optionSender`: out-of-range options clamp.
- `drag`, `momentumScrolling`: how Momentum Friction and Scrolling Friction map to deceleration.
- `bouncyConverter`: whether Origami outputs physical or QC-scale tension and friction.
- `hexColor`, `colorToHex`: accepted hex lengths and output letter case.
- `edges`, `edgesUnpack`, `cornerRadii`, `cornerRadiiUnpack`: the serialized side and corner order, so importers map by label.
- `formatDateTime`: the Format option order, inferred from reversed strings in official files.
- `deviceInfo`: which orientation angles Origami reports.

### Waiting on contract additions

These behaviors specify a workaround until the contract grows. Each proposal is spelled out in the entry's `behavior`, and CONVENTIONS.md §19 has the shared ones.

- **Pointer detail** (`PointerSnapshot`, `RuntimeServices.pointers`): `interaction` (Force), `swipe` (cancelled presses), `hover` (pointer type), `mouse` (buttons), `touches` and `popSwitch` (every finger for pinches)
- **Layer and media readers:** `videoInfo` (`layerOutput`), `imageInfo` (`mediaInfo`), `layerInfo` and `convertPosition` (parent instance and world transform)
- **Platform services:**
  - media capture: `camera`, `microphone`
  - detection: `faceDetection`, `handDetection`, `qrCodeDetection`, `objectDetection`
  - audio: `soundPlayer`, `audioMetering`
  - `snapshot`, `photoPicker`, `webSocketConnection`, `bluetoothLe`, `location`, `gameController`, `haptic`, `softKeyboard`
  - speech cancel: `textToSpeech`
  - open result: `openUrl`
  - abort, headers, and bytes: `networkRequest`, `base64Encode`
- **Core types and context:** `delay1` (feedback edges), `splitter` (ports that accept any type), `gradientBuilder` (radial ratio), `formatDateTime` (device time zone), `javascript` (script ports and async services)
- **Variadic start index and direction** (§19.1): every option patch, `jsonArray`, and `loopBuilder` need `dynamicPorts` until `VariadicSpec` has them.

### Defaults with no Origami evidence

These Origami-mapped patches have at least three inputs, and none of their defaults are verified or legacy. Every choice is recorded in `defaultNotes`. Sonobe-native patches aren't listed, because all of their defaults are Sonobe's own choices by definition.

- **Tier 1:** `springAnimation`, `transition`, `progress`, `repeatingAnimation`, `longPress`, `drag`, `equals`, `clamp`
- **Tiers 2 and 3:**
  - animation: `fluidSpringAnimation`, `cubicBezierCurve`, `cubicBezierAnimation`, `arcTransition`
  - color: `rgbColor`, `hslColor`, `gradientBuilder`
  - data: `setValueForKey`, `arraySort`, `subarray`, `networkRequest`, `webSocketConnection`, `base64Encode`
  - device and layers: `bluetoothLe`, `popSwitch`, `convertPosition`, `glassEffect`
  - loops and math: `gridLayout`, `loopInsert`, `random`
  - media: `soundPlayer`, `photoPicker`, `camera`, `faceDetection`, `handDetection`
  - shapes: `circleShape`, `ovalShape`, `roundedRectangleShape`, `triangleShape`
  - state and text: `optionSender`, `splitText`, `textStartsWith`, `textEndsWith`, `textReplace`, `substring`, `measureText`, `formatDateTime`
  - utility: `point3d`, `point4d`, `edges`, `cornerRadii`

## Consistency rules

`src/catalog.test.ts` enforces these rules across every chunk, on top of the per-entry checks:

- `enabled` is a boolean named Enabled that defaults to on. The exceptions are `camera` and `microphone`, which start off so inserting one never turns on a camera or a microphone.
- An everyday `layer` input comes first, named Layer and defaulting to empty, and `enabled` comes right after it. An advanced `layer`, like Audio Metering's, may come later.
- `reset` inputs are pulses named Reset, and every `output` port is named Output.
- Advanced inputs come after everyday inputs.
- Every `curve` enum offers the 13 CURVE options in the same order.
- Spring ports describe one default spring: Response 0.55 and Damping Fraction 0.825 equal Tension 130.51, Friction 18.85, and Mass 1.
- Bounciness and Speed default to 5 and 10 with a 0–20 range and a 0.5 step.
- Whole-loop Loop inputs default to an empty loop, except Any and All, which answer off.

The validator also reports five known warnings:

- `valueAtIndex`, `valueForKey`, `valueAtPath`, and `networkRequest` list JSON first in their variants, because lookups and responses usually stay JSON.
- `loopBuilder` allows 128 items so an imported folder of images fits in one patch.
