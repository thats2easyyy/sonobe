<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Not

Outputs the opposite of an on/off value: on becomes off and off becomes on.

| | |
|---|---|
| Type key | `not` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>Shift</kbd>+<kbd>N</kbd> |
| Search terms | invert, negate, opposite, logical not, !, inverse, reverse boolean |

## How it works
Not flips an on/off value. When its input is on, the output is off. When the input is off, the output is on.

- **Value** is the on/off value (boolean) to flip. Numbers count as on when they're greater than 0.
- **Output** is the opposite of Value.

## Tips
- Hide something while a state is on: wire the state into Not and Not into the layer's Enabled or into an animation.
- Build "not equal" by wiring Equals Exactly into Not.
- With nothing connected, Value is off, so Output is on.

## Coming from Origami
Origami calls the input Boolean. Here it's Value; importers map it automatically.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `boolean` | `false` | The on/off value to flip. Numbers count as on when greater than 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while Value is off, and off while Value is on. |

## Examples

### Show a hint until someone presses the card

```text
layer card rectangle "Card" @16,120 370x220 cornerRadius=16
layer hint text "Hint" "Press and hold" @16,360 opacity←hint_fade.output
patch press interaction layer=@card
patch not_pressing not value←press.down
patch hint_fade popAnimation number←not_pressing.output
```

### Dim the feed when Home isn't selected

Equals Exactly plus Not gives "is not equal".

```text
layer home_hit hitArea "Home" @0,794 201x50
layer profile_hit hitArea "Profile" @201,794 201x50
layer feed group "Feed" @0,0 402x794 opacity←dim.output
patch tap_home interaction layer=@home_hit
patch tap_profile interaction layer=@profile_hit
patch tab optionSwitch[2] setTo0←tap_home.tap setTo1←tap_profile.tap
patch on_home equalsExactly<index>[2] value1←tab.option value2=0
patch elsewhere not value←on_home.output
patch fade popAnimation number←elsewhere.output
patch dim transition progress←fade.output start=1 end=0
```

## Common mistakes

- A Switch flips one frame late, right after the tap instead of on it: you wired Tap → Not → Flip, and Not rises back to on the frame after the tap. Use Not to gate with And, or wire the pulse directly.
- Something starts on the moment the prototype loads: an unconnected Not outputs on. Connect its Value before wiring the output to a layer.

## Pairs well with

- [And](and.md): Turns on only while every one of its inputs is on.
- [Or](or.md): Turns on while at least one of its inputs is on, which also merges several pulses into one cable.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Not (`builtin.logic.not`)

| Sonobe port | Origami label |
|---|---|
| `value` | Boolean |
