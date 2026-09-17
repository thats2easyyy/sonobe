<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Counter

Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.

| | |
|---|---|
| Type key | `counter` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | increment, decrement, count up, tally, step counter, page number, carousel index, wrap around |

## How it works
A Counter remembers a whole number, starting at 0, and changes it when a pulse (a signal that lasts one frame) arrives.

- **Increase** adds 1 and **Decrease** subtracts 1. If both fire in the same frame, they cancel out.
- **Jump** sets the count to **Jump to Number**. It beats Increase and Decrease in the same frame.
- **Maximum Count** makes the count wrap: with 3 it runs 0, 1, 2, then back to 0, and decreasing from 0 goes to 2. A Jump outside that range goes to 0. Leave it at 0 for no limit; the count can then go negative.
- **Count** is the current number. Fractional inputs round down.

## Tips
- Feed Count into Option Picker to show a different title, image, or position for each step.
- For page dots, compare Count with each dot's loop index using Equals Exactly.
- To stop at the last step instead of wrapping, leave Maximum Count at 0 and only let Next's tap through while Count is below the last step (Less Than plus And).

## Coming from Origami
The output is named Count.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Increase**<br>`increase` | `pulse` | — | Pulse to add 1 to the count. |
| **Decrease**<br>`decrease` | `pulse` | — | Pulse to subtract 1 from the count. |
| **Jump**<br>`jump` | `pulse` | — | Pulse to set the count to Jump to Number. Beats Increase and Decrease in the same frame. |
| **Jump to Number**<br>`jumpToNumber` | `number` | `0` | The whole number the count takes when Jump fires; with a Maximum Count, numbers outside 0 to Maximum Count − 1 send it to 0. step 1. |
| **Maximum Count**<br>`maximumCount` | `number` | `0` | How many values the count cycles through: 3 wraps it through 0, 1, 2. 0 means no limit. At least 0, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Count**<br>`count` | `number` | The current whole number, starting at 0. step 1. |

## Examples

### Next and back buttons for a three-page carousel

Transition extrapolates past 1, so page 2 slides the group to x = −780.

```text
layer pages group "Pages" @0,0 1170x760 position←slide.output
layer back_button rectangle "Back" @16,780 120x44
layer next_button rectangle "Next" @254,780 120x44
patch tap_back interaction layer=@back_button
patch tap_next interaction layer=@next_button
patch page counter increase←tap_next.tap decrease←tap_back.tap maximumCount=3
patch settle popAnimation number←page.count bounciness=0 speed=16
patch slide transition<point> progress←settle.output start=[0,0] end=[-390,0]
```

### Onboarding titles that change per step

```text
layer title text "Title" @24,120 text←title_text.output
layer next_button rectangle "Next" @24,760 342x52
patch tap_next interaction layer=@next_button
patch step counter increase←tap_next.tap maximumCount=3
patch title_text optionPicker<text>[3] option←step.count option0="Enter your name" option1="Verify your email" option2="You're all set"
```

## Common mistakes

- The last page never shows: counting starts at 0, so 3 pages use 0, 1, and 2. Set Maximum Count to the number of pages (3), not the last page number.
- Going past the last step jumps back to the first: Maximum Count wraps around. Set it to 0 for no limit, and block Next at the end if the count should stop.
- Jump sends the count to 0 instead of your number: Jump to Number is outside 0 to Maximum Count − 1. Raise Maximum Count or pick a number inside the range.

## Pairs well with

- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Pulse on Change](pulseOnChange.md): Sends a pulse whenever a watched value changes, such as a new page number or a different tab.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Counter (`builtin.counter`)

| Sonobe port | Origami label |
|---|---|
| `count` | Output |
