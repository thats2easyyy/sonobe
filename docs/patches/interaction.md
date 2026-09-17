<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Interaction

Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.

| | |
|---|---|
| Type key | `interaction` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>I</kbd> |
| Search terms | tap, press, click, touch, button, on tap, pointer down, touch events |

## How it works
Interaction watches one layer for touches and mouse clicks. Leave **Layer** empty to watch the whole screen.

- **Down** is a state: true while a press that began on the layer is held, even if the finger slides off.
- **Tap** is a pulse, a signal that's on for one frame. It fires when a press lifts on the layer after moving less than 10 points.
- **Position** is where the pointer is, in points from the top-left of the screen. It keeps the last press position after release.
- **Enabled** turns sensing off. Touches still don't pass through to layers behind.

Presses bubble: pressing a child layer also presses its parent groups. If a loop copies the layer, each copy gets its own outputs.

## Tips
- Use Tap with a Switch for changes that stay. Use Down for press feedback that springs back.
- Layers at opacity 0 or with Enabled off can't be pressed. Use a Hit Area layer for an invisible target.
- Need drag distance or fling speed? Use Gesture.

## Coming from Origami
- Position is measured from the screen's top-left, not the parent's center.
- On the Tap frame, Position still holds where the finger lifted instead of resetting to 0, so you don't need a Delay 1.
- Enable is called Enabled, and Force runs 0 to 1 instead of 0 to 6.67.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to watch for presses. Leave empty to watch the whole screen. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, the patch ignores presses: Down stays false and Tap never fires. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Down**<br>`down` | `boolean` | True while a press that began on the layer is held, even if it slides off. |
| **Tap**<br>`tap` | `pulse` | Pulses when a press lifts on the layer after moving less than 10 points. |
| **Position**<br>`position` | `point` (distance) | Pointer position in points from the top-left of the screen; holds the last press position after release. |
| **Local Position**<br>`localPosition` | `point` (distance) · advanced | Pointer position in points from the layer's own top-left corner, following its rotation and scale. |
| **Force**<br>`force` | `number` (progress) · advanced | How hard the screen is pressed, from 0 to 1; 0 for a mouse or when nothing is pressed. Range 0 to 1. |

## Examples

### Press to shrink a button

Down drives press feedback that springs back when you let go.

```text
layer button rectangle "Button" @126,700 150x56 cornerRadius=28 scale←shrink.output
patch press interaction layer=@button
patch pop popAnimation number←press.down bounciness=5 speed=20
patch shrink transition<number> progress←pop.output start=1 end=0.94
```

### Tap anywhere to dismiss a toast

With no layer set, taps anywhere on the screen count.

```text
layer toast rectangle "Toast" @16,780 370x64 cornerRadius=16 opacity←fade_out.output
patch tap_anywhere interaction
patch dismissed switch turnOn←tap_anywhere.tap
patch fade classicAnimation number←dismissed.on duration=0.2
patch fade_out transition<number> progress←fade.output start=1 end=0
```

## Common mistakes

- The layer grows while pressed and snaps back on release: Down turns off when you lift your finger. Wire Tap into a Switch's Flip when the change should stay.
- Nothing happens when you tap: the layer has opacity 0, Enabled off, or another layer sits in front of it. Turn on the viewer's hit target overlay, and use a Hit Area layer for invisible targets.
- Tapping a button inside a card also taps the card: presses bubble up to parent groups. Place the button in front of the card as a sibling instead of inside it.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Long Press](longPress.md): Turns on when a press is held still on a layer for a set time, and tells a quick tap apart from a hold.
- [Double Tap](doubleTap.md): Tells single taps from double taps, pulsing Double Tap on a quick second tap and Single Tap when no second tap comes.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Interaction (`builtin.layer.interaction`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
