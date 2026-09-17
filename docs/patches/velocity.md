<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Velocity

Measures how fast a value is changing, in units per second, by comparing it with the previous frame.

| | |
|---|---|
| Type key | `velocity` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | speed, rate of change, derivative, delta, change per second, how fast, direction |

## How it works
Velocity tells you how quickly **Value** is changing and in which direction. If a position moves 10 points in a tenth of a second, the velocity is 100 points per second. Positive means increasing; negative means decreasing; 0 means it's holding still.

- **Value** is the number or point to measure, like a drag position or a scroll offset.
- **Velocity** is the change per second. For points, each axis has its own velocity.

Right-click to measure a point or 3D point instead of a number.

## Tips
- Check the sign to detect direction, like hiding a toolbar while content scrolls up.
- Frame-to-frame velocity can be jittery. Pass it through Smooth Value before using it for visuals.
- To throw a layer with Spring Animation, use a Gesture patch's own Velocity output: it holds the release speed on the frame your finger lifts, when this patch already reads 0.

## Coming from Origami
Origami's Velocity outputs the change per frame. This one outputs the change per second, so results don't depend on the frame rate. At 60 fps, divide by 60 to get Origami's number. Point and 3D point variants are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The number or point whose rate of change to measure. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Velocity**<br>`velocity` | `variant` (velocity) | How fast Value is changing, in units per second. Positive when increasing, negative when decreasing, 0 when still. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`.

## Examples

### Tilt a card while it's dragged sideways

Horizontal speed, smoothed and clamped, becomes a small rotation.

```text
layer card rectangle "Card" @16,300 358x220 position←drag_card.position rotation←tilt.output
patch drag_card drag layer=@card
patch speed velocity<point> value←drag_card.position
patch calm smoothValue value←speed.velocity risingHysteresis=0.8
patch amount progress value←calm.output start=-2000 end=2000 clampToRange=true
patch tilt transition<number> progress←amount.progress start=-8 end=8
```

## Common mistakes

- A thrown layer stops dead on release: on the frame the finger lifts the position doesn't change, so Velocity reads 0. Wire the Gesture patch's Velocity into Spring Animation instead.
- Numbers look far too big compared with Origami: Sonobe measures per second, not per frame. Divide by 60 for the per-frame value, or adjust your thresholds.

## Pairs well with

- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Smooth Value](smoothValue.md): Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Velocity (`origami.velocity`)
- **Also imports:** `origami.Velocity`

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
| `velocity` | Output |
