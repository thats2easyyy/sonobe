# Knobs and presets

A **knob** is a value the person tunes while the prototype runs: a commit distance, a spring's bounciness, a tilt per point. It's a number, on/off, color, choice (enum), point or text, with a name, a soft range and a unit, in a group. Any patch input or layer property reads a knob through an ordinary link, `{ "link": "$knob.grow_bounce" }`, and behaves exactly like the literal it holds.

A **preset** is one column of knob values: every preset has a value for every knob, and one preset runs. Switching presets changes the running prototype live, without a restart. Lock a preset to keep it as a reference. Knobs and presets live in `knobs.json`, next to `project.json`.

Related: `graph-basics`, `animation`, `simulation`

## Rules

- **Knobs, not names.** Build the numbers a person will want to tune or compare as knobs. Don't share them through Variable Broadcasters, and never put reference values in names ("Commit Distance (app: 95)").
- **A reference and a proposal.** Make a locked reference preset ("Shipped app") and a working one ("Proposal"). Every difference between them must be a knob value.
- **Differences in kind are knobs too.** When the reference behaves differently rather than by a different amount (the shipped card never flies out), add an on/off knob that picks between the two with an Option Picker, so flipping presets flips the behavior. `examples/16-placemark-deck` does all of this for a swipe deck.
- **Ranges a finger would use.** Leave out min and max and `set_knobs` works out a range from the value and the port (95 → 0…200, step 1), then says so. Group knobs in the order the gesture happens.
- **Compare in simulations.** Run one `sim_reset` per preset (`"preset": "Shipped app"`) and trace the same gesture in both before you report a difference. Simulations never change the person's document.
- **Ask before switching.** `apply_knob_preset` changes what the person's viewer and phone show. Do it when they ask.
- **The person's side.** They tune knobs in the Inspector's Knobs tab (⌘5), flip between the running preset and the one before it with ⌘', and turn any field into a knob with Make Knob. Point them there instead of asking them to edit patches.

## Example: a card that grows, with a shipped reference

The card and its tap-to-grow logic:

```json tool:add_layers
{ "layers": [{ "type": "rectangle", "name": "Card", "props": { "position": [22, 300], "size": [358, 220], "cornerRadius": 24 } }] }
```

```json tool:add_patches
{
  "patches": [
    { "ref": "tap", "type": "interaction", "name": "Tap Card", "inputs": { "layer": { "layer": "card" } } },
    { "ref": "grown", "type": "switch", "name": "Card Grown", "inputs": { "flip": { "link": "$tap.tap" } } },
    { "ref": "spring", "type": "popAnimation", "name": "Grow Spring", "inputs": { "number": { "link": "$grown.on" }, "speed": 12 } },
    { "ref": "scale", "type": "transition", "name": "Card Scale", "inputs": { "progress": { "link": "$spring.output" }, "start": 1, "end": 1.08 } }
  ],
  "connections": [{ "from": "$scale.output", "to": "@card.scale" }]
}
```

One `set_knobs` call makes both presets, two knobs that read into the graph, and locks the reference last, after it's filled. A new knob takes its type and value from the first input it connects to unless you give them:

```json tool:set_knobs
{
  "presets": [{ "name": "Proposal" }, { "name": "Shipped app", "locked": true }],
  "knobs": [
    { "name": "Grow Bounce", "group": "Grow", "connect": ["grow_spring.bounciness"], "values": { "Proposal": 8, "Shipped app": 5 } },
    { "name": "Grow Size", "group": "Grow", "value": 1.08, "min": 1, "max": 1.5, "step": 0.01, "unit": "×", "connect": ["card_scale.end"] }
  ],
  "label": "made the grow feel tunable"
}
```

The outline shows the knob block first, and each reader as a link:

```text outline
knobs 2 · running proposal "Proposal" · presets proposal "Proposal", shipped_app "Shipped app" locked
patch card_scale transition<number> "Card Scale" progress←grow_spring.output start=1 end←$knob.grow_size
```

Read every knob, its values per preset and how many inputs read it, plus what differs between the running preset and the next:

```json tool:get_knobs
{}
```

Tune the running preset (value works on its own only while a project has one preset, so name the preset):

```json tool:set_knobs
{ "knobs": [{ "id": "grow_bounce", "values": { "Proposal": 10 } }] }
```

A locked preset refuses edits, which keeps the reference what the shipped app does:

```json tool-error:set_knobs
{ "knobs": [{ "id": "grow_bounce", "values": { "Shipped app": 7 } }] }
```

## Comparing presets

Simulate the reference without touching the person's viewer, then read or trace it:

```json tool:sim_reset
{ "preset": "Shipped app" }
```

```json tool:sim_get_values
{ "simId": "sim_1", "targets": ["$knob.grow_bounce", "grow_spring.bounciness"] }
```

Run a second `sim_reset` with `"preset": "Proposal"`, send both the same `sim_dispatch` tap, and compare `sim_trace` summaries of `@card.scale`. To try a value inside one simulation, pass `"knobs": { "grow_bounce": 12 }` to `sim_reset` (with its `simId` and `keepOverrides: true`, the value runs over the session's preset), or `sim_override` with a `setKnobValue` op.

When the person asks to see the reference on their phone:

```json tool:apply_knob_preset
{ "preset": "Shipped app" }
```

## Turning Variable Broadcasters into knobs

Prototypes sometimes share constants through a Variable Broadcaster and its receivers. `convertVariables` turns each named broadcaster with a constant value into a knob: every input its receivers drove reads the knob instead, and the broadcaster and receivers go. A broadcaster driven by a live signal (a scroll position) stays a variable.

```json tool:add_patches
{
  "patches": [
    { "ref": "press", "type": "variableBroadcaster", "typeParam": "number", "settings": { "name": "Press Scale", "scope": "global" }, "inputs": { "value": 0.95 } },
    { "ref": "press_rx", "type": "variableReceiver", "typeParam": "number", "settings": { "name": "Press Scale", "scope": "global" } }
  ],
  "connections": [{ "from": "$press_rx.output", "to": "card_scale.start" }]
}
```

```json tool:set_knobs
{ "convertVariables": { "component": "main" }, "knobs": [{ "id": "press_scale", "group": "Press", "values": { "Proposal": 0.92 } }] }
```

## Good to know

- **Ids** are derived from names (`Grow Bounce` → `grow_bounce`) and never change; renaming changes only the name. A removed knob's id isn't reused in the same session.
- **Removing a knob** (`"remove": true`) leaves every input that read it holding the running value, so the prototype behaves as it did. `disconnect` does the same for one input.
- **Simulations** read knobs as `$knob.<id>` in `sim_get_values` and `sim_trace`.
- **Links** can't go from a knob into a published output (`$out`); put a Splitter between them.
- **Ops**: `set_knobs` compiles to `addKnob`, `updateKnob`, `removeKnob`, `setKnobValue`, `addKnobPreset`, `updateKnobPreset`, `removeKnobPreset` and `applyKnobPreset`, which `apply_ops` takes too.
