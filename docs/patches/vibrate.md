<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Vibrate

Buzzes the phone's vibration motor for a moment each time it gets a pulse.

| | |
|---|---|
| Type key | `vibrate` |
| Category | [Device](README.md#device) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | buzz, vibration, vibration motor, rumble, alert buzz, feedback |

## How it works
Vibrate buzzes the device's vibration motor. Each pulse (a signal that's on for one frame) into **Vibrate** starts a buzz that lasts **Duration** seconds. A pulse that arrives while a buzz is still going restarts it with the new duration.

**Available** is true when the device can vibrate. Android phones can, and so can an iPhone playing the preview in the Sonobe Viewer app. Safari on an iPhone and computers can't, so nothing happens there.

## Tips
- Wire an Interaction's Tap into Vibrate for confirmation feedback.
- Keep buzzes short: 0.05 to 0.15 s feels like a tap, and 0.4 s feels like an alert.
- For crisper feedback with named styles, use Haptic.
- Show a visual shake where Available is false.

## Coming from Origami
The unnamed input is called Vibrate. Duration and Available are new; Origami always plays the system buzz.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Vibrate**<br>`vibrate` | `pulse` | — | Pulse to start a buzz; a new pulse while one is running restarts it. |
| **Duration**<br>`duration` | `number` (duration) | `0.4` | How long each buzz lasts, in seconds; 0 does nothing. Range 0 to 10, step 0.05. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Available**<br>`available` | `boolean` | True when this device and browser can vibrate. |

## Examples

### Buzz when a button is tapped

```text
layer pay_button rectangle "Pay Button" @16,780 370x56 cornerRadius=14
patch tap_pay interaction layer=@pay_button
patch buzz vibrate vibrate←tap_pay.tap duration=0.08
```

### Buzz when a long press opens a menu

```text
layer menu_button rectangle "Menu Button" @126,700 150x56 cornerRadius=12
patch hold longPress layer=@menu_button
patch hold_started pulse on←hold.longPress
patch buzz vibrate vibrate←hold_started.turnedOn duration=0.15
```

## Common mistakes

- Nothing buzzes on an iPhone: iOS Safari doesn't let web pages vibrate. Open the preview in the Sonobe Viewer app, test on an Android phone, or show visual feedback where Available is false.
- The phone buzzes again and again: Vibrate is wired to a state that keeps turning on and off, and every rise sends a pulse. Wire in one pulse per event, like an Interaction's Tap.
- The first buzz at launch does nothing: browsers block vibration until the person has touched the page. Trigger it from a tap.

## Pairs well with

- [Haptic](haptic.md): Plays a short tactile tap or pattern, like a light impact or a success buzz, each time it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Long Press](longPress.md): Turns on when a press is held still on a layer for a set time, and tells a quick tap apart from a hold.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.

## Availability

**Web-limited.** Uses the Vibration API (navigator.vibrate), which Android browsers support, or the haptics of the Sonobe Viewer iPhone app. iOS Safari has no vibration API and computers have no motor, so nothing buzzes there.

Works in the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Vibrate (`origami.vibrate`)

| Sonobe port | Origami label |
|---|---|
| `vibrate` | Input |
