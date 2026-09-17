<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Game Controller

Reads a game controller's buttons, triggers, D-pad, and thumbsticks, for TV, console, and game prototypes.

| | |
|---|---|
| Type key | `gameController` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | gamepad, joystick, thumbstick, d-pad, xbox controller, playstation controller, mfi controller, tv remote, console |

## How it works
Game Controller reads a controller connected to the device, like an Xbox, PlayStation, or MFi controller. Browsers only reveal a controller after you press one of its buttons, so click the viewer and press any button first.

- **Connected** is true while the controller is available.
- **A**, **B**, **X**, **Y**, **L1**, **R1**, and **Home** are true while held.
- **L2** and **R2** are the triggers, from 0 (released) to 1 (fully pressed).
- **D-pad**, **Left Thumbstick**, and **Right Thumbstick** are points from [-1, -1] to [1, 1]. Pushing up gives a negative y, like layer positions, so you can add them to a position directly.
- **Controller** picks which one to read when several are connected, counting from 0.

## Tips
- Buttons are states: wire one into a Counter's Increase and it steps once per press.
- Multiply a thumbstick by a distance in points and add it to a resting position to move something.
- Raise Dead Zone (advanced) if a stick drifts while nobody touches it.

## Coming from Origami
Thumbstick and D-pad y points down instead of up. L2 and R2 are 0 to 1. Menu, Options, L3, and R3 are new advanced outputs.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Controller**<br>`controller` | `index` | `0` | Which connected controller to read, counting from 0 in the order they connected. At least 0, step 1. |
| **Dead Zone**<br>`deadZone` | `number` · advanced | `0.1` | How far a thumbstick must move before it counts, from 0 (none) to 0.9; hides stick drift near the center. Range 0 to 0.9, step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Connected**<br>`connected` | `boolean` | True while the chosen controller is connected and has been activated with a button press. |
| **A**<br>`buttonA` | `boolean` | True while the bottom face button is held. |
| **B**<br>`buttonB` | `boolean` | True while the right face button is held. |
| **X**<br>`buttonX` | `boolean` | True while the left face button is held. |
| **Y**<br>`buttonY` | `boolean` | True while the top face button is held. |
| **L1**<br>`leftShoulder` | `boolean` | True while the left shoulder button is held. |
| **R1**<br>`rightShoulder` | `boolean` | True while the right shoulder button is held. |
| **L2**<br>`leftTrigger` | `number` (progress) | How far the left trigger is pressed, from 0 (released) to 1 (all the way). |
| **R2**<br>`rightTrigger` | `number` (progress) | How far the right trigger is pressed, from 0 (released) to 1 (all the way). |
| **D-pad**<br>`dpad` | `point` | Directional pad as [x, y], each -1, 0, or 1; up is negative y. |
| **Left Thumbstick**<br>`leftThumbstick` | `point` | Left stick position from [-1, -1] (up left) to [1, 1] (down right); [0, 0] at rest. |
| **Right Thumbstick**<br>`rightThumbstick` | `point` | Right stick position from [-1, -1] (up left) to [1, 1] (down right); [0, 0] at rest. |
| **Home**<br>`home` | `boolean` | True while the home or logo button is held; some browsers keep this button for themselves. |
| **Menu**<br>`menu` | `boolean` · advanced | True while the menu or start button is held. |
| **Options**<br>`options` | `boolean` · advanced | True while the options, view, or select button is held. |
| **L3**<br>`leftThumbstickButton` | `boolean` · advanced | True while the left thumbstick is pressed in. |
| **R3**<br>`rightThumbstickButton` | `boolean` · advanced | True while the right thumbstick is pressed in. |
| **Acceleration**<br>`acceleration` | `point3d` · advanced | Controller acceleration in g where the platform reports it; [0, 0, 0] in browsers today. |
| **Rotation Rate**<br>`rotationRate` | `point3d` · advanced | Controller rotation speed in degrees per second where the platform reports it; [0, 0, 0] in browsers today. |

## Examples

### Step through tabs with the shoulder buttons

```text
layer highlight rectangle "Highlight" @16,200 370x56 cornerRadius=12 position←glide.output
patch pad gameController
patch focus counter increase←pad.rightShoulder decrease←pad.leftShoulder maximumCount=3
patch spot optionPicker<point>[3] option←focus.count option0=[16,200] option1=[16,264] option2=[16,328]
patch glide popAnimation<point> number←spot.output bounciness=3 speed=14
```

### Nudge a ball with the left thumbstick

```text
layer ball oval "Ball" @181,417 40x40 position←placed.output
patch pad gameController
patch reach multiply<point>[2] value1←pad.leftThumbstick value2=[120,120]
patch placed add<point>[2] value1←reach.output value2=[181,417]
```

## Common mistakes

- Connected stays false with a controller plugged in: browsers hide controllers until a button is pressed while the page has focus. Click the viewer, then press any button.
- Something moves up when you push the stick down: stick y is negative when pushed up, matching screen coordinates. Don't flip it unless your math expects up to be positive.
- One press triggers an action many times: buttons stay true while held. Wire them into pulse inputs, like a Counter's Increase, so each press counts once.

## Pairs well with

- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Web-limited.** Uses the Gamepad API. A controller appears only after someone presses one of its buttons while the viewer has focus, Chromium browsers require a secure page, and no browser reports controller motion.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Game Controller (`builtin.gamecontroller`)

| Sonobe port | Origami label |
|---|---|
| `buttonA` | A |
| `buttonB` | B |
| `buttonX` | X |
| `buttonY` | Y |
| `leftShoulder` | L1 |
| `rightShoulder` | R1 |
| `leftTrigger` | L2 |
| `rightTrigger` | R2 |
| `dpad` | D-pad |
| `rotationRate` | Rotation |
