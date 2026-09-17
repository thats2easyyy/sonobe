<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Tap Toggle

Flips between on and off each time a layer is tapped, combining Interaction and Switch in one patch.

| | |
|---|---|
| Type key | `tapToggle` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | toggle button, tap to toggle, checkbox, like button, on off button, toggle switch, select |

## How it works
Tap Toggle remembers whether something is **on** or **off**, and each tap on **Layer** flips it. It's the quickest way to build a like button, a checkbox, or a card that expands on tap.

- **On** is true while the toggle is on. It starts off unless **Start On** is set.
- **Turned On** and **Turned Off** pulse on the frame the state changes, whatever caused it.
- **Down** is true while the layer is pressed, for press feedback.
- **Flip**, **Turn On**, and **Turn Off** let other patches change the state. If several arrive in the same frame, Turn Off wins, then Turn On, then Flip or a tap.

If a loop copies the layer, each copy keeps its own state.

## Tips
- Connect On to a Pop Animation and then a Transition so the change animates.
- Turning Enabled off ignores taps, but Flip, Turn On, and Turn Off still work.
- Need double taps, long presses, or more than two states? Use Interaction with Switch, Counter, or Option Switch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer that flips the toggle when tapped. Leave empty to flip on taps anywhere on the screen. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, taps are ignored; Flip, Turn On, and Turn Off still work. |
| **Turn On**<br>`turnOn` | `pulse` | — | Pulse to turn the toggle on. Does nothing if it's already on. |
| **Turn Off**<br>`turnOff` | `pulse` | — | Pulse to turn the toggle off. Does nothing if it's already off. |
| **Flip**<br>`flip` | `pulse` · advanced | — | Pulse to switch to the opposite state, as if the layer were tapped. |
| **Start On**<br>`startOn` | `boolean` · advanced | `false` | When on, the toggle starts on when the prototype starts and after a restart. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **On**<br>`on` | `boolean` | True while the toggle is on. |
| **Turned On**<br>`turnedOn` | `pulse` | Pulses on the frame the toggle turns on. |
| **Turned Off**<br>`turnedOff` | `pulse` | Pulses on the frame the toggle turns off. |
| **Down**<br>`down` | `boolean` | True while a press on the layer is held, for press feedback. |

## Examples

### Tap to like

On fades the heart's color, and Down gives it a quick squeeze while pressed.

```text
layer heart oval "Heart" @171,700 60x60 color←tint.output scale←squeeze.output
patch like tapToggle layer=@heart
patch fade classicAnimation number←like.on duration=0.2
patch tint transition<color> progress←fade.output start=#D9D9D9FF end=#FF3040FF
patch pop popAnimation number←like.down bounciness=8 speed=20
patch squeeze transition<number> progress←pop.output start=1 end=0.9
```

## Common mistakes

- The change jumps instead of animating: On is wired straight into a layer property. Put a Pop Animation and a Transition between them.
- Tapping one row toggles the whole list: Layer points at the list's group, so the list has one state. Set Layer to the looped row layer so each copy keeps its own.
- Two toggles flip at once: the tapped layer sits inside another layer that has its own Tap Toggle, and taps bubble up to parent groups. Move the inner button out of the group, in front of it.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
