# Loops

Repeating layers and logic from lists of values.

Related: `layout`, `components`, `simulation`

## How loops work

- A **loop** is a list of values on one cable. `loop` makes indices `0…count−1`; `loopBuilder<type>` collects your own values (`item0`, `item1`, …).
- A patch fed a loop evaluates **once per index**. Stateful patches (Switch, springs) keep separate state per index.
- When several loops meet, the output is as long as the longest; shorter loops **wrap**. `loop_length_mismatch` flags loops of different lengths meeting (info when it looks deliberate, like 2 colors striping 6 rows).
- An **empty loop wins**: a patch fed one runs 0 times and outputs empty loops, and a layer or component bound to one makes 0 copies, whatever the other loops hold.
- An interaction on a repeated layer gives a loop of taps, one per copy. `loopOptionSwitch` remembers which copy pulsed last, and `loopSelect` picks items by index.
- Loops are capped at 10,000 items.

## Copies: how many, which is on top, what happens at zero

- **How many.** A layer makes one copy per item of the longest loop on its own properties (Auto). Its `repeat` decides instead when set: a whole number, or a link to a loop for one copy per item (`{ "link": "names.loop" }`). Other looped properties then wrap per copy, and an empty one reads its default. Copies sit on top of each other unless each gets a position, usually from `gridLayout`.
- **Children follow.** Each layer inside a copy gets one copy, reading item `copy % length` of its own loops. The children of a layer that makes one copy repeat _inside_ it: a card with a looped title holds four stacked titles, and a drag on the card moves them all. Set the card's `repeat` (`loops_inside_single_copy` suggests the op).
- A Repeat inside a layer that already makes copies is ignored (`repeat_inside_repeat`); loops of loops need a layer component. Link Repeat to the data the copies show, never to a gesture on the copies (`repeat_from_own_gesture`).
- **Which is on top.** Copies draw in index order, so the last copy is in front (as in Origami). For copy 0 in front, such as the top card of a deck, feed index × −1 into `zPosition` (`multiply` with `value2: -1`). The copies under it get negative values, which sort behind every sibling at 0, so give the copies a group of their own, apart from a backdrop or an empty state (`examples/16-placemark-deck`). The front copy is also the one that gets touches, and `sim_dispatch` names it (`hit card#0`).
- **At zero.** `repeat: 0` makes none, quietly. An empty loop makes 0 copies, on Repeat or on an Auto layer's properties; when it erased real items, sim results carry `empty_loop` (below).
- **Reading copies.** `@card.repeat` reads how many copies the layer drew, and a patch linked to it gets last frame's count. `sim_get_values` notes say "Layer "Card" has 1 copy, so there's no #2", or "copy #0 of 4" for a read without `#n`.

## Empty loops and Loop Select

