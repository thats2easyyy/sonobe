<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Pop Animation

Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

| | |
|---|---|
| Type key | `popAnimation` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>A</kbd> |
| Search terms | spring, bouncy, pop, bouncy animation, rebound, spring animation, animate, ease |

## How it works
Pop Animation moves its output toward **Number** like a spring: it speeds up, can overshoot a little, and settles. When Number changes, the output springs toward the new value. If it changes mid-flight, the motion carries its momentum into the new direction instead of stopping.

- **Number** is the target. It's usually 0 or 1 from a Switch or Interaction, which gives you a progress value to feed into a Transition.
- **Bounciness** controls how much it overshoots and wobbles. 0 settles with no bounce; 5 has a light bounce; 15 and up is very playful.
- **Speed** controls how quickly it gets there. 10 feels natural for UI; 20 is snappy.
- **Output** is the current animated value. It starts at the first Number without animating.

Right-click the patch to animate a point, size, color, or other value directly. Each component springs independently.

## Tips
- Animate 0 to 1, then use Transition patches to map that progress onto scale, position, and color. One spring keeps every property in sync.
- Bounciness and Speed match Facebook's Pop and Rebound libraries, so developers can reuse your values.
- Want a named feel instead of numbers? Wire a Spring Preset into Bounciness and Speed.

## Coming from Origami
The output port is named Output instead of Progress. Point 3D, Point 4D, anchor, and size variants are also available.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Number**<br>`number` | `variant` | `0` | The target value. The output springs toward it whenever it changes. |
| **Bounciness**<br>`bounciness` | `number` | `5` | How much the animation overshoots and wobbles, usually 0–20. 0 settles without bouncing; higher values bounce more. Range 0 to 20, step 0.5. |
| **Speed**<br>`speed` | `number` | `10` | How quickly the animation reaches the target, usually 0–20. Higher values are stiffer and faster. Range 0 to 20, step 0.5. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The current animated value, the same type as Number. With a 0-or-1 target it's a progress value that can overshoot past 1 or below 0. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

## Examples

### Tap to grow a card

The ISAT chain: Interaction, Switch, Pop Animation, Transition.

```text
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on bounciness=5 speed=10
patch grow transition<number> progress←pop.output start=1 end=1.08
```

### Press a button to shrink it

Down is true while the finger is on the button, so the button springs back on release.

```text
layer button rectangle "Button" @111,700 180x56 scale←shrink.output
patch press interaction layer=@button
patch pop popAnimation number←press.down bounciness=8 speed=14
patch shrink transition<number> progress←pop.output start=1 end=0.94
```

## Common mistakes

- The layer jumps instead of animating: Pop Animation is wired after the Transition, so it springs the final value only when it changes, or it isn't in the chain at all. Put it between the Switch and the Transition so it animates the 0-to-1 progress.
- Opacity flickers above 1 or below 0 at the end of the animation: the spring overshoots, and Transition extrapolates the overshoot. Set Bounciness to 0 for properties that must stay in range, or clamp the Transition output with Clamp.
- Nothing animates when the prototype starts: the first Number is the starting value, so there's no change to animate. Change Number after start, for example with When Prototype Starts into a Switch.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Spring Preset](springPreset.md): Picks a named spring feel, like Snappy or Bouncy, and outputs matching values for every kind of spring patch.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Pop Animation (`builtin.bouncy`)

| Sonobe port | Origami label |
|---|---|
| `output` | Progress |
