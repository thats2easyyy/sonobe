<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Drag

Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.

| | |
|---|---|
| Type key | `drag` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | draggable, move layer, pan, drag and drop, slider knob, throw, flick, drag settings |

## How it works
Drag watches for a finger or mouse pressing on **Layer** and turns the movement into a **Position**. It doesn't move anything by itself: link Position into the layer's Position property.

- **Start Position** is where the layer sits before anyone drags it, and where **Reset** (a pulse, a signal that's on for one frame) puts it back.
- **Axis** limits dragging to horizontal or vertical movement.
- **Clip** keeps Position between **Min** and **Max** (both in the parent's coordinates).
- **Momentum** lets a flicked layer keep gliding after release. **Momentum Friction** controls how soon it stops: 50 feels like iOS scrolling, 250 stops quickly.
- **Dragging** is true while a finger is on the layer, and **Velocity** reports speed in points per second.

Layer can be a different layer than the one you move, so a small handle can drag a whole panel.

## Tips
- To snap somewhere on release, feed Position into a Spring Animation with Dragging as Gesture Active and Velocity as Gesture Velocity.
- For a slider, set Axis to Horizontal, turn on Clip, and use Min and Max for the track ends.

## Coming from Origami
Drag Settings is built in: Clip, Min, Max, Momentum, and Momentum Friction are advanced inputs on Drag. Sonobe adds Axis, Dragging, and Velocity. Positions use a top-left origin with y pointing down. Until the first drag, Position follows Start Position live, so editing it updates the viewer.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer whose touches start a drag; empty means a press anywhere on the screen drags. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, the layer can be dragged; when off, presses are ignored and Position holds. |
| **Start Position**<br>`startPosition` | `point` (distance) | `[0, 0]` | Where Position starts, in the parent's points from its top-left; Reset returns here. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to put the layer back at Start Position and stop any movement. |
| **Axis**<br>`axis` | `enum` | `both` | Which directions the layer can move. |
| **Clip**<br>`clip` | `boolean` · advanced | `false` | When on, Position always stays between Min and Max. |
| **Min**<br>`min` | `point` (distance) · advanced | `[0, 0]` | Smallest allowed Position (the top-left corner of the drag bounds) when Clip is on. |
| **Max**<br>`max` | `point` (distance) · advanced | `[300, 300]` | Largest allowed Position (the bottom-right corner of the drag bounds) when Clip is on. |
| **Momentum**<br>`momentum` | `boolean` · advanced | `false` | When on, a flicked layer keeps gliding after release and slows down by Momentum Friction. |
| **Momentum Friction**<br>`momentumFriction` | `number` · advanced | `50` | How quickly a flicked layer slows down, 0 to 950: 50 feels like iOS scrolling, 950 stops almost at once. Range 0 to 950, step 1. |

**Axis options**

- **Both** (`both`): Drag freely in any direction.
- **Horizontal** (`horizontal`): Only x changes.
- **Vertical** (`vertical`): Only y changes.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Position**<br>`position` | `point` (distance) | Where the dragged layer should be, in its parent's points; link it to the layer's Position. |
| **Dragging**<br>`dragging` | `boolean` | True while a finger or mouse is dragging the layer. |
| **Velocity**<br>`velocity` | `point` (velocity) | How fast Position is changing, in points per second, while dragging or gliding; 0 at rest. |

## Examples

### Drag a card anywhere

```text
layer card rectangle "Card" @16,120 160x220 position←move_card.position
patch move_card drag layer=@card startPosition=[16,120]
```

### Slide a knob along a track

Axis and Clip keep the knob on the track; Momentum lets a flick glide to the end.

```text
layer track rectangle "Track" @40,420 322x4
layer knob oval "Knob" @40,400 44x44 position←slide.position
patch slide drag layer=@knob startPosition=[40,400] axis=horizontal clip=true min=[18,400] max=[340,400] momentum=true momentumFriction=250
```

## Common mistakes

- Nothing moves when you drag: Drag only computes a position. Link Position into the layer's Position property.
- The layer jumps or drifts on the first drag: Start Position doesn't match where the layer is drawn. Set Start Position to the layer's authored position.
- The layer won't move at all with Clip on: Min and Max are equal or leave no room. Min and Max bound Position itself (the anchor point), not the layer's edges.

## Pairs well with

- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Snap](snap.md): Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Velocity](velocity.md): Measures how fast a value is changing, in units per second, by comparing it with the previous frame.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Drag (`origami.drag`)
- **Also imports:** `builtin.drag`, `origami.drag-settings`

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `startPosition` | Start |
| `clip` | Drag Settings › Clip |
| `min` | Drag Settings › Min |
| `max` | Drag Settings › Max |
| `momentum` | Drag Settings › Momentum |
| `momentumFriction` | Drag Settings › Momentum Friction |
