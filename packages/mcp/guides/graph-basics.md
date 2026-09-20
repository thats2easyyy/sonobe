# Graph basics

How documents, layers, patches, values and ops fit together.

Related: `start-here`, `animation`, `troubleshooting`

## The pieces

- **Components.** A document holds components. The root is a `prototype` (the screen). Reusable pieces are `layerComponent`s (shown as `componentInstance` layers) or `patchComponent`s (run as `component` patches). See `components`.
- **Layers.** A tree, back to front; children draw above their parent. Each layer has a `type` (`rectangle`, `text`, `group`, `image`, `hitArea`, …) and `props`. A prop holds a literal or a connection. `describe_layer_types` lists props.
- **Patches.** Logic nodes with typed input and output ports. Options:
  - `typeParam` picks the value type of variant ports, as in `transition<point>`.
  - `inputCount` sets how many repeated inputs a variadic patch has (`add`, `or`, `optionPicker`, `loopBuilder`). `describe_patch_types` prints the keys: `add` and `or` count from 1 (`value1`, `value2`), `optionPicker` and `loopBuilder` from 0 (`option0`, `item0`).
  - `settings` holds non-port configuration, such as a variable's name.
  - `ui` is the patch editor position.
- **Connections.** They live on the input they drive: `{ "link": "pop.output" }`. Links may read patch outputs, layer props or layer outputs (`@card.scale`, `@label.textSize`), or published inputs (`$in.key`).
- **Ids.** Readable and immutable. They derive from names (`"Tap Card"` becomes `tap_card`) and are unique within a component. Renaming changes only the name.

## States and pulses

