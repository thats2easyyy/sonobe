<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Cubic Bezier Curve

Reshapes a 0–1 progress value with a custom cubic-bezier easing curve, the same as CSS cubic-bezier().

| | |
|---|---|
| Type key | `cubicBezierCurve` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | cubic-bezier, css easing, custom easing, bezier easing, timing function, figma easing, control points, ease curve |

## How it works
Cubic Bezier Curve bends a steady **Progress** with a curve you define by two control points, the same way CSS `cubic-bezier(x1, y1, x2, y2)` and Figma's custom easing work. The curve always runs from (0, 0) to (1, 1); the control points pull it into shape.

- **Progress** is a steady 0–1 value, such as a Repeating Animation set to Linear or Progress from a scroll.
- **Control 1 X**, **Control 1 Y**, **Control 2 X**, and **Control 2 Y** are the two handles, in CSS order. X stays within 0–1; Y can go outside it to overshoot or pull back first.
- **Output** is the eased progress; feed it into Transition.
- **Curve Point** is `[progress, output]`, handy for plotting the curve with a loop.

## Tips
- Familiar curves: ease-in-out `0.42, 0, 0.58, 1`; ease-out `0, 0, 0.58, 1`; strong deceleration `0.2, 0, 0, 1`; overshoot `0.34, 1.56, 0.64, 1`.
- Animating on a state change? Cubic Bezier Animation has the timer built in.
- Outside 0–1 the curve continues in a straight line along its end direction.

## Coming from Origami
Origami leaves the four control inputs unnamed; Sonobe names them. 2D Progress is called Curve Point.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | `0` | A steady progress value, usually 0–1; values outside that continue in a straight line. step 0.01. |
| **Control 1 X**<br>`control1X` | `number` | `0.42` | Horizontal position of the first handle, 0–1 (CSS x1); larger values delay the start of the change. Range 0 to 1, step 0.01. |
| **Control 1 Y**<br>`control1Y` | `number` | `0` | Vertical position of the first handle (CSS y1); below 0 pulls back before moving forward. step 0.01. |
| **Control 2 X**<br>`control2X` | `number` | `0.58` | Horizontal position of the second handle, 0–1 (CSS x2); smaller values make the end settle sooner. Range 0 to 1, step 0.01. |
| **Control 2 Y**<br>`control2Y` | `number` | `1` | Vertical position of the second handle (CSS y2); above 1 overshoots before settling. step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` (progress) | The eased progress: 0 at 0 and 1 at 1, shaped by the control points. |
| **Curve Point**<br>`curvePoint` | `point` | [progress, eased progress] on the curve, for plotting; y grows downward on screen, so flip it when drawing. |

## Examples

### Spin a loader with an eased turn every second

```text
layer spinner rectangle "Spinner" @181,400 40x40 rotation←turn.output
patch clock repeatingAnimation duration=1 curve=linear
patch ease cubicBezierCurve progress←clock.progress control1X=0.65 control1Y=0 control2X=0.35 control2Y=1
patch turn transition<number> progress←ease.output start=0 end=360
```

## Common mistakes

- The motion eases the wrong way: the handles were entered in a different order. Enter them in CSS order: Control 1 X, Control 1 Y, Control 2 X, Control 2 Y.
- Setting Control 1 X to 1.5 changes nothing past 1: X values are clamped to 0–1 so the curve stays valid. Use Y values above 1 or below 0 for overshoot and anticipation.
- A plotted curve draws upside down: layer positions grow downward. Map Curve Point's y through Transition with Start at the bottom and End at the top before plotting.

## Pairs well with

- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Cubic Bezier Animation](cubicBezierAnimation.md): Animates toward a target over a set duration along a custom cubic-bezier easing curve.
- [Curve](curve.md): Reshapes a 0–1 progress value with an easing curve, so steady motion speeds up or slows down near the ends.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Cubic Bezier Curve (`builtin.cubicbezier`)

| Sonobe port | Origami label |
|---|---|
| `output` | Progress |
| `curvePoint` | 2D Progress |
