<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Double Tap

Tells single taps from double taps, pulsing Double Tap on a quick second tap and Single Tap when no second tap comes.

| | |
|---|---|
| Type key | `doubleTap` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | double click, tap twice, single tap, double tap to like, multi tap, tap count |

## How it works
Double Tap waits a short time after each tap to see whether a second one follows.

- **Double Tap** pulses right on the second tap, when it lands within **Interval** seconds of the first.
- **Single Tap** pulses when Interval runs out after a lone tap, so it always arrives a little late.
- **Layer** is the layer to watch. Leave it empty to watch the whole screen.
- **Tap** accepts pulses from another patch, like Interaction's Tap, instead of watching Layer.

A third quick tap starts a new wait, so three taps give a Double Tap and then a Single Tap.

## Tips
- Lower Interval to about 0.2 s when single taps must feel responsive. Raise it to about 0.4 s when double taps are hard to hit.
- Double-tap to like: wire Double Tap into a Switch's Turn On, so another double tap doesn't unlike.

## Coming from Origami
Origami's Delay input is called Interval. Wiring Interaction's Tap into Tap still works.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to watch for taps. Leave empty to watch the whole screen; ignored when Tap is connected. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, taps are ignored and a waiting single tap is discarded. |
| **Tap**<br>`tap` | `pulse` | — | Pulse to count a tap, for example from Interaction's Tap, instead of watching Layer. |
| **Interval**<br>`interval` | `number` (duration) | `0.3` | The longest time between two taps that still counts as a double tap, in seconds; 0 turns double taps off. At least 0, step 0.05. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Double Tap**<br>`doubleTap` | `pulse` | Pulses on the second tap when it lands within Interval of the first. |
| **Single Tap**<br>`singleTap` | `pulse` | Pulses when Interval ends after a tap with no second tap. |

## Examples

### Double-tap to like, tap to show controls

```text
layer photo rectangle "Photo" @0,120 402x402
layer heart oval "Heart" @161,281 80x80 color=#FF3040FF scale←heart_pop.output
layer controls rectangle "Controls" @0,760 402x114 opacity←controls_fade.output
patch taps doubleTap layer=@photo
patch liked switch turnOn←taps.doubleTap
patch heart_pop popAnimation number←liked.on bounciness=10 speed=14
patch controls_on switch flip←taps.singleTap
patch controls_fade classicAnimation number←controls_on.on duration=0.2
```

### Double-tap to zoom

The Origami-style wiring: Interaction's Tap feeds Double Tap.

```text
layer photo rectangle "Photo" @0,200 402x402 scale←zoom.output
patch touch interaction layer=@photo
patch taps doubleTap tap←touch.tap interval=0.25
patch zoomed switch flip←taps.doubleTap
patch pop popAnimation number←zoomed.on bounciness=4 speed=14
patch zoom transition<number> progress←pop.output start=1 end=2
```

## Common mistakes

- Single taps feel slow: Single Tap waits for Interval in case a second tap comes. Use Interaction's Tap on layers that have no double-tap action, or lower Interval.
- Double-tapping again unlikes the photo: Double Tap is wired into Flip. Wire it into Turn On so repeated double taps keep it liked.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Double Tap (`origami.doubletap`)

| Sonobe port | Origami label |
|---|---|
| `interval` | Delay |
