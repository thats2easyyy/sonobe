<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Option Sender

Sends a value to the one selected output and a default to all the others, like highlighting only the active tab.

| | |
|---|---|
| Type key | `optionSender` |
| Category | [State & Time](README.md#state--time) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | demultiplexer, demux, route value, send to one, one hot, exclusive, selected output, highlight active |

## How it works
Option Sender is the reverse of Option Picker: one value goes in, and it comes out of whichever output you choose.

- **Option** chooses the output, counted from 0.
- **Value** comes out of the chosen output.
- **Default** comes out of every other output.
- Change the number of options to add outputs. An Option past the last output picks the last one, a negative Option picks Option 0, and fractions round down.

Change the patch's type to send booleans, colors, numbers, text, and more.

## Tips
- Set the type to Boolean, with Value on and Default off, and wire the outputs into each screen's Enabled to show only the selected screen.
- Use Color with a bright Value and a gray Default to highlight the active tab.
- Feed each output into its own Pop Animation to animate the change.

## Coming from Origami
Formerly called Demultiplexer. New patches start with Value 1 and Default 0 so the selected output stands out.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Option**<br>`option` | `index` | `0` | Which output gets Value, counted from 0. Past the last output picks the last one; negative picks Option 0. At least 0, step 1. |
| **Value**<br>`value` | `variant` | `1` | What the selected output sends. |
| **Default**<br>`default` | `variant` | `0` | What every other output sends. |

## Outputs

This patch has no fixed outputs.

### Repeating outputs

**Option 0, Option 1, …** (`option0`, `option1`, …) · `variant`

Sends Value when Option is this number, and Default otherwise.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `boolean` | `value` | `true` |
| `boolean` | `default` | `false` |
| `index` | `value` | `1` |
| `index` | `default` | `0` |

## Examples

### Show only the selected screen

```text
layer feed_screen group "Feed" @0,0 390x760 enabled←visible.option0
layer search_screen group "Search" @0,0 390x760 enabled←visible.option1
layer profile_screen group "Profile" @0,0 390x760 enabled←visible.option2
layer tab_feed rectangle "Feed Tab" @0,780 130x64
layer tab_search rectangle "Search Tab" @130,780 130x64
layer tab_profile rectangle "Profile Tab" @260,780 130x64
patch tap_feed interaction layer=@tab_feed
patch tap_search interaction layer=@tab_search
patch tap_profile interaction layer=@tab_profile
patch tabs optionSwitch[3] setTo0←tap_feed.tap setTo1←tap_search.tap setTo2←tap_profile.tap
patch visible optionSender<boolean>[3] option←tabs.option value=true default=false
```

### Highlight the active range label

```text
layer label_day text "Day" @40,800 textColor←label_colors.option0
layer label_week text "Week" @170,800 textColor←label_colors.option1
layer label_month text "Month" @300,800 textColor←label_colors.option2
patch tap_day interaction layer=@label_day
patch tap_week interaction layer=@label_week
patch tap_month interaction layer=@label_month
patch range optionSwitch[3] setTo0←tap_day.tap setTo1←tap_week.tap setTo2←tap_month.tap
patch label_colors optionSender<color>[3] option←range.option value="#0A84FFFF" default="#8E8E93FF"
```

## Common mistakes

- Every output looks the same: Value and Default are equal, which is where the Text and Color types start. Set Value to the selected look and Default to the unselected one.
- A tap reaches every item instead of the selected one: Option Sender sends values, not pulses. Send a boolean, and combine it with the tap using And.

## Pairs well with

- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Loop Option Switch](loopOptionSwitch.md): Remembers which item in a loop pulsed most recently, like which tab or card was tapped.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Option Sender (`builtin.demultiplexer`)