- A **state** (`boolean`, `number`, …) holds its value until something changes it. Interaction's `down` is on while the finger is pressed.
- A **pulse** is true for exactly one frame. Interaction's `tap` fires on release; Switch's `flip` reacts to it.
- A pulse input also fires when a boolean wired into it turns on.
- Wiring a pulse into a state input (tap into a Transition's progress) gives a one-frame blip. Diagnostics warn with `pulse_into_state` and suggest inserting a Switch.

## Values

| Type                                     | Literal                         |
| ---------------------------------------- | ------------------------------- |
| number, index                            | `1.5`, `2`                      |
| boolean                                  | `true`                          |
| text, enum option                        | `"Hello"`, `"cubicOut"`         |
| color                                    | `"#FF3B30FF"`                   |
| point, size, anchor                      | `[16, 120]`                     |
| point3d, point4d (padding, corner radii) | `[0, 0, 0]`, `[16, 16, 16, 16]` |
| layer                                    | `{ "layer": "card" }`           |
| loop of literals                         | `{ "loop": [1, 2, 3] }`         |
| JSON                                     | `{ "json": { "a": 1 } }`        |

Some connections convert automatically: number to boolean (on when > 0), boolean to number (1 or 0), boolean to pulse (fires when it turns on), number to any vector, number to text. Anything else fails with `type_mismatch` and a converter suggestion. `list_value_types` has the full table.

## Batches

`apply_ops` is the general front door; the other write tools compile to its ops.

- Ops apply in order, and later ops see earlier results.
- Batches are **atomic** by default: any failure rolls back everything.
- Give an item a `ref` and address it as `$ref` anywhere in the batch, even before the op that creates it. Items are created first, then the values and connections that name them, so two patches can feed each other in one batch.
- `dryRun: true` previews the diagnostics without changing anything.
- `expectedRevision` refuses to apply when the document moved on.
- A batch can replace an item under its id: remove it, then add the new one. Ids removed by an earlier batch are retired, so new items skip them (`card_2`, reported on a "Retired ids skipped" line) and an explicit retired `id` fails with `id_retired`. Rebuild in one batch to keep ids.
- To swap a patch for another type, change it in place: `{ "op": "replacePatch", "id": "grow_spring", "patch": { "type": "classicAnimation" } }` keeps its id, position, name, and every value and cable that still fits a port with the same key. `inputMap` / `outputMap` (`{ "number": "progress" }`) carry one to a port with another key. The result lists what it dropped.

Op kinds: `addLayer`, `updateLayer`, `moveLayer`, `removeLayer`, `addPatch`, `updatePatch`, `replacePatch` (a new type in place), `removePatch`, `setInput` (literal or link; `null` resets), `connect`, `disconnect`, `rename`, `addComment`, `updateComment`, `removeComment`, `addComponent`, `removeComponent`, `createComponent`, `updateInterface` (by key; `null` unpublishes; `replace: true` sets a whole side), `updateComponent`, `setNodePositions`, `setScript`, `addAsset`, `removeAsset`, `setProject`. Every op may name a `component`; a field an op doesn't take fails with `unknown_field` and a did-you-mean.

## Organizing the graph

- **Sections are comment frames.** Frame a group of patches with `addComment { "comment": { "text": "Places", "rect": [x, y, w, h] } }`. A node belongs to the frame under its title bar.
- **Tidy with `tidy_graph`.** It lays each frame's patches out left to right inside the frame, refits the frame, and pushes overlapping frames apart, keeping the sections where they are. `tidy_graph({ "frames": ["places"] })` tidies one section; `ids` tidies some nodes within their frames; `dryRun: true` previews. The result says what grew or moved, and which nodes overlapped before.
- **Don't estimate node sizes.** Nodes are as wide as their names, inline values and live values; a text Loop Builder is about 280 to 300 pt wide. `add_patches` and `tidy_graph` size them as the editor draws them, so leave out `ui` or tidy afterwards instead of computing a layout.
- **Layer and interface nodes.** A layer that a cable drives or reads gets a node (`@card`), and published ports get `$in` and `$out`. They sit next to the patches they connect to until someone places them. `get_outline` detail `full` shows `node=x,y` or `node=auto`. Move them with `{ "op": "setNodePositions", "positions": { "@card": [900, 40] } }`; `null` puts one back to automatic. Don't write `meta.patchEditor` yourself: `updateComponent` refuses a write that would drop positions someone placed.

## Example: dim a dot while it's pressed

```json tool:apply_ops
{
  "ops": [
    {
      "op": "addLayer",
      "layer": {
        "ref": "dot",
        "type": "oval",
        "name": "Dot",
        "props": { "position": [181, 420], "size": [40, 40], "color": "#FF3B30FF" }
      }
    },
    {
      "op": "addPatch",
      "patch": {
        "ref": "hold",
        "type": "interaction",
        "name": "Hold Dot",
        "inputs": { "layer": { "layer": "$dot" } }
      }
    },
    {
      "op": "addPatch",
      "patch": {
        "ref": "fade",
        "type": "classicAnimation",
        "name": "Dim Ease",
        "inputs": { "number": { "link": "$hold.down" }, "duration": 0.2 }
      }
    },
    {
      "op": "addPatch",
      "patch": {
        "ref": "dim",
        "type": "transition",
        "name": "Dim",
        "inputs": { "progress": { "link": "$fade.output" }, "start": 1, "end": 0.4 }
      }
    },
    { "op": "connect", "from": "$dim.output", "to": "@$dot.opacity" }
  ],
  "label": "dim the dot while pressed"
}
```

```text outline
layer dot oval "Dot" @181,420 40x40 opacity←dim.output color=#FF3B30FF
patch hold_dot interaction "Hold Dot" layer=@dot
patch dim_ease classicAnimation<number> "Dim Ease" number←hold_dot.down duration=0.2
patch dim transition<number> "Dim" progress←dim_ease.output start=1 end=0.4
```

Here `down` is a state, so the dot stays dim for as long as the finger is down, then eases back. Wiring the one-frame `tap` pulse there instead would barely flicker.

A mismatched connection fails and teaches the fix:

```json tool-error:connect
{ "connections": [{ "from": "hold_dot.down", "to": "@dot.color" }] }
```

The error suggests an Option Picker set to color, with the three ops that insert it.

## Evaluation and feedback loops

- Every patch evaluates every frame in dataflow order, then layer props resolve, then layout runs.
- Same-frame precedence: Switch `turnOff` beats `turnOn` beats `flip`; Counter `jump` beats increase and decrease.
- A cable that loops back to an earlier patch reads the **previous frame's** value. Loops that close through a layer property (`b.output → @card.opacity`, then `@card.opacity → a.value1`) or through a Variable Broadcaster and Receiver count too. Diagnostics name the lagging connection in `feedback_loop`:
  - **info** when the loop is intentional: it goes through `delay1`, or values only come back when a pulse fires (a scroll's jump position, a Sample and Hold, a Counter's jump number).
  - **warning** when values feed back every frame, which can drift or oscillate. Insert `delay1` to make it explicit, or disconnect the cable.
- A patch can't feed its own input (`self_edge`). Route the value through `delay1` (Delay One Frame), which outputs what its input was last frame.

Accumulate an angle, 3 degrees per frame:

```json tool:add_patches
{
  "patches": [
    { "ref": "spin", "type": "add", "name": "Spin Angle", "inputs": { "value2": 3 } },
    {
      "ref": "last",
      "type": "delay1",
      "name": "Last Angle",
      "inputs": { "value": { "link": "$spin.output" } }
    }
  ],
  "connections": [{ "from": "$last.output", "to": "$spin.value1" }]
}
```

```text outline
patch spin_angle add<number>×2 "Spin Angle" value1←last_angle.output value2=3
patch last_angle delay1<number> "Last Angle" value←spin_angle.output
```

- A feedback loop steps once per frame, so at 120 fps it runs twice as fast. Drive continuous motion from `time`, and keep feedback loops for per-frame work like smoothing or counting.
