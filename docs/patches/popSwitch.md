<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Pop Switch

Swipes or pinches a value between two states, then springs to the nearer one and reports whether it's on.

| | |
|---|---|
| Type key | `popSwitch` |
| Category | [Interaction](README.md#interaction) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | swipe switch, swipe between states, pinch to zoom, pinch rotate, two-state gesture, flick toggle, swipe card, legacy swipe |

## How it works
Pop Switch is a switch you control with a gesture. While a finger swipes or pinches **Layer**, **Output** follows it. On release, Output springs to **Start** (off) or **End** (on), whichever the flick was heading closer to.

- **Gesture** picks what drives Output: a one-finger swipe along x or y, or a two-finger pinch that scales, rotates, or moves.
- **Start** and **End** are in the gesture's units: points for swipes and pinch moves, a multiplier for Pinch Scale, degrees for Pinch Rotate.
- **Flip**, **Turn On**, and **Turn Off** are pulses (signals that are on for one frame) that change the state and animate there, like a Switch.
- **Bounciness** and **Speed** set the spring, the same as Pop Animation.
- **Progress** runs 0 at Start and 1 at End, and overshoots while bouncing. **On** is the committed state, and **Dragging** is true while fingers are on the layer.

## Tips
- Output is a number. Drive a layer's Position with Transition set to point, using Progress.
- Dragging past Start or End stretches with resistance, so the edges feel soft.
- Set Gesture to None to animate with the pulses only.

## Coming from Origami
Origami's Start Value, End Value, Value, and On/Off are Start, End, Output, and On here. Sonobe adds Dragging, rubber-band resistance past Start and End, and flick projection. On changes when the fingers lift rather than mid-drag.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to swipe or pinch; empty listens to the whole screen. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, gestures move the value; when off, only the pulses change it. |
| **Gesture**<br>`gesture` | `enum` | `swipeX` | Which gesture drives the value. |
| **Start**<br>`start` | `number` | `0` | The value when the switch is off, in the gesture's units. |
| **End**<br>`end` | `number` | `300` | The value when the switch is on, in the gesture's units; can be less than Start. |
| **Flip**<br>`flip` | `pulse` | — | Pulse to switch to the opposite state and animate there. |
| **Turn On**<br>`turnOn` | `pulse` | — | Pulse to turn on and animate to End. Does nothing if it's already on. |
| **Turn Off**<br>`turnOff` | `pulse` | — | Pulse to turn off and animate to Start. Does nothing if it's already off. |
| **Bounciness**<br>`bounciness` | `number` | `5` | How much the value bounces when it settles; 0 means no bounce. Range 0 to 20, step 0.5. |
| **Speed**<br>`speed` | `number` | `10` | How quickly the value settles; higher is faster. Range 0 to 20, step 0.5. |

**Gesture options**

- **None** (`none`): No gesture; animate with the pulses only.
- **Swipe X** (`swipeX`): One finger moving left and right, in points.
- **Swipe Y** (`swipeY`): One finger moving up and down, in points.
- **Pinch Scale** (`pinchScale`): Two fingers spreading apart or together, as a multiplier.
- **Pinch Rotate** (`pinchRotate`): Two fingers twisting, in degrees.
- **Pinch X** (`pinchX`): Two fingers moving together left and right, in points.
- **Pinch Y** (`pinchY`): Two fingers moving together up and down, in points.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` | The current value, following the fingers or springing toward Start or End. |
| **Progress**<br>`progress` | `number` (progress) | 0 at Start and 1 at End; goes past 0 or 1 while stretching or bouncing. |
| **On**<br>`on` | `boolean` | True when the switch is committed to End: after a release nearer End, or after Flip or Turn On. |
| **Dragging**<br>`dragging` | `boolean` | True while fingers are swiping or pinching the layer. |

## Examples

### Swipe a card between two spots

Progress drives a point Transition, so the card slides and bounces along x.

```text
layer card rectangle "Card" @24,200 300x180 position←slide.output
patch swipe_card popSwitch layer=@card gesture=swipeX start=0 end=300
patch slide transition<point> progress←swipe_card.progress start=[24,200] end=[324,200]
```

### Pinch to zoom a photo

```text
layer photo image "Photo" @0,236 402x402 scale←zoom.output
patch zoom popSwitch layer=@photo gesture=pinchScale start=1 end=2 bounciness=3
```

## Common mistakes

- The layer doesn't follow the finger: Output is a number, and nothing is linked to the layer. Feed Progress into a Transition set to point and link its output to Position, or link Output to a number property like Scale.
- The swipe snaps back the wrong way: Start and End are in points for swipes. For a card that slides left, make End negative.
- Pinching does nothing: pinch gestures need two fingers, and a mouse has one. Test pinches on a phone with the web player.

## Pairs well with

- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Pop Switch (`origami.popswitch`)
- **Also imports:** `origami.PopSwitch`

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `start` | Start Value |
| `end` | End Value |
| `output` | Value |
| `on` | On/Off |
