<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Gesture

Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.

| | |
|---|---|
| Type key | `gesture` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | pan, drag gesture, translation, fling, flick, touch velocity, interruptible, follow finger |

## How it works
Gesture is Interaction plus movement. It watches a layer, or the whole screen, and reports how far and how fast the pointer moves during a press.

- **Down** and **Tap** work like Interaction's.
- **Translation** is the offset from where the press began, in points. It returns to 0,0 the frame after release.
- **Velocity** is the pointer's speed in points per second, smoothed over the last few frames. It holds its final value on the release frame so a spring can pick it up, then drops to 0,0.
- **Position** is the pointer location in points from the top-left of the screen.

## Tips
- Wire Translation into a Spring Animation's Number, Down into Gesture Active, and Velocity into Gesture Velocity. The layer follows your finger and flings home when you let go.
- Decide where something lands on release by comparing Translation or Velocity with a threshold, or add a Swipe patch.
- To move a layer and leave it where you drop it, use Drag instead.

## Coming from Origami
Position is measured from the screen's top-left instead of the parent's center. Translation and Velocity return to 0,0 after the release frame.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to watch for presses. Leave empty to watch the whole screen. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, the patch ignores presses and outputs idle values. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Down**<br>`down` | `boolean` | True while a press that began on the layer is held, even if it slides off. |
| **Tap**<br>`tap` | `pulse` | Pulses when a press lifts on the layer after moving less than 10 points. |
| **Position**<br>`position` | `point` (distance) | Pointer position in points from the top-left of the screen; holds the last press position after release. |
| **Translation**<br>`translation` | `point` (distance) | How far the pointer has moved since the press began, in points; 0,0 from the frame after release. |
| **Velocity**<br>`velocity` | `point` (velocity) | Pointer speed in points per second on each axis; kept on the release frame, then 0,0. |
| **Start Position**<br>`startPosition` | `point` (distance) · advanced | Where the current or most recent press began, in points from the top-left of the screen. |
| **Local Position**<br>`localPosition` | `point` (distance) · advanced | Pointer position in points from the layer's own top-left corner, following its rotation and scale. |

## Examples

### Drag a card and let it spring back

While held, the card tracks the finger; on release the spring flings it home with the finger's speed.

```text
layer stage group "Stage" @37,250 328x420
  layer card rectangle "Card" 328x420 cornerRadius=24 position←follow.output
patch touch gesture layer=@card
patch follow springAnimation<point> number←touch.translation gestureActive←touch.down gestureVelocity←touch.velocity
```

### Tilt a photo while dragging sideways

A point wired into a number reads its first component, so Translation's x drives the tilt.

```text
layer photo rectangle "Photo" @51,250 300x400 cornerRadius=20 rotation←tilt.output
patch touch gesture layer=@photo
patch ease popAnimation number←touch.translation bounciness=6 speed=16
patch tilt transition<number> progress←ease.output start=0 end=0.08
```

## Common mistakes

- The layer snaps back when you let go: Translation returns to 0,0 after release. Use Drag when the layer should stay where you drop it, or pick a new resting spot on release and add Translation to that.
- The fling feels dead: Velocity isn't wired into the spring's Gesture Velocity, or Down isn't wired into Gesture Active, so the spring never gets the release speed.
- The layer runs away from your finger: Translation is added to the layer's animated position, which already includes the offset. Add Translation to a fixed resting position instead.

## Pairs well with

- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Swipe](swipe.md): Pulses when a press on a layer ends in a swipe, with separate pulses for left, right, up, and down.
- [Snap](snap.md): Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Gesture (`builtin.layer.gesture`)
