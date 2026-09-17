<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Cubic Bezier Animation

Animates toward a target over a set duration along a custom cubic-bezier easing curve.

| | |
|---|---|
| Type key | `cubicBezierAnimation` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | cubic-bezier animation, css transition, custom easing animation, bezier tween, timed animation, ease animation, figma easing |

## How it works
Cubic Bezier Animation is a timed animation. Whenever **Number** changes, the output travels from where it is to the new value over **Duration**, following a curve you shape with two control points in CSS `cubic-bezier()` order.

- **Number** is the target. Numbers, points, sizes, and colors all work.
- **Duration** is how long each animation takes, in seconds; 0 jumps instantly.
- **Control 1 X**, **Control 1 Y**, **Control 2 X**, and **Control 2 Y** shape the curve. X stays within 0–1; Y can go past 0–1 to overshoot or pull back first.
- **Output** is the animated value.
- **Curve Point** is `[time progress, eased progress]` for the animation in flight, useful for drawing the curve.

If Number changes mid-animation, a new animation starts from the current value and takes the full Duration again.

## Tips
- Paste easing from a CSS or Figma spec straight into the four control inputs.
- For motion that keeps momentum through rapid changes, use Pop Animation or Fluid Spring Animation instead.

## Coming from Origami
Origami's Path output is Curve Point here, in 0–1 units rather than scaled by Number. Sonobe also animates points, sizes, and colors.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Number**<br>`number` | `variant` | `0` | The target value; whenever it changes, the output animates to it over Duration. |
| **Duration**<br>`duration` | `number` (duration) | `0.5` | How long each animation takes, in seconds; 0 jumps to the target instantly. At least 0, step 0.05. |
| **Control 1 X**<br>`control1X` | `number` | `0.42` | Horizontal position of the first handle, 0–1 (CSS x1); larger values delay the start of the change. Range 0 to 1, step 0.01. |
| **Control 1 Y**<br>`control1Y` | `number` | `0` | Vertical position of the first handle (CSS y1); below 0 pulls back before moving forward. step 0.01. |
| **Control 2 X**<br>`control2X` | `number` | `0.58` | Horizontal position of the second handle, 0–1 (CSS x2); smaller values make the end settle sooner. Range 0 to 1, step 0.01. |
| **Control 2 Y**<br>`control2Y` | `number` | `1` | Vertical position of the second handle (CSS y2); above 1 overshoots before settling. step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The current animated value. |
| **Curve Point**<br>`curvePoint` | `point` | [time progress, eased progress] for the animation in flight, both 0–1 at rest; y grows downward on screen, so flip it when drawing. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

## Examples

### Turn a plus into an X with a CSS curve

```text
layer plus_icon rectangle "Plus" @181,700 40x40 rotation←turn.output
patch tap_plus interaction layer=@plus_icon
patch open switch flip←tap_plus.tap
patch anim cubicBezierAnimation number←open.on duration=0.35 control1X=0.2 control1Y=0 control2X=0 control2Y=1
patch turn transition<number> progress←anim.output start=0 end=45
```

## Common mistakes

- The animation feels sluggish when the target changes quickly: every new Number starts a full-length animation from the current value. Shorten Duration, or use a spring for interruptible motion.
- Overshoot shows on a layer's scale but not on a color: color channels can't go beyond 0–1, so Y values above 1 only overshoot numbers, points, and sizes.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Cubic Bezier Curve](cubicBezierCurve.md): Reshapes a 0–1 progress value with a custom cubic-bezier easing curve, the same as CSS cubic-bezier().
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Cubic Bezier Animation (`builtin.cubicanimation`)

| Sonobe port | Origami label |
|---|---|
| `curvePoint` | Path |
