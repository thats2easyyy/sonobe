# Patch Catalog Conventions

This is the contract for `packages/patches/catalog/`. The catalog is the plan and source text for every built-in Sonobe patch. Each entry becomes a `definePatch` module in `@sonobe/patches` (ARCHITECTURE.md §6). The same text also drives the generated reference, patch-picker search, hover docs, and the MCP `describe_patch_types` tool (ARCHITECTURE.md §11).

**Precedence.** `ARCHITECTURE.md` and the contract files win over this document:
- `packages/core/src/types.ts`
- `packages/core/src/layerTypes.ts`
- `packages/engine/src/types.ts`

This document wins over any chunk file. When two of them conflict, fix the lower one or raise it (§19).

**Research inputs:**
- `docs/research/patches/index.json`: the census of Origami patches.
- `docs/research/patches/batch-*.json` and `gap-fill.json`: port-level specs with evidence grades.
- `docs/research/semantics.md`: evaluation rules and physics formulas.
- `docs/research/gap-fill.md`: corrections C1–C18 and runtime decisions R1–R12.
- `docs/research/release-notes.md` §3.4: Origami's current patch inventory.

---

## 1. Files

| File | Contents |
|---|---|
| `CONVENTIONS.md` | This document. |
| `index.json` | Every included patch as `{ type, name, category, tier, origami_id, origami_name, file }`. It is the source of truth for type keys, display names, categories, tiers, and which chunk owns each patch. |
| `census-decisions.json` | One decision per Origami census row: the 256 rows in `docs/research/patches/index.json` plus the 7 new entries in `gap-fill.json`. Each row is `include`, `merge`, or `exclude`, with a note or reason. |
| `<category>-<n>.json` | Work chunks: full catalog entries for the patches that `index.json` assigns to the file. A chunk holds at most 18 patches. |
| `validate.ts` | Node script that checks all of the above against this document (§20). |
| `README.md` | Counts per category, tier, and status, and the entries that rest on the least evidence. The tests keep its counts current. |
| `../src/catalog.test.ts` | Vitest suite: the §20 checks, the cross-patch consistency rules below, and the README counts. |

A chunk file is a JSON object:

```json
{
  "file": "state-1.json",
  "category": "state",
  "patches": []
}
```

The `patches` array holds catalog entries in the same order as `index.json`.

Formatting:
- UTF-8, LF line endings, 2-space indent, trailing newline.
- No comments.
- Keys in the order given in §3.

---

## 2. Writing a chunk

1. **Read the rules.** Read this document, plus these contract sections:
   - ARCHITECTURE.md §3.3 (encoding), §4 (values, loops, pulses), §5 (engine), §6 (patch library), and §10 (outline notation).
   - `PatchSpec`, `PortSpec`, `VariadicSpec`, and `PatchExample` in `packages/core/src/types.ts`.
   - `PatchContext`, `RuntimeServices`, and `PlatformServices` in `packages/engine/src/types.ts`.
2. **Gather evidence for each patch in your chunk:**
   - its census row in `docs/research/patches/index.json`, found by `origami_id` or Origami name;
   - its `batch-*.json` entry, found by Origami name;
   - any corrections in `gap-fill.md` §3 and `gap-fill.json`;
   - its row in `census-decisions.json`, for merges and renames that change ports;
   - the formulas in `semantics.md`;
   - the directives in §18.5.
3. **Write the entries in `index.json` order.** Copy `type`, `name`, `category`, and `tier` from `index.json` and don't change them. If one looks wrong, keep it and raise it in your report.
4. **Validate.** Run `node packages/patches/catalog/validate.ts <file>`. Fix every error and review every warning.

**Evidence ranking.** When sources disagree:
- Verified strings from current Origami files and release notes beat the docs, which are stale.
- The docs beat legacy Quartz Composer macros.
- Legacy macros beat inference.

When the research marks a fact INFERRED, decide it yourself (§15) and record the decision.

**Clean room.** Describe behavior in your own words. Don't paste Origami documentation or reuse Meta asset names. Factual references to Origami belong in `origami`, `importAliases`, `origamiPorts`, or a "Coming from Origami" docs section.

---

## 3. Entry format

An entry is a `PatchSpec` written as JSON, plus catalog-only fields marked ◆. Code generation strips the catalog-only fields or maps them elsewhere.

### 3.1 Fields (in this order)

| Field | Required | Shape | Rule |
|---|---|---|---|
| `type` | ✓ | string | From `index.json`. |
| `name` | ✓ | string | From `index.json`. |
| `category` | ✓ | `PatchCategory` | From `index.json`. |
| `tier` ◆ | ✓ | `1 \| 2 \| 3` | From `index.json` (§13). |
| `status` ◆ | ✓ | `"supported" \| "web-limited" \| "unsupported-web"` | §14. |
| `statusReason` ◆ | when not supported | string | One or two sentences naming the API or the gap. |
| `platforms` | when not supported | `("desktop" \| "web" \| "mobile")[]` | Where the patch functions (§14). |
| `aliases` | ✓ | string[] | §17.4. |
| `summary` | ✓ | string | One sentence, at most 140 characters (§17.1). |
| `docs` | ✓ | markdown | User-facing (§17.2). |
| `behavior` ◆ | ✓ | markdown | The implementer's evaluation spec (§16). |
| `inputs` | ✓ | `PortSpec[]` | §3.2, §6, §7. May be `[]`. |
| `outputs` | ✓ | `PortSpec[]` | May be `[]`. |
| `variadic` | | `VariadicSpec` plus ◆`startIndex` and ◆`direction` | §9. |
| `variants` | when any port is `"variant"` | `ValueType[]` | §8. |
| `variantDefaults` ◆ | | `{ [variant]: { [portKey]: literal } }` | §8. |
| `settings` ◆ | | `SettingSpec[]` | §10. |
| `dynamicPortsRule` ◆ | | string | §10. |
| `alwaysEvaluate` | ✓ | boolean | §16.8. |
| `shortcut` | | string | Only the keys in §11.2. |
| `pairsWellWith` | ✓ | string[] | 2 to 5 type keys from `index.json`, not including this patch. |
| `commonMistakes` | ✓ | string[] | 1 to 4 items (§17.5). |
| `examples` | ✓ | `PatchExample[]` | 1 to 3 items (§17.6). |
| `origami` | ✓ | `{ id?, name }` or `null` | §4.2. Use `null` for Sonobe-native patches; code generation omits it. |
| `importAliases` ◆ | | string[] | §4.2. |
| `origamiPorts` ◆ | | `{ [portKey]: string }` | §4.2. |
| `defaultNotes` ◆ | | `{ [portKey]: string }` | §15. |

Leave out optional fields that don't apply; don't write `null` or `[]` for them. Three exceptions are always written: `origami: null` for native patches, `inputs: []`, and `outputs: []`.

### 3.2 Nested shapes

**PortSpec** keys, in order: `key, name, type, subtype, default, min, max, step, enumOptions, description, wholeLoop, advanced`.

**EnumOption:** `{ key, name, description? }`.

**VariadicSpec** keys, in order: `key, name, type, default, min, max, defaultCount, startIndex ◆, direction ◆, description`.

**SettingSpec ◆:** `{ key, name, type, default, enumOptions?, description }`. `type` is one of `"text"`, `"number"`, `"boolean"`, `"enum"`, `"json"`.

**PatchExample:** `{ title, description?, outline }`.

### 3.3 Complete example

