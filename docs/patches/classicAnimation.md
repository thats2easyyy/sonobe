<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Classic Animation

Animates toward a target value over a set duration with an easing curve whenever the target changes.

| | |
|---|---|
| Type key | `classicAnimation` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>C</kbd> |
| Search terms | tween, ease, easing, timed animation, duration animation, ease in out, keyframe animation, css transition |

## How it works
Classic Animation moves its output from where it is to **Number** over a fixed time, following an easing curve. It's the timed, predictable counterpart to Pop Animation's springs, like a CSS transition.

- **Number** is the target. When it changes, a new animation starts from the current output.
- **Duration** is how long each animation takes, in seconds. 0 jumps straight to the target.
- **Curve** is the easing. *Out* curves start fast and slow down, which suits things appearing; *In* curves start slow, which suits things leaving; *In & Out* is slow at both ends.
- **Output** is the current value. It starts at the first Number without animating.

Right-click to animate a point, size, color, or other value directly.

## Tips
- Animate 0 to 1, then fan out to several Transition patches so every property moves in sync.
- Use Classic Animation when timing must be exact, like a progress bar or a sequence. Use Pop or Spring Animation when motion should feel physical.
- Cubic Out with a duration around 0.25–0.35 s is a good default for UI.

## Coming from Origami
The output port is named Output instead of Progress.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Number**<br>`number` | `variant` | `0` | The target value. A new animation toward it starts whenever it changes. |
| **Duration**<br>`duration` | `number` (duration) | `0.4` | How long each animation takes, in seconds. 0 jumps straight to the target. At least 0, step 0.05. |
| **Curve**<br>`curve` | `enum` | `quadraticInOut` | The easing curve. Out curves start fast and slow down; In curves start slow and speed up; In & Out is slow at both ends. Options: Linear (`linear`), Quadratic In (`quadraticIn`), Quadratic Out (`quadraticOut`), Quadratic In & Out (`quadraticInOut`), Cubic In (`cubicIn`), Cubic Out (`cubicOut`), Cubic In & Out (`cubicInOut`), Exponential In (`exponentialIn`), Exponential Out (`exponentialOut`), Exponential In & Out (`exponentialInOut`), Sinusoidal In (`sinusoidalIn`), Sinusoidal Out (`sinusoidalOut`), Sinusoidal In & Out (`sinusoidalInOut`). |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The current animated value, the same type as Number. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

## Examples

### Tap to fade an overlay in and out

```text
layer overlay rectangle "Overlay" @0,0 402x874 opacity←fade.output
patch tap_screen interaction
patch toggle switch flip←tap_screen.tap
patch fade classicAnimation number←toggle.on duration=0.3 curve=cubicOut
```

### Ease the background between light and dark

The color variant animates straight RGBA channels.

```text
layer background colorFill "Background" color←tint.output
patch tap_screen interaction
patch toggle switch flip←tap_screen.tap
patch pick optionPicker<color>[2] option←toggle.on option0=#FFFFFFFF option1=#101014FF
patch tint classicAnimation<color> number←pick.output duration=0.5 curve=sinusoidalInOut
```

## Common mistakes

- Tapping quickly makes the animation feel slow: every change restarts a full-length tween from wherever the output is. Use a shorter Duration, or Pop Animation when people toggle rapidly.
- The layer snaps instead of animating: Duration is 0, or the Classic Animation sits after the Transition and the Transition's inputs never change. Put it between the Switch and the Transition.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Classic Animation (`builtin.classicanimation`)
- **Also imports:** `builtin.classicAnimation`

| Sonobe port | Origami label |
|---|---|
| `output` | Progress |
