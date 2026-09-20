# Loops

Repeating layers and logic from lists of values.

Related: `layout`, `components`, `simulation`

## How loops work

- A **loop** is a list of values on one cable. `loop` makes indices `0…count−1`; `loopBuilder<type>` collects your own values (`item0`, `item1`, …).
- A patch fed a loop evaluates **once per index**. Stateful patches (Switch, springs) keep separate state per index.
- When several loops meet, the output is as long as the longest; shorter loops **wrap**. Keep loops that feed one layer the same length.
- An **empty loop wins**: a patch fed one runs 0 times and outputs empty loops, and a layer or component bound to one makes 0 copies, whatever the other loops hold.
- A **layer bound to a looped value repeats**, once per index. Copies sit on top of each other unless each gets its own position, usually from `gridLayout`.
- An interaction on a repeated layer gives a loop of taps, one per copy. `loopOptionSwitch` remembers which copy pulsed last, and `loopSelect` picks items by index.
- Loops are capped at 10,000 items.

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
- Read one item with an index suffix after the property: `@row.position#2`. Without it you get item 0.
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