```json
{
  "type": "switch",
  "name": "Switch",
  "category": "state",
  "tier": 1,
  "status": "supported",
  "aliases": ["toggle", "on off", "flip flop", "boolean state", "light switch", "latch"],
  "summary": "Remembers whether something is on or off and changes when it gets a pulse.",
  "docs": "## How it works\nA Switch works like a light switch: it stays **on** or **off** until a pulse changes it. It starts off.\n\n- **Flip** changes it to the opposite state.\n- **Turn On** and **Turn Off** set the state directly and do nothing if the switch is already there.\n- If pulses arrive on more than one input in the same frame, Turn Off wins, then Turn On, then Flip.\n\n## Tips\n- Connect On to an animation's Number so the change animates instead of jumping.\n- Need more than two states? Use Option Switch.",
  "behavior": "State per loop index: `{ on: false }`.\n\nEach frame:\n```\nif (ctx.pulsed(\"turnOff\")) state.on = false;\nelse if (ctx.pulsed(\"turnOn\")) state.on = true;\nelse if (ctx.pulsed(\"flip\")) state.on = !state.on;\nctx.output(\"on\", state.on);\n```\n\n- Pulses: all three inputs are pulses. `ctx.pulsed` fires on an upstream pulse or on a false→true edge of a connected boolean, so a held `true` flips once. Pulses on consecutive frames each count.\n- Precedence (ARCHITECTURE.md §5.2): turnOff > turnOn > flip within one frame.\n- Frame 0: starts off; a pulse on frame 0 applies on frame 0.\n- Loops: per-index state. New indices start off; removed indices drop their state.\n- Muted: outputs false.\n- Restart: state resets to off.",
  "inputs": [
    { "key": "flip", "name": "Flip", "type": "pulse", "description": "Pulse to switch to the opposite state." },
    { "key": "turnOn", "name": "Turn On", "type": "pulse", "description": "Pulse to turn the switch on. Does nothing if it's already on." },
    { "key": "turnOff", "name": "Turn Off", "type": "pulse", "description": "Pulse to turn the switch off. Does nothing if it's already off." }
  ],
  "outputs": [
    { "key": "on", "name": "On", "type": "boolean", "description": "True while the switch is on." }
  ],
  "alwaysEvaluate": false,
  "shortcut": "S",
  "pairsWellWith": ["interaction", "popAnimation", "transition", "pulse"],
  "commonMistakes": [
    "The layer springs back when you lift your finger: Down is a state that turns off on release. Wire Tap into Flip when the change should stay.",
    "The switch never turns off: the same pulse also reaches Turn On, and Turn On beats Flip. Give each input its own pulse source."
  ],
  "examples": [
    {
      "title": "Tap to grow a card",
      "description": "The ISAT chain: Interaction, Switch, Pop Animation, Transition.",
      "outline": "layer card rectangle \"Card\" @16,120 358x220 scale←grow.output\npatch tap_card interaction layer=@card\npatch toggle switch flip←tap_card.tap\npatch pop popAnimation number←toggle.on\npatch grow transition<number> progress←pop.output start=1 end=1.08"
    }
  ],
  "origami": { "id": "builtin.switch", "name": "Switch" }
}
```

---

## 4. Patch type keys

### 4.1 Rules

- **Format.** camelCase ASCII matching `^[a-z][a-zA-Z0-9]*$`.
- **Stability.** A key never changes. A rename requires a document migration in core.
- **Words.** Use words a designer would search for.
- **What not to copy from Origami.** Don't copy:
  - typos (`momemtum`)
  - internal slugs (`builtin.range` for Clip)
  - symbols (`+`, `÷`)
  - retired names (`multiplexer`, `indexSwitch`, `wireless…`)
- **When to rename.** Keep Origami's name when it's clear (`popAnimation`, `optionPicker`, `sampleAndHold`). Rename only when the name misleads (Trim Text → `substring`), collides (below), or is jargon without a plain alternative.
- **Layer type collisions.** A patch key must never equal a layer type key: `group, rectangle, oval, text, image, video, shape, gradient, colorFill, hitArea, textField, lottie, shader, clone, componentInstance`. That's why the catalog has `imageAsset`, `ovalShape`, and `gradientBuilder`.
- **Value type collisions.** A patch key equals a `ValueType` only when the patch packs exactly that type (`point`, `size`, `point3d`, `point4d`). Otherwise add a prefix (`loopAny`, not `any`).
- **Keys ARCHITECTURE.md fixes.** These are final: `interaction, switch, counter, pulse, delay, delay1, wait, popAnimation, springAnimation, classicAnimation, transition, progress, reverseProgress, optionSwitch, optionPicker, velocity, smoothValue, pulseOnChange, time, whenPrototypeStarts, drag, scroll, hover, keyboard, javascript`.
- **Families.** Related patches share a prefix or suffix so they sort together: `loop…`, `array…`, `text…`, `colorTo…`, `webSocket…`, `…Shape`, `…Effect`, `…Unpack`.

### 4.2 Origami mapping

- **`origami.id`** is the census identifier: the Origami docs URL slug, as recorded in `index.json` `origami_id`. Leave `id` out when the census has none (release-notes-only patches).
- **`origami.name`** is Origami's display name, from `index.json` `origami_name`.
- **Sonobe-native patches** use `"origami": null`, matching `origami_name: null` in `index.json`.
- **`importAliases`** lists other Origami identifiers that import as this patch. Identifiers only: old display names go in `aliases`. Include:
  - serialized camelCase ids (`builtin.momentumScrolling`, `builtin.pulseOnStart`, `builtin.loop.selectReorder`);
  - legacy doc ids (`origami.scroll`);
  - ids of patches merged into this one (`builtin.layer.scroll.settings`).
- **`origamiPorts`** maps a Sonobe port key to Origami's port label. Add it whenever the key isn't simply the camelCase of the label, for example `"interval": "Frequency"` or `"pageSize": "Scroll Settings › Page Size"`. Importers use it, so fill it in for every renamed or merged port.

---

## 5. Display names

- Title Case, usually one to four words.
- Punctuation only where it reads naturally: `Format Date & Time`, `If / Else`.
- Names follow the same families as keys: `Loop Reverse`, `Color to Hex`, `Circle Shape`.
- Port names are Title Case and short. A port key is the camelCase form of its name unless the glossary (§6.2) says otherwise.

---

## 6. Port keys

### 6.1 Rules

1. **Format.** Keys are camelCase ASCII matching `^[a-z][a-zA-Z0-9]*$`. They are stable and never localized.
2. **Uniqueness.** A key is unique across a patch's inputs **and** outputs together, because the address `patchId.portKey` doesn't say which side a port is on. If an input and an output would share a word, the output becomes `output` or a more specific result word.
3. **Name the meaning.** Use `bounciness`, not `number2` or `input1`. When Origami leaves a port unnamed, use the glossary name.
4. **Reuse before inventing.** Use the glossary key whenever the meaning matches. When a port mirrors a layer property, reuse the property key from `layerTypes.ts` (`cornerRadius`, `volume`, `rate`, `playing`, `fontSize`, `letterSpacing`).
5. **Pulse inputs are commands** (verbs): `flip`, `turnOn`, `reset`, `request`.
6. **Pulse outputs are events** (nouns or past tense): `tap`, `turnedOn`, `finished`, `changed`.
7. **Boolean inputs are modes or conditions:** `enabled`, `mirrored`, `momentum`, `caseSensitive`.
8. **Boolean outputs are states:** `on`, `down`, `hovering`, `loading`, `connected`, `done`. Add an `is` prefix only when the bare word would read as a command or collide with another key (`isFocused` next to a `focus` input).
9. **Order.** Inputs go `layer`, then `enabled`, then the ports people wire most, then tuning ports, then advanced ports. Outputs put the main result first.
10. **Advanced ports.** Set `"advanced": true` on ports most people never touch. The patch must behave well with every advanced port at its default. Settings patches merged into a parent (§18.2) become advanced ports on that parent.
11. **Integers.** Integer counts use `"step": 1`. Zero-based positions use type `index`.

### 6.2 Glossary of shared keys

**Controls and targets**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `enabled` | boolean, default `true`; `false` on the capture patches Camera and Microphone (§15) | The patch senses and acts only while this is true. When false, it outputs idle values (no pulses, `down` false) and keeps its internal state. | interaction, time, repeatingAnimation, camera |
| `layer` | layer, default `null` | The layer the patch acts on or reads. `null` means the whole screen where that makes sense. | interaction, scroll, drag, layerInfo |
| `<role>Layer` | layer | A second layer with a named role. | `fromLayer`, `toLayer` (convertPosition) |
| `available` | boolean output | True when the platform supports the feature and permission was granted. | camera, location, deviceMotion, bluetoothLe |

**Pulse commands (inputs)**

| Key | Meaning | Used by |
|---|---|---|
| `flip`, `turnOn`, `turnOff` | Change a two-state value. Same-frame precedence: `turnOff` > `turnOn` > `flip`. | switch, tapToggle, popSwitch |
| `increase`, `decrease`, `jump` | Step or set a count. Precedence: `jump`, then `increase − decrease`. | counter |
| `start`, `stop`, `reset` | Begin, pause, return to the initial state. `reset` never starts anything. | wait, stopwatch, repeatingAnimation |
| `request`, `send`, `play`, `open`, `capture`, `randomize`, `restart`, `insert`, `remove`, `shuffle` | One-shot actions. | networkRequest, webSocketSend, soundPlayer, openUrl, camera, random, restartPrototype, loop mutations |

**Events (pulse outputs)**

| Key | Meaning | Used by |
|---|---|---|
| `tap` | A press released on the layer after moving less than 10 pt. | interaction, gesture |
| `turnedOn`, `turnedOff` | A watched boolean became true or false this frame. | pulse, tapToggle |
| `changed` | The watched value changed this frame. | pulseOnChange |
| `finished` | A timed process completed this frame. | wait |
| `received`, `submitted` | Data arrived; the person confirmed input. | webSocketReceive |

**States (boolean outputs)**

| Key | Meaning | Used by |
|---|---|---|
| `on` | A two-state value is on. On the Pulse patch, `on` is instead the input state to watch. | switch, tapToggle, popSwitch |
| `down` | A pointer is pressed on the layer, or anywhere when `layer` is null. | interaction, gesture |
| `hovering` | The pointer is over the layer. | hover |
| `done` | Latched completion: true once finished, until the next `start` or `reset`. | wait |
| `loading` | Async work is in flight. | networkRequest, base64Decode |
| `connected` | A connection is open. | webSocketConnection, bluetoothLe |
| `error`, `errorMessage` | `error` is true when the last attempt failed; `errorMessage` is readable text explaining why. | networkRequest, jsonToShape |

**Values and results**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `value` | variant or number | The main input the patch reads, stores, measures, or transforms. | delay, sampleAndHold, progress, clamp, smoothValue, velocity, splitter, watch |
| `number` | variant | An animation's target; the output moves toward it. Fixed by ARCHITECTURE.md §3.3. | popAnimation, springAnimation, classicAnimation, fluidSpringAnimation |
| `output` | variant | The main result when no more specific key fits. | transition, add, delay, popAnimation |
| `result` | json, text, or media | The payload of a finished request. | networkRequest |
| `progress` | number (subtype progress) | 0 at the start, 1 at the end. Values may go outside 0–1; patches don't clamp unless their behavior says so. | transition (input), progress (output), repeatingAnimation (output) |
| `start`, `end` | variant | The endpoints of an interpolation or range. They can be reversed (`end < start`). | transition, progress, random |
| `min`, `max` | number or vector | Bounds. The behavior must say what happens when `min > max`. | clamp, drag, inRange |
| `fromStart`, `fromEnd`, `toStart`, `toEnd` | number | The input range and output range of a mapping. | remap |
| `clampToRange` | boolean, default `false` | Holds a range mapping's output at the ends of its range instead of extrapolating past them. | progress, remap |
| `option` | index | Which option is selected, counted from 0. | optionSwitch (output), optionPicker (input) |
| `option0`…`optionN` | variant | The per-option values (variadic with `startIndex: 0`). | optionPicker, optionSender, optionEquals |
| `index` | index | An item's 0-based position. | loop, loopSelect, valueAtIndex |
| `count` | number, `step: 1` | How many items. | loop, loopCount, arrayCount |
| `loop` | whole loop (`wholeLoop: true`) | A loop taken or produced as a whole. An unconnected input defaults to an empty loop, `{ "loop": [] }`, except the on/off reducers Any and All, which default to `false`. **Media exception:** on media patches, `loop` is the boolean "repeat playback", matching the video layer. No patch uses both meanings. | loopReverse, loopCount, soundPlayer |

**Time**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `duration` | number (subtype duration) | How long something lasts, in seconds. | classicAnimation, wait, delay, longPress |
| `interval` | number (subtype duration) | Seconds between repeated events. | repeatingPulse, doubleTap |
| `time` | number (subtype duration) | Elapsed seconds (output). | time, stopwatch |
| `frame` | index | Frames since the prototype started. | time |
| `curve` | enum (§11.1) | An easing curve. | classicAnimation, curve, repeatingAnimation, keyframes |

**Springs**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `bounciness`, `speed` | number; defaults 5 and 10, soft range 0–20, step 0.5 | Pop Animation feel, via Rebound's BouncyConversion (semantics.md §7.2). | popAnimation, popSwitch, springPreset, bouncyConverter |
| `mass`, `tension`, `friction` | number; defaults 1, 130.51, and 18.85, the same spring as the `response` defaults | Physical spring constants: mass, stiffness *k*, and damping *c* (§18.5). | springAnimation, springConverter |
| `response`, `dampingFraction` | number; defaults 0.55 and 0.825 (SwiftUI's `spring(response:dampingFraction:)`) | Apple-style feel. `response` is roughly the settle time in seconds; `dampingFraction` runs 0–1, where 1 means no bounce. | fluidSpringAnimation, springConverter, springPreset |
| `bounce` | number | SwiftUI-style bounce, used together with `duration`. | springPreset |
| `gestureActive`, `gestureVelocity` | boolean, variant | While the gesture is active the spring tracks the target. When it ends, the gesture's velocity (points/second) is handed to the spring. | springAnimation, fluidSpringAnimation |

**Geometry**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `position` | point (subtype distance) | A location in points, y down. Pointer outputs are in prototype coordinates. Outputs meant to drive a layer's Position (drag, gridLayout) are in that layer's parent space. Every description says which. | interaction, drag, circleShape |
| `translation` | point | Offset from where the touch began. | gesture |
| `velocity` | point or number (subtype velocity) | Points per second. | gesture, velocity |
| `size` | size | Width and height in points. | layerInfo, measureText, ovalShape |
| `anchor` | anchor | A 0–1 point within a layer. | convertPosition |
| `x`, `y`, `z`, `w` | number | Vector components. | point, pointUnpack, point3d |
| `width`, `height` | number | Size components. | size, sizeUnpack |
| `radius` | number | Circle radius in points. | circleShape |
| `cornerRadius` | number | Corner rounding in points (matches the layer property). | roundedRectangleShape |
| `angle` | number (subtype angle) | Degrees. | sine, cosine |
| `shape` | shape | Vector path data. | *Shape patches, shapeUnion |
| `effect` | layerEffect | A value for a layer's Effects property. | blurEffect, colorControlsEffect |

**Text, data, and color**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `text` | text | The main text input. | textLength, splitText, textReplace |
| `find`, `replace` | text | Search text and replacement text. | textReplace |
| `json` | json | Any JSON value. | jsonToText, jsonToShape |
| `object`, `array` | json | An object input or an array input. | valueForKey, arrayCount |
| `key`, `path`, `item` | text, text, variant | A lookup key, a dot path, an array item. | valueForKey, valueAtPath, arrayAppend |
| `url`, `method`, `headers`, `body` | text, enum, json, json | Parts of a request. | networkRequest, openUrl |
| `color` | color | A color input or output. | colorToHex, hexColor |
| `red`, `green`, `blue`, `alpha` | number, 0–1 | RGBA channels. | rgbColor, colorToRgb |
| `hue`, `saturation`, `lightness` | number, 0–1 | HSL channels. | hslColor, colorToHsl |
| `hex` | text | `#RRGGBB` or `#RRGGBBAA`. | hexColor, colorToHex |

**Media**

| Key | Type | Meaning | Used by |
|---|---|---|---|
| `image`, `video`, `sound` | image, video, sound | A media value or asset. | imageAsset, imageInfo, soundPlayer |
| `playing` | boolean | Plays while true (matches the video layer). | soundPlayer |
| `volume` | number, 0–1 | Loudness. | soundPlayer, textToSpeech |
| `rate` | number | Playback speed multiplier. | soundPlayer, textToSpeech |

---

## 7. Units and default encoding

**Units:**
- Distances are points, y down, with the origin at the parent's top-left (ARCHITECTURE.md §5.4). Origami centers its origin; importers convert, and the catalog doesn't.
- Angles are **degrees**, for both inputs and outputs, including sine, cosine, and arctangent.
- Time is seconds. Velocity is points per second.
- Progress runs 0–1. Use subtype `percent` (0–100) only for text-like displays.
- Colors are straight RGBA.

**Default literals** use the document encoding (ARCHITECTURE.md §3.3):

| Port type | `default` |
|---|---|
| number, index | number (index: an integer) |
| boolean | boolean |
| text | string |
| enum | an option key |
| color | `"#RRGGBBAA"` |
| point, size, anchor | `[x, y]` |
| point3d | `[x, y, z]` |
| point4d | `[a, b, c, d]` |
| json | the JSON value itself |
| gradient | a runtime `GradientValue` object, as in `layerTypes.ts` |
| layer, image, video, sound, shape, layerEffect | `null` |
| a loop of literals (on a `wholeLoop` port) | `{ "loop": [ … ] }` |
| pulse | omit `default` |
| variant | a literal for the first variant (§8) |

- Every input except pulses declares `default`. Outputs never declare one.
- `min`, `max`, and `step` are **soft** limits: they bound scrubbing in the inspector and raise info diagnostics. An evaluator clamps a value only when the patch's `behavior` says so.

---

## 8. Type variants

A patch whose ports change type with `typeParam` lists `variants`. The first variant is the default, and ports that follow the variant use `"type": "variant"`. Copy one of these named sets exactly, or a subset that keeps the same order:

| Set | Types | Typical patches |
|---|---|---|
| INTERPOLABLE | `["number", "point", "point3d", "point4d", "size", "anchor", "color"]` | popAnimation, springAnimation, classicAnimation, fluidSpringAnimation, transition, arcTransition, keyframes |
| ARITHMETIC | `["number", "point", "point3d", "point4d", "size"]` | subtract, multiply, divide, modulo, power, squareRoot, absoluteValue, min, max, length |
| ADDABLE | `["number", "point", "point3d", "point4d", "size", "text"]` | add (text is joined) |
| ORDERED | `["number", "index", "boolean"]` | greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual |
| EQUATABLE | `["number", "boolean", "text", "color", "point", "point3d", "point4d", "size", "anchor", "index", "enum", "json"]` | equalsExactly, optionEquals, pulseOnChange, loopDedupe, ifElse |
| VALUE | EQUATABLE + `["image", "video", "sound", "gradient", "shape", "layerEffect", "layer"]` | splitter, delay, delay1, sampleAndHold, optionPicker, optionSender, loopBuilder, variableBroadcaster, loop mutations, watch |

- **Defaults for other variants.** A variant port's `default` applies to the first variant. When the zero value would be unhelpful for another variant (a color transition should run white to black), set `variantDefaults`, e.g. `{ "color": { "start": "#FFFFFFFF", "end": "#000000FF" } }`. Otherwise the engine uses the zero value:
  - number and index: `0`
  - boolean: `false`
  - text: `""`
  - color: `"#00000000"`
  - vectors: all zeros
  - enum: the first option
  - everything else: `null`
- **Vectors.** Animations and arithmetic on vector variants work component-wise.
- **Colors.** Colors interpolate in straight RGBA (gap-fill R12) unless the patch documents otherwise.
- **Loops, muting, and coercion** work the same for every variant.

---

## 9. Variadic ports

- **When to use it.** Use `variadic` when people add or remove repeated inputs: Add, And, Option Picker, Loop Builder, Shape Union.
- **Expansion.** Expanded keys are `${key}${n}` and expanded names are `${name} ${n}`.
- **◆ `startIndex`** is `0` or `1` (default `1`). Use `0` when the n-th port corresponds to a 0-based index:
  - option values (`option0…`)
  - loop items
  - Option Switch's `setTo0…`
  Otherwise use `1` (`value1`, `value2`).
- **◆ `direction`** is `"inputs"` or `"outputs"` (default `"inputs"`). Option Sender's per-option outputs are variadic outputs.
- **Counts.** `min` is at least 1, and `max` is at most 32 unless you justify more. Set `defaultCount` to Origami's default port count when known.
- **No collisions.** No expanded key, up to `max`, may equal a fixed port key.
- **Repeated groups** don't fit `VariadicSpec`, for example a color plus a location per gradient stop. Take whole loops instead (`colors` and `locations`, `wholeLoop: true`), or use `dynamicPortsRule`.
- **Until the contract changes.** `startIndex` and `direction` are catalog extensions (§19.1). Until the contract has them, implement those patches with `dynamicPorts`.
- **In examples,** write the count after the type: `patch total add[3] value1←a.output value2=10 value3=5`.

---

## 10. Settings and dynamic ports

**Settings.** Configuration that isn't a port lives in `PatchNode.settings`. Declare each settings key in ◆ `settings`.

A setting is authoring-time configuration that changes a patch's identity or shape:
- a variable's name and scope;
- a math expression;
- a script file name.

A value someone might animate or wire belongs on a port, never in a setting.

**Dynamic ports.** Some patches derive their ports from settings or from other documents: `javascript`, `mathExpression`, `component`, `variableReceiver`. For these:
- describe the derivation in ◆ `dynamicPortsRule`;
- list any static ports in `inputs` and `outputs`;
- code generation turns the rule into a `dynamicPorts` function;
- the validator skips port-key checks in examples for these patches.

In examples, settings appear as `key="…"` tokens on the patch line, e.g. `patch area mathExpression expression="width * height"`.

---

## 11. Shared enums and shortcuts

### 11.1 CURVE

Every easing enum uses these options in this order. The formulas (Penner easing) are in semantics.md §7.8.

```json
[
  { "key": "linear", "name": "Linear" },
  { "key": "quadraticIn", "name": "Quadratic In" },
  { "key": "quadraticOut", "name": "Quadratic Out" },
  { "key": "quadraticInOut", "name": "Quadratic In & Out" },
  { "key": "cubicIn", "name": "Cubic In" },
  { "key": "cubicOut", "name": "Cubic Out" },
  { "key": "cubicInOut", "name": "Cubic In & Out" },
  { "key": "exponentialIn", "name": "Exponential In" },
  { "key": "exponentialOut", "name": "Exponential Out" },
  { "key": "exponentialInOut", "name": "Exponential In & Out" },
  { "key": "sinusoidalIn", "name": "Sinusoidal In" },
  { "key": "sinusoidalOut", "name": "Sinusoidal Out" },
  { "key": "sinusoidalInOut", "name": "Sinusoidal In & Out" }
]
```

When the evidence doesn't settle a default, use `quadraticInOut`, the legacy Classic Animation default, and note it in `defaultNotes`.

**Rules for every enum:**
- Option keys are camelCase; option names are Title Case.
- Options follow Origami's order when it's known.
- The default is the first option unless `defaultNotes` explains another choice.

### 11.2 Single-key shortcuts

Only these patches carry `shortcut`. The values match Origami's patch-editor keys. New shortcuts need the editor team's approval.

| Shortcut | Patch | Shortcut | Patch | Shortcut | Patch |
|---|---|---|---|---|---|
| `I` | interaction | `O` | optionPicker | `/` | divide |
| `S` | switch | `X` | splitter | `%` | modulo |
| `A` | popAnimation | `W` | variableBroadcaster | `Shift+A` | and |
| `C` | classicAnimation | `Shift+W` | variableReceiver | `Shift+O` | or |
| `T` | transition | `U` | pulse | `Shift+N` | not |
| `K` | keyboard | `+` | add | `E` | equals |
| `D` | delay | `-` | subtract | `>` | greaterThan |
| `Shift+I` | optionSwitch | `*` | multiply | `<` | lessThan |
| `Shift+R` | progress | `R` | reverseProgress | | |

---

## 12. Categories

Put a patch where a designer would look first, based on what it's for, not how it's built or where Origami's sidebar files it. For example, Transition is `animation` (the T in ISAT), even though Origami files it under Utility.

| Key | Picker label | What belongs |
|---|---|---|
| `interaction` | Interaction | Pointer, touch, keyboard, and gesture input on layers or the screen; scroll and drag physics. |
| `animation` | Animation | Values moving over time and progress reshaping: springs, tweens, curves, transitions, smoothing, velocity, spring converters. |
| `state` | State & Time | Memory and timing: switches, counters, options, pulses, delays, timers, clocks. |
| `logic` | Logic | Boolean logic, comparisons, and choosing between values. |
| `math` | Math | Arithmetic, rounding, ranges, snapping, trigonometry, expressions, randomness. |
| `loops` | Loops | Creating, reading, reshaping, and combining loops. |
| `text` | Text | Measuring, searching, and editing text; formatting numbers and dates. |
| `color` | Color | Building and converting colors and gradients. |
| `data` | Data & Network | JSON objects and arrays, data files, HTTP, WebSockets, encoding. |
| `device` | Device | Device information, sensors, haptics, speech, hardware. |
| `media` | Media | Image, video, and sound assets and playback; camera and microphone; detection on images. |
| `shapes` | Shapes | Vector shapes for Shape layers. |
| `layers` | Layers & Effects | Reading layer geometry, converting coordinates, producing layer effects. |
| `utility` | Utility | Plumbing: pass-through, variables, pack and unpack, debugging, prototype control. |
| `components` | Components | Patch component instances. |
| `scripting` | Scripting | Code patches. |

**Origami categories → Sonobe (defaults and exceptions):**

- Animation, Color, Data, Interaction, Logic, Loops, Math, Media, Shapes, and Text map to the same-named Sonobe category.
- **Device** maps to `device`. Exceptions: Sound Player, Microphone, and Camera go to `media`.
- **Utility** is split by purpose:
  - `animation`: Transition, Progress, Reverse Progress, Arc Transition, Velocity
  - `state`: Switch, Counter, Pulse, Pulse on Change, When Prototype Starts, Sample and Hold, the Option patches, Delay, Delay 1, Wait, Repeating Pulse, Time, Stopwatch
  - `math`: Clip (as Clamp), Random
  - `text`: Date & Time Formatter
  - `media`: Image, Video, Image Info, Video Info, Snapshot, and the detection patches
  - `shapes`: JSON to Shape
  - `layers`: Layer Info, Convert Position
  - `scripting`: JavaScript Patch
  - `utility`: Splitter, the variables, pack and unpack, Restart Prototype
- **Layer** entries are layer types, not patches (§18.4). The one exception is the Layer Effects family, which goes to `layers`.
- **Material and iOS** entries are platform UI-kit components, not patches.

---

## 13. Tiers

**Tier 1: MVP.** A patch is tier 1 if any of these holds:
- it's part of the ISAT core;
- ARCHITECTURE.md §6 lists it as tier 1;
- a canonical recipe needs it (table below);
- it's a Sonobe-native learnability patch built on tier-1 behavior.

A tier-1 patch must be `supported` and needs at least 1 example and 1 common mistake. Its implementation ships with golden tests.

**Tier 2: breadth.** Data and network, device info and motion, text, color, the remaining loops, shapes, effects, media assets and playback, spring converters, and advanced gestures. A tier-2 patch may be `web-limited`.

**Tier 3: hardware, ML, and platform-specific.** Camera, microphone, detection, haptics, location, game controllers, Bluetooth, orientation lock, glass. Tier-3 patches get full specs anyway so imported files keep their wiring. They may be `unsupported-web`.

**Canonical recipes (ARCHITECTURE.md §11) and the tier-1 patches they use:**

| Recipe | Patches |
|---|---|
| Tap to zoom | interaction, switch, popAnimation, transition |
| Toggle / like | tapToggle or interaction + switch, doubleTap, popAnimation, transition, delay |
| Scrolling list | scroll, loop, loopBuilder |
| Carousel | scroll, progress, transition, clamp, snap, loopSelect |
| Tab bar | interaction, loopOptionSwitch, optionSwitch, optionPicker, equalsExactly, popAnimation, transition |
| Collapsing header | scroll, remap, clamp, transition |
| Pull to refresh | scroll, lessThan, switch, wait, repeatingAnimation, transition |
| Bottom sheet | gesture, springAnimation, greaterThan, switch, clamp, transition, springPreset |
| Drag and snap | drag or gesture, velocity, snap, springAnimation |
| Swipe cards | gesture, swipe, springAnimation, counter, transition, absoluteValue |
| Long-press menu | interaction, longPress, switch, popAnimation, transition |
| Timed sequence | whenPrototypeStarts, delay, wait, repeatingPulse, counter, classicAnimation |
| Stories | interaction, counter, wait (progress), classicAnimation, loop, greaterThan, formatNumber |
| Onboarding | scroll, counter, optionPicker, ifElse, transition |
| Grid with loops | loop, loopBuilder, interaction, loopOptionSwitch, loopAny, sampleAndHold, equalsExactly |

---

## 14. Status and platforms

| Status | Meaning | Required fields |
|---|---|---|
| `supported` | Works the same in the desktop app (Electron), the web player on desktop and mobile browsers, and headless simulation. A missing input device (no hover or physical keyboard on a phone) doesn't count against it; the docs say so instead. | Omit `statusReason` and `platforms`. |
| `web-limited` | Works only on some platforms or browsers, or needs a permission, a user gesture, a secure context, or special hardware. | `statusReason` names the API and the gap (e.g. "Web Bluetooth ships only in Chromium browsers; iOS Safari has none."). `platforms` lists where it works. |
| `unsupported-web` | The current stack can't implement it: there's no web API, or it needs a model or dependency we don't ship. It still loads from imported files, outputs idle values, sets `available` to false, and raises one info diagnostic. | `statusReason`, and `platforms: []`. |

**Platforms:**
- `desktop`: the Electron app's viewer.
- `web`: the web player in desktop browsers.
- `mobile`: the web player on phones and tablets.

**Headless simulation** (`deterministic` runtime):
- Sensor patches read simulated input from `InputEvent`s where an event kind exists (`deviceMotion`, `orientation`). Otherwise they output idle values deterministically.
- Side-effect patches never perform effects: no sound, speech, haptics, URL opening, or permission prompts. They log through `ctx.services.log("log", …)` instead.
- Network patches go through `ctx.services.platform.fetch`, which a host may stub.
- **Audio is always silent in automated runs.**

---

## 15. Defaults policy

1. **Verified Origami default** (current docs, release notes, or strings from official files): use it.
2. **Legacy default** (the archived Quartz Composer macros): use it unless it's clearly unfriendly.
3. **Unknown:** pick a value that makes the patch do something visible and sensible the moment it's wired to a layer, with no surprising motion or side effects.
   - Endpoints and ranges: `0` → `1`.
   - Durations:
     - `0.3` s for tap timing
     - `0.5` s for presses and animations
     - `1` s for repeats and timers
   - Geometry:
     - sizes `[100, 100]`
     - radii `50`
     - positions `[0, 0]`
     - touch slop 10 pt
   - Counts: loops default to `3`; variadic `defaultCount` is 2, or 3 for option patches.
   - Second operands use the operation's identity where one exists (add `0`, multiply `1`, divide `1`, power `1`). Where there's no identity, choose a value that shows the operation working.
   - Colors from builders default to opaque: alpha `1`.
   - Side-effect patches never act when inserted: `playing` false, `connect` false, no autoplay. Capture patches (Camera, Microphone) default `enabled` to `false`, so inserting one never turns on a camera or a microphone.
   - `enabled` defaults to `true`.
4. **Never choose a default that makes the patch fail:** no division by zero, no zero-width range, no empty required URL that errors on every frame.
5. **Flag every default that isn't verified** in `defaultNotes`. Each value starts with a source prefix, a colon, and a short reason:
   - `legacy:` from the Quartz Composer macros.
   - `inferred:` from tutorials, example files, or research without an authoritative source.
   - `sonobe:` our own choice.
   - `verified:` optional; a source reference.

   ```json
   "defaultNotes": {
     "duration": "sonobe: Origami's default is undocumented; 0.5 s is visible without feeling slow.",
     "curve": "legacy: Classic Animation.qtz used index 3, Quadratic In & Out."
   }
   ```

---

## 16. Behavior: the implementer spec

`behavior` is where an engineer who has never used Origami learns exactly what to build. Write it against the engine contract: `ctx.input`, `ctx.inputItems`, `ctx.isConnected`, `ctx.pulsed`, `ctx.changed`, `ctx.output`, `ctx.pulse`, `ctx.requestNextFrame`, `ctx.state`, `ctx.dt`, `ctx.time`, and `ctx.services`.

Use this shape, and include every item that applies:

```
State per loop index: { … }            (or: Stateless.)
Each frame:
  <pseudo-code>
- Pulses: …
- Frame 0: …
- Loops: …
- Retargeting: …
- Edge cases: …
- Disabled: …
- Muted: …
- Async: …
- Platform and simulation: …
- Restart and dispose: …
- Coming from Origami: …
```

**16.1 State.** Give the state shape per loop index, or say "Stateless." Every stateful patch keeps separate state for each loop index. When a loop shrinks, removed indices drop their state. When it grows, new indices start fresh.

**16.2 Frame 0** (gap-fill R1). Evaluate with authored values. Patches that compare against the previous frame (velocity, delay1, pulseOnChange, smoothValue, delay) seed that history with the first value, so there are no startup spikes and no false pulses. Animations start *at* their first target and don't animate from 0.

**16.3 Pulses.**
- Name every pulse input and give the same-frame precedence.
- A pulse input fires on an upstream pulse **or** a false→true edge of a connected boolean (`ctx.pulsed`). Holding `true` fires once.
- Pulses on consecutive frames each count.
- Pulse outputs use `ctx.pulse` and last exactly one frame.

**16.4 Loops.**
- By default, the patch evaluates once per loop index. The output length is the longest input loop; shorter loops wrap and scalars broadcast.
- Ports marked `wholeLoop` receive or produce whole loops, and the patch's state is per instance.
- Say so if the output length follows a different rule, such as Loop Filter.
- Empty loops produce empty outputs.

**16.5 Time.**
- Use `ctx.dt` and `ctx.time`, never frame counts, unless the patch is defined per frame (`delay1`).
- Results must match at 60 and 120 fps. State any compensation, e.g. smoothValue uses `h^(dt·60)`.
- Physics uses 1 ms RK4 substeps with `dt ≤ 0.064` (semantics.md §7.5).

**16.6 Retargeting.** Say what happens when an input changes mid-flight: animations, delays, timers, requests.

**16.7 Edge cases.**
- Never output NaN or ±Infinity. Output `0` and warn once per restart through `ctx.services.log("warn", …)`.
- Cover each of these that applies:
  - division by zero
  - zero-width ranges (§18.5)
  - negative durations (treat as `0`, which means instant)
  - `min > max`
  - out-of-range indices (§18.5)
  - a missing layer
  - empty text or JSON
  - a JSON lookup that finds the wrong type (output the zero value)

**16.8 Evaluation.**
- Set `alwaysEvaluate: true` for patches whose outputs change without input changes: clocks, animations in flight, gestures, sensors, async work.
- Call `ctx.requestNextFrame()` while something is still moving or pending.
- The v1 engine evaluates every patch on every frame anyway; the field documents intent and enables later dirty tracking.

**16.9 Disabled and muted.**
- **Disabled** (`enabled` false): the patch outputs idle values and keeps its state, unless the behavior says otherwise.
- **Muted** (default bypass):
  - each output passes through the first input of the same type (variant ports match variant ports);
  - outputs with no matching input emit their zero value;
  - pulse outputs never fire, and side effects never run.

  Write a "Muted:" line only when your patch differs from this default.

**16.10 Async and side effects.**
- **Async work** (network, file, media, permissions):
  - start it on a pulse or a state edge;
  - store its promise's result in `state`;
  - call `requestNextFrame()` while it's pending;
  - apply the result on a later `evaluate`.
  - Never call `ctx.output` from a callback. Ignore results from requests that a newer request has replaced.
- **Side effects** fire only on pulses or edges, at most once per frame per index.

**16.11 Determinism.**
- Randomness comes from `ctx.services.random()`.
- Clocks come from `ctx.time` or `ctx.services.now()`.
- Never use `Math.random`, `Date.now`, or `performance.now`.

**16.12 Restart and dispose.** Say what restart resets. Say what `dispose` releases: sockets, audio, media streams, timers.

---

## 17. Docs writing style

**Voice.**
- Second person, present tense, active voice, American English.
- Plain words first; explain jargon the first time it appears ("a pulse, a signal that's on for one frame").
- No "simply", "just", "easy", or "obviously". No emoji.
- Name Origami only in "Coming from Origami" sections and mapping fields.

**17.1 `summary`.** One sentence of at most 140 characters, ending with a period.
- Start with a verb in the third person: "Animates…", "Remembers…", "Turns…".
- Say what the patch is for, not how it's built.
- Don't mention Origami.

**17.2 `docs`.** Markdown without a top-level heading, since the patch name renders above it. Use these sections in order:
1. `## How it works` (required): the mental model in a sentence or two, then one sentence or bullet for each important port.
2. `## Tips` (optional): two to four practical bullets.
3. `## Coming from Origami`: only when names, ports, defaults, or behavior differ.

Stay under about 250 words, and don't repeat `commonMistakes` or `examples`.

**17.3 Port `description`.** One sentence per port.
- Include units and range, and what the extremes do ("0 means no bounce.").
- Pulses start with "Pulse to…". Booleans say what happens when on.
- For layer-derived outputs, say they come from the previous frame (gap-fill R2).

**17.4 `aliases`.** 3 to 10 lowercase search terms. Include:
- Origami's display name when it differs;
- former Origami names (`multiplexer`, `wireless broadcaster`);
- designer words (`toggle`, `tween`, `ease`);
- programmer words (`if statement`, `lerp`, `clamp`).

Don't repeat the name, and don't use ids.

**17.5 `commonMistakes`.** 1 to 4 items, each one or two sentences: the symptom, then the cause, then the fix. Example: "The layer springs back when you lift your finger: Down is a state that turns off on release. Wire Tap into Flip when the change should stay."

**17.6 `examples`.** 1 to 3 items using the outline notation from ARCHITECTURE.md §10:
- `layer <id> <type> "<Name>" [@x,y] [WxH] [prop←patch.port] [prop=literal]`
- `patch <id> <type>[<variant>][[count]] [port←patch.port] [port=literal] [port=@layerId]`
- Use snake_case ids and realistic values.
- Declare every layer you reference.
- Use only types from `index.json` and port keys that exist on those patches.
- Titles describe an outcome ("Tap to toggle a heart").
- Include a `description` when the example needs context.

---

## 18. Inclusion decisions

`census-decisions.json` has the decision and reason for all 263 census rows. This section summarizes those decisions and the rules that follow from them.

### 18.1 Sonobe-native patches (`origami: null`)

| Type | Why it earns a place |
|---|---|
| `swipe` | Swipe is a standard recognizer (ARCHITECTURE.md §5.5). Without it, swipe cards need Gesture plus threshold and direction logic. |
| `tapToggle` | Interaction and Switch in one patch, for the most common first interaction. Its docs point to the two-patch version for more control. |
| `springPreset` | Named feels (Smooth, Snappy, Bouncy, Gentle) that output every spring parameterization, so people choose a feel instead of tuning numbers (ARCHITECTURE.md §5.3; learning-painpoints §5.5). |
| `keyframes` | Maps progress through several stops to values: the After Effects mental model, and Origami's legacy multi-stop Progress. |
| `ifElse` | People search for "if". Origami's answer, a two-option Option Picker, is hard to discover. |
| `inRange` | "Is this between A and B?" otherwise takes two comparisons and an And (the community "Between" component). |
| `remap` | Maps a value from one range to another, replacing the Progress → Transition pair that most scroll-linked effects need. |
| `snap` | Snaps to the nearest step or point, with optional velocity projection, for carousels and drag-and-snap (the community "Snap to points" component). |
| `loopAll` | The counterpart to Any. |
| `formatNumber` | Turns numbers into display text (decimals, prefix and suffix, separators) for counters, prices, and page labels. |
| `textContains` | Search filters. Origami only has starts-with and ends-with. |
| `lineShape` | Straight lines for dividers, charts, and progress tracks. |
| `svgPathShape` | Paste an SVG path from Figma or an icon set into a Shape layer. |
| `colorControlsEffect` | Brightness, contrast, saturation, and hue as a layer effect (`LayerEffectValue` kind `colorControls`). The names of Origami's v221 effects aren't published. |
| `watch` | Shows a value inline and in the console without wiring a Text layer (learning-painpoints §7.13). |

`component` maps to Origami's patch-component concept, which has no census row, so its `origami` is `{ "name": "Patch Component" }` with no `id`.

### 18.2 Merges

| Origami patch | Becomes |
|---|---|
| Scroll Settings | advanced inputs on `scroll` |
| Drag Settings | advanced inputs on `drag` |
| Sound Player Settings | advanced inputs on `soundPlayer` |
| Haptic Player, Trackpad Haptic | Type options on `haptic` |
| Photo Library Media | outputs on `photoPicker` |
| Option Equals (Legacy) | `optionEquals`, with current semantics (−1 when nothing matches) |
| Layer Effect family | `blurEffect` (plus the native `colorControlsEffect` and `glassEffect`) |

### 18.3 Renames and category moves

**Renames:**
- `+ − × ÷ √ Mod` → Add, Subtract, Multiply, Divide, Square Root, Modulo
- Clip → Clamp
- Trim Text → Substring
- Text Transform → Change Case
- Text Size → Measure Text
- Date & Time Formatter → Format Date & Time
- Index Of → Array Index Of
- Encode / Decode → Base64 Encode / Base64 Decode
- Data File → JSON File
- Keyboard Info → Soft Keyboard
- Photo Library → Photo Picker
- Delay 1 → Delay One Frame
- Vec4 / Vec4 Unpack → Point 4D / Point 4D Unpack
- Corner Radius → Corner Radii
- Union → Shape Union
- Circle, Oval, Rounded Rectangle, Triangle → Circle Shape, Oval Shape, Rounded Rectangle Shape, Triangle Shape
- Loop Insert at End → Loop Append
- JavaScript Patch → JavaScript
- Liquid Glass → Glass Effect

**Key-only changes** (the display name stays): Any → `loopAny`; Image → `imageAsset`; Video → `videoAsset`.

Category moves are listed in §12.

### 18.4 Exclusions (details in `census-decisions.json`)

- **Layer types, not patches** (all Layer, iOS, and Material rows):
  - Rows with a Sonobe layer type map to it: `clone`, `colorFill`, `gradient`, `group`, `hitArea`, `image`, `lottie`, `oval`, `rectangle`, `shader`, `shape`, `text`, `video`, `textField`.
  - Rows without one are deferred: Map, Particle System, Progress Ring, Shimmer, Live Image, Video Keyframes, Video Stream, Viewfinder, Reflective Layer, Sublayer Container, Virtual Sublayer.
  - Platform UI-kit components are replaced by neutral recipes.
- **Structural nodes:** Comment (a document comment), Component Input/Output (the component interface), layer property and output patches (direct `@layer.prop` links).
- **Superseded:**
  - Mouse Cursor → the layer Cursor property
  - Text Input Info → Text Field layer outputs
  - JSON to Lottie → the Lottie layer accepts JSON
  - Spacing and Spacing Unpack → layout spacing is one number
  - Settings JSON → ordinary inputs
- **Deprecated in Origami:** Scrollaway, Fake Keyboard (iOS and Material).
- **Not possible or not ours to ship:**
  - Trackpad (no raw trackpad touches in Chromium)
  - Device Buttons (no reliable Android back button on the web)
  - Browser Buttons and Browser Chrome (viewer framing)
  - Photo Albums (no album enumeration on the web)
  - Sound Kit (Meta's sound library)
  - Facebook Login (Meta-internal)
- **Deferred behind contract changes (§19):** Text Style, Text Style Builder, Variable Font builder.

### 18.5 Semantics directives

These decisions cut across chunks. Every behavior must follow them.

1. **Taps and pointers.**
   - `tap` fires on release after less than 10 pt of movement.
   - On the tap frame, `position` holds the last touch position; it doesn't reset to 0 as in Origami (ARCHITECTURE.md §5.5).
   - Touches bubble to ancestor layers.
   - Pointer positions are prototype coordinates. `drag`, `scroll`, and `gridLayout` positions are in the target layer's parent space.
2. **Precedence.**
   - Switch-like patches: `turnOff` > `turnOn` > `flip`.
   - `counter`: `jump`, then `increase − decrease`.
   - `counter` `maximumCount ≤ 0` means unconstrained. Otherwise the count wraps within `[0, maximumCount − 1]` (semantics.md §5.4).
3. **Springs.**
   - **`popAnimation`** runs Rebound's BouncyConversion → OrigamiValueConverter, mass 1, RK4 with 1 ms substeps, rest threshold 0.001. Retargeting keeps velocity. The first value starts at rest without animating (semantics.md §7.2–§7.6).
   - **`springAnimation`**: `tension` and `friction` are raw *k* and *c*, and `mass` defaults to 1. While `gestureActive` is true, the spring tracks the target. When it falls, `gestureVelocity` (points/second) becomes the initial velocity.
   - **`fluidSpringAnimation`** and `response`/`dampingFraction` ports: `k = (2π / response)² · mass` and `c = 4π · dampingFraction · mass / response`.
   - **`springPreset`**, **`springConverter`**, and **`bouncyConverter`** must agree with these formulas exactly. Patches that output Bounciness and Speed (`springPreset`, `springConverter`) use `springPreset`'s `popCompatible` rule, so one spring maps to one Pop feel everywhere.
4. **Tweens.**
   - `classicAnimation`: a new target starts a fresh tween from the current value over the full duration (ARCHITECTURE.md §5.3, gap-fill R11). The first value doesn't animate.
   - Colors interpolate in straight RGBA.
5. **Timing.**
   - **`delay`** uses a time-stamped queue, not frame counts. Its styles follow semantics.md §5.6: "When Increasing" delays rises and lets falls through at once.
   - **`wait`** has inputs `start`, `reset`, and `duration`, and outputs `done`, `progress`, and `finished`:
     - `done` is false from `start` until `duration` elapses, then latches true until the next `start` or `reset` (gap-fill R7);
     - `progress` runs 0 → 1 over the duration;
     - `finished` pulses on completion.
   - **`longPress`**: held and stationary within 10 pt for `duration` (default 0.5 s) (gap-fill R6). The output is a state.
   - **`doubleTap`**: `interval` defaults to 0.3 s. `doubleTap` pulses on the second tap within the interval. `singleTap` pulses when the interval after a lone tap ends.
6. **Previous-frame patches.**
   - `velocity` outputs units **per second**, `(value − previous) / dt`, and 0 on frame 0. Origami's Velocity is a per-frame difference; say so in "Coming from Origami".
   - `smoothValue` compensates for frame rate with `h^(dt·60)`. `fallingHysteresis = −1` means "use rising".
7. **Momentum** (`scroll`, `drag` momentum, `momentumScrolling`) uses POP decay:
   - 0.998 per ms for "normal", 0.99 for "fast";
   - a rubber band outside the bounds;
   - `endBoundary` defaults to 99999 (ARCHITECTURE.md §5.3, gap-fill R8).
8. **Layer-derived outputs.** `layerInfo`, content sizes, and media times from layers reflect the **previous frame** (gap-fill R2).
9. **Ranges and indices.**
   - A zero-width range (`start == end`) acts as a step: `progress` outputs 1 when `value ≥ start` and 0 otherwise, and `remap` outputs `toEnd` or `toStart` the same way.
   - Option patches clamp `option` to the valid range.
   - Array and loop lookups out of range output the zero value (`loopSelect` skips the item).
   - Negative indices never count from the end.
10. **Variables** resolve statically by name and scope, and the nearest global ancestor wins. They compile to implicit edges (semantics.md §10). Settings: `name`, and `scope` (`local` | `global`).
11. **Scripting.** `javascript` loads `scripts/<file>.js` (setting `script`). `mathExpression` keeps its text in setting `expression`: free identifiers become number inputs, and `name = expr` statements separated by `;` become outputs (semantics.md §11.4).
12. **Components.** A `component` patch instance keeps its own state per instance and per loop index. Its ports come from the component's interface, including `loopBehavior`.

---

## 19. Open contract questions

These are workarounds for gaps in the current contract. Each has a proposed change for the contract owners.

1. **`VariadicSpec` has no start index or direction.** The option patches need 0-based keys, and Option Sender needs variadic outputs.
   - Proposed addition to `packages/core/src/types.ts` `VariadicSpec`:
     ```ts
     /** First expanded index: 0 when ports map to 0-based options or loop items. Default 1. */
     startIndex?: 0 | 1;
     /** Which side repeats. Default "inputs". */
     direction?: "inputs" | "outputs";
     ```
   - Workaround: catalog fields, implemented with `dynamicPorts`.
2. **`PatchSpec` doesn't declare `PatchNode.settings`.**
   - Proposed: `settings?: SettingSpec[]`, with `SettingSpec` as in §3.2, so MCP `add_patches` can validate settings and the inspector can render them.
   - Workaround: the catalog `settings` field.
3. **Tier and status aren't part of `PatchSpec`.**
   - Proposed: `tier?: 1 | 2 | 3` and `status?: { level: "supported" | "web-limited" | "unsupported-web"; reason?: string }`, so the picker can rank patches and MCP can report platform limits honestly.
   - Workaround: catalog-only fields.
4. **No per-variant defaults.**
   - Proposed: `PortSpec.variantDefaults?: Partial<Record<ValueType, Value>>`.
   - Workaround: the catalog `variantDefaults` field, applied by `definePatch` modules.
5. **`RuntimeServices` can't measure text, but `measureText` needs to.**
   - Proposed:
     ```ts
     measureText(text: string, style: { fontFamily: string; fontSize: number; fontWeight: number; letterSpacing: number; lineHeight: number }, maxWidth: number | null): { width: number; height: number };
     ```
     It reuses the injected `TextMeasurer`.
   - Workaround: approximate metrics.
6. **Patches can't read layer outputs** (a video's `currentTime` and `duration`, an image's `naturalSize`). `LinkInput` only references patch outputs.
   - Proposed: `RuntimeServices.layerOutput(layer: LayerRef, key: string): Value | undefined`, or allow `"@layerId.outputKey"` links.
   - Workaround: `videoInfo` outputs zeros where the host exposes nothing.
7. **`PlatformServices` lacks media capture, geolocation, gamepads, Bluetooth, WebSockets, and a file picker.**
   - Proposed optional members: `media?`, `geolocation?`, `gamepads?`, `bluetooth?`, `webSocket?`, `pickFile?`.
   - Workaround: those patches output `available: false` when the service is missing.
8. **No rich text ranges.**
   - Proposed: range fields on `TextStyleValue` (`rangeStart`, `rangeLength`) and a `styles` prop (`textStyle`, `wholeLoop`) on the Text layer.
   - This unblocks Text Style and Text Style Builder (§18.4).
9. **Outline notation for variadic counts and settings** isn't in ARCHITECTURE.md §10.
   - Examples use `type[N]` and `key="…"` tokens.
   - If core's outline projection chooses another notation, update the examples mechanically.

---

## 20. Checklist before handing off a chunk

- [ ] `node packages/patches/catalog/validate.ts <file>` reports no errors.
- [ ] `npx vitest run packages/patches` passes, including the cross-patch consistency tests and the README counts.
- [ ] Entries are in `index.json` order, and `type`, `name`, `category`, and `tier` match `index.json`.
- [ ] Every port key follows §6 and is unique within its patch across inputs and outputs.
- [ ] Every non-pulse input has a `default` in §7 encoding, and every default that isn't verified appears in `defaultNotes`.
- [ ] `variants` copy a named set from §8, and `variadic` follows §9.
- [ ] `behavior` covers each applicable item in §16, including pulse precedence, frame 0, loops, and edge cases.
- [ ] `status` is set, and a non-supported status has a `statusReason` and `platforms`.
- [ ] The summary is one sentence of at most 140 characters; the docs start with `## How it works`.
- [ ] Examples use only real types and port keys; `pairsWellWith` uses real types.
- [ ] `origami`, `importAliases`, and `origamiPorts` cover every Origami identifier and renamed port.
