<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Convert Position

Converts a point from one layer's coordinate space to another's, so a layer can line up with a layer in a different group.

| | |
|---|---|
| Type key | `convertPosition` |
| Category | [Layers & Effects](README.md#layers--effects) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | convert coordinates, local to global, global position, screen position, follow layer, align layers, coordinate space, pin to layer, world position, position in parent |

## How it works
Every layer measures positions from its parent's top-left corner, so one spot on screen has different coordinates inside different groups. Convert Position translates a point from one layer's space into another's. It accounts for scrolling, scale, and layout.

- **From Layer** is the layer the point belongs to. Leave it empty to start from screen coordinates.
- **Position** is the point, in points from From Layer's **Anchor**. With both at [0, 0] it's the layer's top-left corner.
- **To Layer** is the layer whose space you want the answer in, usually the **parent** of the layer you're moving. Leave it empty for screen coordinates.
- **To Anchor** measures the answer from another point of To Layer: [0.5, 0.5] gives the offset from its center.
- **Converted Position** is the answer. **Error** turns on when a layer can't be found.

Like Layer Info, it reads the layout of the previous frame.

## Tips
- Make layer B follow layer A: set From Layer to A and To Layer to B's parent, then wire Converted Position into B's Position.
- Set Anchor to where B should attach: [1, 0] is A's top-right corner. Give B an Anchor of [0.5, 0.5] to center it on that spot.

## Coming from Origami
From Parent and To Parent are called From Layer and To Layer, the unnamed input is Position, and coordinates start at the top-left. Disabled layers still convert: Error means a layer is missing.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **From Layer**<br>`fromLayer` | `layer` | none | The layer the point belongs to. Leave it empty to start from screen coordinates. |
| **Position**<br>`position` | `point` (distance) | `[0, 0]` | The point to convert, in points from From Layer's Anchor; [0, 0] is the anchor point itself. |
| **Anchor**<br>`anchor` | `anchor` | `[0, 0]` | Which point of From Layer Position is measured from: [0, 0] top-left, [0.5, 0.5] center, [1, 1] bottom-right. |
| **To Layer**<br>`toLayer` | `layer` | none | The layer whose space you want the answer in, usually the parent of the layer you're moving; empty means screen coordinates. |
| **To Anchor**<br>`toAnchor` | `anchor` | `[0, 0]` | Measures the answer from this point of To Layer: [0, 0] its top-left, [0.5, 0.5] its center. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Converted Position**<br>`convertedPosition` | `point` (distance) | The point in To Layer's space, measured from To Anchor, from the previous frame's layout; wire it into the Position of a child of To Layer. |
| **Error**<br>`error` | `boolean` | True when a layer can't be found or To Layer is scaled to 0; Converted Position then holds its last good value. |

## Examples

### Pin a badge to a card that scrolls

The badge lives outside the feed, so the feed's clipping can't cut it off. With To Layer empty, the answer is in screen coordinates, which is the badge's parent space.

```text
layer feed group "Feed" @0,0 402x874 clip=true
  layer list group "List" 402x2000 position←feed_scroll.position
    layer card rectangle "Card" @16,300 370x200 cornerRadius=20
layer badge oval "Badge" 28x28 anchor=[0.5,0.5] position←pin.convertedPosition color=#FF3B30FF
patch feed_scroll scroll layer=@list
patch pin convertPosition fromLayer=@card anchor=[1,0]
```

### Grow a photo out of its thumbnail

Convert Position finds the thumbnail on screen, so the full-size photo starts exactly on top of it wherever the gallery sits.

```text
layer gallery group "Gallery" @0,160 402x600
  layer thumb image "Thumb" @136,80 130x130 cornerRadius=12
layer viewer image "Viewer" position←grow_position.output size←grow_size.output opacity←open_anim.output
patch tap_thumb interaction layer=@thumb
patch tap_viewer interaction layer=@viewer
patch open switch turnOn←tap_thumb.tap turnOff←tap_viewer.tap
patch open_anim popAnimation number←open.on bounciness=2 speed=14
patch thumb_spot convertPosition fromLayer=@thumb
patch grow_position transition<point> progress←open_anim.output start←thumb_spot.convertedPosition end=[0,0]
patch grow_size transition<size> progress←open_anim.output start=[130,130] end=[402,874]
```

## Common mistakes

- The badge jitters or drifts away: To Layer is the badge itself, so every move changes the space it's measured in. Set To Layer to the badge's parent, or leave it empty when the badge sits directly on the screen.
- The follower sits half a layer off: the follower's own Anchor doesn't match the spot you attach to. Set Anchor to that spot on From Layer, and give the follower an Anchor of [0.5, 0.5] when it should be centered there.
- The overlay trails a frame behind while scrolling: positions come from the previous frame's layout. When the overlay must move exactly with the content, put it inside the scrolling group instead.

## Pairs well with

- [Layer Info](layerInfo.md): Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Sample and Hold](sampleAndHold.md): Captures a value when you tell it to and keeps it, like remembering where a drag started.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Convert Position (`builtin.layer.convertposition`)
- **Also imports:** `builtin.convertposition`, `builtin.convertPosition`, `builtin.layer.convertPosition`

| Sonobe port | Origami label |
|---|---|
| `fromLayer` | From Parent |
| `position` | Input |
| `toLayer` | To Parent |
| `convertedPosition` | Output |
