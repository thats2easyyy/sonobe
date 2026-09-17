<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Switch

Remembers whether something is on or off and changes when it gets a pulse.

| | |
|---|---|
| Type key | `switch` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>S</kbd> |
| Search terms | toggle, on off, flip flop, boolean state, light switch, latch, two states |

## How it works
A Switch works like a light switch: it stays **on** or **off** until a pulse (a signal that lasts one frame) changes it. It starts off.

- **Flip** changes it to the opposite state. Use it when one control toggles, like tapping a photo to zoom in and out.
- **Turn On** and **Turn Off** set the state directly and do nothing if the switch is already there. Use them when separate controls open and close something, like a Compose button and a Cancel button.
- **On** is true while the switch is on. Wired into a number port, it reads as 1 or 0.
- If pulses arrive on more than one input in the same frame, Turn Off wins, then Turn On, then Flip.

## Tips
- Connect On to an animation's Number so the change animates instead of jumping.
- A state such as Down wired into Flip flips once each time that state turns on.
- Need more than two states? Use Option Switch.

## Coming from Origami
The output is named On instead of On / Off.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Flip**<br>`flip` | `pulse` | — | Pulse to switch to the opposite state. |
| **Turn On**<br>`turnOn` | `pulse` | — | Pulse to turn the switch on. Does nothing if it's already on. |
| **Turn Off**<br>`turnOff` | `pulse` | — | Pulse to turn the switch off. Does nothing if it's already off. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **On**<br>`on` | `boolean` | True while the switch is on; reads as 1 or 0 when wired into a number. |

## Examples

### Tap to grow a card

Interaction, Switch, Pop Animation, Transition: the most common chain for tap interactions.

```text
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch grow transition<number> progress←pop.output start=1 end=1.08
```

### Open and close a menu with two buttons

Separate buttons use Turn On and Turn Off, so tapping Menu twice keeps the menu open.

```text
layer menu_button rectangle "Menu Button" @16,60 44x44
layer menu rectangle "Menu" @16,120 358x300 opacity←fade.output
layer close_button rectangle "Close Button" @330,60 44x44
patch tap_menu interaction layer=@menu_button
patch tap_close interaction layer=@close_button
patch menu_open switch turnOn←tap_menu.tap turnOff←tap_close.tap
patch fade popAnimation number←menu_open.on bounciness=0 speed=14
```

## Common mistakes

- The layer springs back when you lift your finger: Down is a state that turns off on release. Wire Tap into Flip when the change should stay.
- The switch never turns off: the same pulse also reaches Turn On, and Turn On beats Flip. Give each input its own pulse source.
- The layer disappears while the switch is off: On reads as 0, and a Scale or Opacity of 0 hides the layer. Put a Transition after it with Start set to the resting value, such as 1.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Switch (`builtin.switch`)

| Sonobe port | Origami label |
|---|---|
| `on` | On / Off |
