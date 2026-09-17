<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Long Press

Turns on when a press is held still on a layer for a set time, and tells a quick tap apart from a hold.

| | |
|---|---|
| Type key | `longPress` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | hold, press and hold, long tap, touch and hold, context menu, hold to confirm, peek |

## How it works
Long Press turns **on** once a press has been held for **Duration** seconds without moving 10 points or more. It turns off when the finger lifts.

- **Layer** is the layer to watch. Leave it empty to watch the whole screen.
- **Progress** runs from 0 to 1 while the press is held, so you can draw a filling ring or bar.
- **Tap** pulses when a press lifts before it became a long press, so a tap and a hold on the same layer can do different things.
- Once Long Press is on, moving the finger doesn't end it, so you can slide to a menu item.
- **Down** accepts another patch's Down output instead of watching Layer. In that mode movement isn't checked.

## Tips
- Wire Long Press into a Switch's Turn On to open a menu that stays open after you lift.
- Use about 0.4 s for menus and 1 to 2 s for hold-to-confirm actions.
- Pair it with Vibrate so people feel the moment the hold registers.

## Coming from Origami
Origami's Long Press only takes Interaction's Down. You can still wire that, but setting Layer adds the stay-still check. The Delay input is called Duration here.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to watch for a press and hold. Leave empty to watch the whole screen; ignored when Down is connected. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, presses are ignored and Long Press stays off. |
| **Down**<br>`down` | `boolean` | `false` | Connect another patch's Down output to time that press instead of watching Layer; movement isn't checked in this mode. |
| **Duration**<br>`duration` | `number` (duration) | `0.5` | How long the press must be held, in seconds; 0 turns on as soon as the press begins. At least 0, step 0.1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Long Press**<br>`longPress` | `boolean` | True once the press has been held still for Duration, until the finger lifts. |
| **Progress**<br>`progress` | `number` (progress) | How far along the hold is, from 0 at the press to 1 when Long Press turns on; 0 when not pressed or after moving. Range 0 to 1. |
| **Tap**<br>`tap` | `pulse` | Pulses when a press lifts before it became a long press, like a regular tap. |

## Examples

### Hold a photo to peek

```text
layer photo rectangle "Photo" @16,200 370x370 cornerRadius=16 scale←grow.output
patch hold longPress layer=@photo duration=0.4
patch pop popAnimation number←hold.longPress bounciness=8 speed=12
patch grow transition<number> progress←pop.output start=1 end=1.1
```

### Tap to expand, hold for a menu

One layer, two actions: Tap toggles the card's size, and holding opens a menu that the next tap closes.

```text
layer card rectangle "Card" @16,200 370x220 cornerRadius=20 scale←grow.output
layer menu rectangle "Menu" @96,440 210x180 cornerRadius=14 opacity←fade.output
patch press longPress layer=@card
patch expanded switch flip←press.tap
patch pop popAnimation number←expanded.on
patch grow transition<number> progress←pop.output start=1 end=1.05
patch menu_open switch turnOn←press.longPress turnOff←press.tap
patch fade classicAnimation number←menu_open.on duration=0.2
```

## Common mistakes

- A hold also triggers the tap action: Interaction's Tap fires on release no matter how long you held. Use Long Press's own Tap output for the quick-tap action.
- The menu closes when you lift your finger: Long Press is a state that turns off on release. Wire it into a Switch's Turn On so the menu stays open.
- Long Press never turns on inside a scrolling list: the finger drifts 10 points or more while holding, which cancels the hold. Hold still, or check that the list isn't moving under the finger.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Vibrate](vibrate.md): Buzzes the phone's vibration motor for a moment each time it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Long Press (`origami.longpress`)
- **Also imports:** `origami.LongPress`

| Sonobe port | Origami label |
|---|---|
| `duration` | Delay |
