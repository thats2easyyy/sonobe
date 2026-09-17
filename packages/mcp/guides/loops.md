# Loops

Repeating layers and logic from lists of values.

Related: `layout`, `components`, `simulation`

## How loops work

- A **loop** is a list of values on one cable. `loop` makes indices `0…count−1`; `loopBuilder<type>` collects your own values (`item0`, `item1`, …).
- A patch fed a loop evaluates **once per index**. Stateful patches (Switch, springs) keep separate state per index.
- When several loops meet, the output is as long as the longest; shorter loops **wrap**. Keep loops that feed one layer the same length.
- A **layer bound to a looped value repeats**, once per index. Copies sit on top of each other unless each gets its own position, usually from `gridLayout`.
- An interaction on a repeated layer gives a loop of taps, one per copy. `loopOptionSwitch` remembers which copy pulsed last, and `loopSelect` picks items by index.
- Loops are capped at 10,000 items.

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