- `loopSelect` leaves out indices past the end by default (`outOfRange: "skip"`), so an index past the end gives an empty loop and everything downstream disappears. Set `outOfRange` to `"clamp"` (nearest end), `"wrap"` (count around; −1 is the last item) or `"fallback"` (its `fallback` input), and Output has one item per index.
- To read each copy's neighbor, such as the card above, use `index + 1` with `outOfRange: "fallback"`. The last copy gets `fallback` instead of nothing.
- A list that goes around a `delay1` is **one value on the first frame** (the port's default), not a list. With Skip, a Loop Select that picks from it with `index + 1` returns nothing, and the loop never forms. Use `"fallback"`.
- "Safe start" patches (`or` with false, `max` with 0) don't help: an empty loop stays empty through them.
- The runtime never lets last frame's empty loop erase this frame's copies. Through a feedback cable an empty loop reads as the input's default, and a layer that drew 0 copies reads as one layer for Interaction and Drag (it runs once, hitting nothing). A cycle that went empty for a moment refills by itself, with no `sim_reset`.
- When a layer or component ends up with 0 copies because an empty loop erased items, sim results carry an `empty_loop` warning: where the empty loop started, what it erased, and ops that fix it. In the app, `get_diagnostics` shows it in its Live viewer section too.

## Example: a list of names you can tap

```json tool:add_layers
{
  "layers": [
    { "type": "rectangle", "name": "Row", "props": { "cornerRadius": 12, "color": "#FFFFFFFF" } },
    { "type": "text", "name": "Label", "props": { "fontSize": 17 } }
  ]
}
```

```json tool:add_patches
{
  "patches": [
    { "ref": "rows", "type": "loop", "name": "Rows", "inputs": { "count": 3 } },
    {
      "ref": "grid",
      "type": "gridLayout",
      "name": "Row Grid",
      "inputs": {
        "index": { "link": "$rows.index" },
        "columns": 1,
        "origin": [16, 120],
        "width": 370,
        "itemHeight": 72,
        "spacing": 12
      }
    },
    {
      "ref": "names",
      "type": "loopBuilder",
      "typeParam": "text",
      "inputCount": 3,
      "name": "Names",
      "inputs": { "item0": "Ada", "item1": "Grace", "item2": "Katherine" }
    },
    {
      "ref": "tap",
      "type": "interaction",
      "name": "Tap Row",
      "inputs": { "layer": { "layer": "row" } }
    },
    {
      "ref": "which",
      "type": "loopOptionSwitch",
      "name": "Tapped Row",
      "inputs": { "select": { "link": "$tap.tap" } }
    },
    {
      "ref": "chosen",
      "type": "loopSelect",
      "typeParam": "text",
      "name": "Chosen Name",
      "inputs": { "loop": { "link": "$names.loop" }, "index": { "link": "$which.option" } }
    }
  ],
  "connections": [
    { "from": "$grid.position", "to": "@row.position" },
    { "from": "$grid.size", "to": "@row.size" },
    { "from": "$grid.position", "to": "@label.position" },
    { "from": "$names.loop", "to": "@label.text" }
  ]
}
```

```text outline
layer row rectangle "Row" position←row_grid.position size←row_grid.size color=#FFFFFFFF cornerRadius=12
layer label text "Label" position←row_grid.position text←names.loop
patch row_grid gridLayout "Row Grid" index←rows.index columns=1 origin=16,120 width=370 itemHeight=72 spacing=12
patch chosen_name loopSelect<text> "Chosen Name" loop←names.loop index←tapped_row.option
```

## Simulating loops

- Tap one copy with the target `"@row#2"`.
- Read one item with an index suffix after the property: `@row.position#2`. Without it you get copy 0, and the note says so ("copy #0 of 3").
- See one copy on its own with `get_screenshot` of `"@row#2"` and `isolate: true`. `sim_override` changes every copy at once, so it refuses `#n` targets.
- A value that reads `null` comes with a note in `sim_get_values`: the layer drew 0 copies (and why), `#n` is past the end, or the instance path runs into a component with 0 copies.

```json tool:sim_reset
{}
```

```json tool:sim_dispatch
{ "simId": "sim_1", "events": [{ "kind": "tap", "target": "@row#2" }] }
```

```json tool:sim_get_values
{ "simId": "sim_1", "targets": ["tapped_row.option", "chosen_name.output", "@row.position#2"] }
```

After tapping the third row, `tapped_row.option` is 2 and `chosen_name.output` is "Katherine".

## Example: repeat a whole card

A card moved by its own drag gets its copies from Repeat, so the drag runs once per card:

```json tool:apply_ops
{
  "ops": [
    {
      "op": "addLayer",
      "layer": {
        "ref": "card",
        "type": "group",
        "name": "Card",
        "props": { "size": [370, 120], "color": "#FFFFFFFF", "cornerRadius": 16 },
        "children": [
          { "ref": "who", "type": "text", "name": "Card Name", "props": { "position": [16, 16] } }
        ]
      }
    },
    { "op": "connect", "from": "names.loop", "to": "@$who.text" },
    {
      "op": "addPatch",
      "patch": {
        "ref": "drag",
        "type": "drag",
        "name": "Drag Card",
        "inputs": { "layer": { "layer": "$card" }, "startPosition": [16, 520] }
      }
    },
    { "op": "connect", "from": "$drag.position", "to": "@$card.position" },
    { "op": "setInput", "target": "@$card.repeat", "value": { "link": "names.loop" } }
  ]
}
```

```text outline
layer card group "Card" 370x120 repeat←names.loop position←drag_card.position color=#FFFFFFFF cornerRadius=16
  layer card_name text "Card Name" @16,16 text←names.loop
```

```json tool:sim_reset
{}
```

```json tool:sim_get_values
{ "simId": "sim_1", "targets": ["@card.repeat", "@card_name.text#2"] }
```

`@card.repeat` is 3, one copy per name, and each card shows its own name.
