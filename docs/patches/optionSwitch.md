<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Option Switch

Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.

| | |
|---|---|
| Type key | `optionSwitch` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>Shift</kbd>+<kbd>I</kbd> |
| Search terms | index switch, multi state, tabs, radio buttons, segmented control, selected index, state machine, enum state |

## How it works
An Option Switch is a Switch with more than two states. It remembers one option number, counted from 0, and starts at 0.

- **Set to 0**, **Set to 1**, and so on switch to that option when they get a pulse (a signal that lasts one frame). A pulse for the option that's already selected changes nothing.
- **Option** is the current option number.
- Change the number of options to add or remove Set to inputs.
- If several options get pulses in the same frame, the highest option number wins.

## Tips
- Feed Option into Option Picker to choose a position, color, or title for each option.
- For two states, use Switch. To step through options in order, use Counter.
- To track which item in a loop was tapped, use Loop Option Switch.

## Coming from Origami
Formerly called Index Switch.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Set to 0, Set to 1, …** (`setTo0`, `setTo1`, …) · `pulse`

Pulse to switch to this option number.

A patch can have 2 to 32 of these, and a new patch starts with 3.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Option**<br>`option` | `index` | The current option, counted from 0. Starts at 0. |

## Examples

### Tab bar that slides between three screens

```text
layer screens group "Screens" @0,0 1170x760 position←slide.output
layer tab_feed rectangle "Feed Tab" @0,780 130x64
layer tab_search rectangle "Search Tab" @130,780 130x64
layer tab_profile rectangle "Profile Tab" @260,780 130x64
patch tap_feed interaction layer=@tab_feed
patch tap_search interaction layer=@tab_search
patch tap_profile interaction layer=@tab_profile
patch tabs optionSwitch[3] setTo0←tap_feed.tap setTo1←tap_search.tap setTo2←tap_profile.tap
patch screen_x optionPicker<point>[3] option←tabs.option option0=[0,0] option1=[-390,0] option2=[-780,0]
patch slide popAnimation<point> number←screen_x.output bounciness=0 speed=20
```

### Traffic light timed sequence

Both Waits start at launch, so each duration counts from the start, not from the previous step.

```text
layer light oval "Light" @145,300 100x100 color←light_color.output
patch launch whenPrototypeStarts
patch to_yellow wait start←launch.started duration=2
patch to_red wait start←launch.started duration=3
patch signal optionSwitch[3] setTo1←to_yellow.finished setTo2←to_red.finished
patch light_color optionPicker<color>[3] option←signal.option option0="#34C759FF" option1="#FFCC00FF" option2="#FF3B30FF"
```

## Common mistakes

- Each tab shows the next tab's screen: options count from 0, so the first tab belongs in Set to 0. Move each tab's wire down by one.
- Extra tabs all show the same screen: the Option Picker has fewer options than the Option Switch, so higher options stick on its last value. Give both patches the same number of options.
- Tapping an item in a loop changes only that item: a loop of taps gives every item its own Option Switch. Use Loop Option Switch to track which single item was tapped.

## Pairs well with

- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Option Sender](optionSender.md): Sends a value to the one selected output and a default to all the others, like highlighting only the active tab.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Loop Option Switch](loopOptionSwitch.md): Remembers which item in a loop pulsed most recently, like which tab or card was tapped.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Option Switch (`builtin.indexswitch`)
