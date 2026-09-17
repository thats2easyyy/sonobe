<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Layer Info

Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame.

| | |
|---|---|
| Type key | `layerInfo` |
| Category | [Layers & Effects](README.md#layers--effects) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | layer size, measure layer, get size, bounds, frame, dimensions, get position, parent layer, getboundingclientrect |

## How it works
Layer Info reports a layer's real geometry after layout, so you can build on measurements instead of typed numbers. It's how you learn the size of a layer whose width or height is Auto, Grow, or Percent.

- **Layer** is the layer to read.
- **Size** is the width and height in points after layout, before Scale.
- **Position** is where the layer's anchor point sits, in points from its parent's top-left corner.
- **Scale** and **Anchor** are the layer's current values, even while an animation drives them.
- **Enabled** is true while the layer's own Enabled is on.
- **Parent** is the group the layer sits in. Wire it into another Layer Info to measure that group.
- **Content Size** (advanced) is the area a group's children cover.

Every output describes the **previous frame**. Layout runs after patches, so a change shows up here one frame later, about 17 ms at 60 fps.

## Tips
- Hug a text label with a background: add padding to the label's Size and wire the sum into the background's Size.
- To find where a layer sits on screen, or inside another group, use Convert Position.
- Point Layer at a looped layer to get one set of outputs per copy.

## Coming from Origami
- Position is measured from the parent's top-left corner, not its center.
- Content Size is new. When a layer's X and Y scale differ, Scale reports the X factor.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to read. Leave it empty and every output stays at its empty value. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Size**<br>`size` | `size` (distance) | Width and height in points after layout, not counting Scale (previous frame). |
| **Position**<br>`position` | `point` (distance) | Where the layer's anchor point sits after layout, in points from its parent's top-left corner (previous frame). |
| **Scale**<br>`scale` | `number` | The layer's own scale, not counting its parents' (previous frame); 1 when the layer is missing. |
| **Anchor**<br>`anchor` | `anchor` | Which point of the layer Position refers to, from [0, 0] top-left to [1, 1] bottom-right (previous frame). |
| **Enabled**<br>`enabled` | `boolean` | True while the layer's own Enabled is on (previous frame); false when the layer is missing. |
| **Parent**<br>`parent` | `layer` | The group this layer sits in, or empty for a top-level layer; wire it into another Layer Info to measure that group. |
| **Content Size**<br>`contentSize` | `size` (distance) · advanced | The area a group's children cover, in points from its top-left corner; [0, 0] when it has no children (previous frame). |

## Examples

### Hug a text label with a pill

The Text layer sizes itself to its words; the pill adds 16 points of padding on each side and 8 on top and bottom.

```text
layer pill rectangle "Pill" @16,96 size←pill_size.output cornerRadius=18 color=#1F6FEBFF
layer label text "Label" "3 new messages" @32,104 textColor=#FFFFFFFF
patch label_info layerInfo layer=@label
patch pill_size add<size>[2] value1←label_info.size value2=[32,16]
```

### Fill a progress bar to a track of any width

The track is 92% of the screen wide on every device. Tap anywhere to fill it; the fill's final size comes from the track's measured size.

```text
layer track rectangle "Track" @16,420 92x8 widthMode=percent cornerRadius=4 color=#E5E5EAFF
layer fill rectangle "Fill" @16,420 size←fill_size.output cornerRadius=4 color=#34C759FF
patch track_info layerInfo layer=@track
patch tap_anywhere interaction
patch loaded switch flip←tap_anywhere.tap
patch fill_anim classicAnimation number←loaded.on duration=2
patch fill_size transition<size> progress←fill_anim.output start=[0,8] end←track_info.size
```

## Common mistakes

- The layer keeps growing every frame: its Size is wired from its own Layer Info plus padding, so each frame adds the padding again. Measure a different layer, such as the text inside, and size the background from that.
- Size reads 0 × 0: Layer is empty, or the layer was deleted or sits past the end of its loop. Pick the layer again in the Layer input.
- Size doesn't follow a scale animation: Size is the laid-out size before Scale. Multiply Size by Scale when you need the drawn size.

## Pairs well with

- [Convert Position](convertPosition.md): Converts a point from one layer's coordinate space to another's, so a layer can line up with a layer in a different group.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Size Unpack](sizeUnpack.md): Splits a size into separate Width and Height numbers.
- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Layer Info (`builtin.layer.size`)
