# Layout

Coordinates, sizing, and automatic layout.

Related: `graph-basics`, `loops`, `components`

## Coordinates

- Units are points; Y grows downward. The screen size is in `get_document_info` (402×874 for the default iPhone 17 Pro).
- `position` is where the layer's **anchor point** sits, measured from the parent's top-left.
- `anchor` defaults to `[0, 0]` (top-left). Set `[0.5, 0.5]` to position by center.
- `pivot` is the point scale and rotation happen around. It defaults to `[0.5, 0.5]` (center).
- Later layers draw in front of earlier ones. Children draw in front of their parent. `zPosition` adjusts depth.

## Containers

Groups can lay out their children automatically:

| Prop        | Values                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `layout`    | `none` (default), `row`, `column`, `grid`                                                      |
| `spacing`   | gap in points (`spacingMode`: `fixed`, `between`, `evenly`)                                    |
| `padding`   | `[top, right, bottom, left]`                                                                   |
| `alignment` | `topLeft`, `top`, `topRight`, `left`, `center`, `right`, `bottomLeft`, `bottom`, `bottomRight` |
| `clip`      | hide children outside the bounds (needed for scroll windows)                                   |

Children of a container with layout:

- `widthMode` / `heightMode`:
  - `fixed` (use `size`)
  - `auto` (hug contents; the default for text)
  - `grow` (share the free space along the layout direction)
  - `percent` (`size` is a percent of the parent)
- `positioning: "absolute"` opts a child out of layout, so it uses `position` again. With layout on, relative children ignore `position`.

## Example: a list card

```json tool:add_layers
{
  "layers": [
    {
      "type": "group",
      "name": "List",
      "props": {
        "position": [16, 120],
        "size": [370, 300],
        "layout": "column",
        "spacing": 12,
        "padding": [16, 16, 16, 16],
        "color": "#F2F2F7FF",
        "cornerRadius": 20
      },
      "children": [
        {
          "type": "rectangle",
          "name": "Row 1",
          "props": { "size": [338, 56], "cornerRadius": 12, "color": "#FFFFFFFF" }
        },
        {
          "type": "rectangle",
          "name": "Row 2",
          "props": { "size": [338, 56], "cornerRadius": 12, "color": "#FFFFFFFF" }
        },
        {
          "type": "text",
          "name": "Footer",
          "props": { "text": "2 items", "fontSize": 13, "textColor": "#8E8E93FF" }
        }
      ]
    }
  ]
}
```

```text outline
layer list group "List" @16,120 370x300 color=#F2F2F7FF cornerRadius=20 layout=column spacing=12 padding=16,16,16,16
  layer row_1 rectangle "Row 1" 338x56 color=#FFFFFFFF cornerRadius=12
  layer footer text "Footer" "2 items" fontSize=13 textColor=#8E8E93FF
```

## Moving things

- To animate a position, feed a `transition<point>` (or a spring set to point) into `@layer.position`, or pack separate numbers with the `point` patch (`x`, `y`).
- Read a layer's laid-out size and position with `layerInfo` (`layer` input). It reports the previous frame, so don't size a layer from its own Layer Info.
- Text layers report their measured size as the read-only output `@title.textSize`.
- For repeated layers (lists, grids), use a loop and `gridLayout`. See `loops`.
