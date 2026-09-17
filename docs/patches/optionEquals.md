<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Option Equals

Finds which option a value matches and outputs its number, or −1 when nothing matches.

| | |
|---|---|
| Type key | `optionEquals` |
| Category | [State & Time](README.md#state--time) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | match, index of, find option, which option, equals any, one of, lookup index, switch case |

## How it works
Option Equals compares **Value** with each option, starting from Option 0.

- **Option** is the number of the first option that equals Value, counted from 0. It's −1 when nothing matches.
- **Equals** is true when any option matches.
- Change the number of options to add more, and change the patch's type to compare text, colors, points, JSON, and more.

Text must match exactly, including capital letters and spaces. Colors match when they look identical. Numbers must be exactly equal, so compare whole numbers or round first.

## Tips
- Turn text from data, such as a weather condition, into an option number, then feed Option into Option Picker to choose an icon.
- Wire Equals into a layer's Enabled to show something only for certain values.

## Coming from Origami
Files that use the older Option Equals import with the current behavior: Option is −1 when nothing matches.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to look for among the options. |

### Repeating inputs

**Option 0, Option 1, …** (`option0`, `option1`, …) · `variant` · default `0`

A value to compare with Value; the first one that matches sets Option.

A patch can have 2 to 32 of these, and a new patch starts with 3.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Option**<br>`option` | `index` | The number of the first option equal to Value, counted from 0, or −1 when none match. |
| **Equals**<br>`equals` | `boolean` | True when Value matches any option. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`.

## Examples

### Mark weekend days in a week strip

The loop replicates the label seven times inside the row; indices 5 and 6 turn red.

```text
layer week group "Week" @16,120 358x44 layout=row
  layer day_label text "Day" textColor←day_color.output
patch days loop count=7
patch weekend optionEquals<index>[2] value←days.index option0=5 option1=6
patch day_color optionPicker<color>[2] option←weekend.equals option0="#1C1C1EFF" option1="#FF3B30FF"
```

### Show a filter button only on two tabs

```text
layer filter_button rectangle "Filter" @330,60 44x44 enabled←has_filter.equals
layer tab_home rectangle "Home Tab" @0,780 98x64
layer tab_inbox rectangle "Inbox Tab" @98,780 98x64
layer tab_search rectangle "Search Tab" @196,780 98x64
layer tab_profile rectangle "Profile Tab" @294,780 98x64
patch tap_home interaction layer=@tab_home
patch tap_inbox interaction layer=@tab_inbox
patch tap_search interaction layer=@tab_search
patch tap_profile interaction layer=@tab_profile
patch tabs optionSwitch[4] setTo0←tap_home.tap setTo1←tap_inbox.tap setTo2←tap_search.tap setTo3←tap_profile.tap
patch has_filter optionEquals<index>[2] value←tabs.option option0=1 option1=3
```

## Common mistakes

- Unmatched values show the first option's result: Option is −1 when nothing matches, and Option Picker clamps −1 to Option 0. Use Equals to hide the result, or put a fallback in the picker's Option 0 and add 1 to Option.
- Text never matches: comparisons are exact, so "Rain" doesn't equal "rain" or "Rain ". Make the options match the data exactly, including capitals and spaces.
- A number from an animation or math never matches: numbers compare exactly, and 0.1 + 0.2 isn't exactly 0.3. Round the value first.

## Pairs well with

- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Option Equals (`builtin.optionequals`)
- **Also imports:** `builtin.optionEquals2`
