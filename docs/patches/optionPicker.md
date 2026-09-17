<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Option Picker

Outputs one of several values chosen by an option number, like a different color or title for each tab.

| | |
|---|---|
| Type key | `optionPicker` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>O</kbd> |
| Search terms | multiplexer, mux, if statement, case statement, select value, choose value, lookup, pick one |

## How it works
Option Picker holds a list of values and outputs one of them, like an if or case statement in code.

- **Option** chooses which value to output, counted from 0.
- **Option 0**, **Option 1**, and so on are the values. Change the number of options to add more.
- **Output** is the chosen value. It switches on the same frame Option changes, without animating.
- An Option past the last value picks the last one, a negative Option picks Option 0, and fractions round down.

Change the patch's type to pick numbers, text, colors, points, images, and more.

## Tips
- Wire a Switch's On into Option to choose between two values: off picks Option 0, on picks Option 1.
- Pair it with Option Switch or Counter to keep track of the selected option.
- Put a Pop Animation of the same type after it to animate between values instead of jumping.

## Coming from Origami
Formerly called Multiplexer.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Option**<br>`option` | `index` | `0` | Which value to output, counted from 0. Past the last option picks the last one; negative picks Option 0. At least 0, step 1. |

### Repeating inputs

**Option 0, Option 1, …** (`option0`, `option1`, …) · `variant` · default `0`

The value to output when Option is this number.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The value of the selected option. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Like button that turns red

```text
layer like_button rectangle "Like Button" @171,400 48x48 cornerRadius=24 color←button_color.output
patch tap_like interaction layer=@like_button
patch liked switch flip←tap_like.tap
patch button_color optionPicker<color>[2] option←liked.on option0="#8E8E93FF" option1="#FF3B30FF"
```

### Title for each tab

```text
layer title text "Title" @24,70 text←title_text.output
layer tab_home rectangle "Home Tab" @0,780 130x64
layer tab_alerts rectangle "Alerts Tab" @130,780 130x64
layer tab_profile rectangle "Profile Tab" @260,780 130x64
patch tap_home interaction layer=@tab_home
patch tap_alerts interaction layer=@tab_alerts
patch tap_profile interaction layer=@tab_profile
patch tabs optionSwitch[3] setTo0←tap_home.tap setTo1←tap_alerts.tap setTo2←tap_profile.tap
patch title_text optionPicker<text>[3] option←tabs.option option0="Home" option1="Notifications" option2="Profile"
```

## Common mistakes

- The value jumps instead of animating: Option Picker switches instantly. Feed its output into a Pop Animation of the same type to animate between values.
- The picker sticks on its last value: Option is past the end, and the picker clamps instead of wrapping. Add options, or set the Counter's Maximum Count to the number of options.
- You can't enter colors or text as options: the patch is set to Number. Change its type to Color or Text first.

## Pairs well with

- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Option Equals](optionEquals.md): Finds which option a value matches and outputs its number, or −1 when nothing matches.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Option Picker (`builtin.multiplexer`)
