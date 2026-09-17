<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Equals Exactly

Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.

| | |
|---|---|
| Type key | `equalsExactly` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | same as, identical, is equal, equal to, match, ==, ===, exact match |

## How it works
Equals Exactly turns on when all of its values are identical. It's the go-to check for "is this the selected tab?" or "did they type the right code?"

- **Value 1, Value 2, …** are the values to compare. Change the type to compare indexes, text, colors, points, options, or JSON. Add inputs to require more values to match.
- **Output** is on while every value equals Value 1.

What counts as equal:
- **Text** must match character for character, including capitals and spaces.
- **Colors** match when their hex codes match.
- **Points and sizes** match when every component matches.
- **JSON** matches when the structure and values match; key order doesn't matter.

## Tips
- Compare a Loop's Index with the selected option to highlight one item in a looped list.
- Wire the output into Not for "is not equal".
- Numbers from animations or division rarely match exactly. Use Equals with a tolerance for those.

## Coming from Origami
Origami's ports are unnamed and its type menu shows number, index, and boolean. Here the ports are Value 1, Value 2, … and more types are available.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value to compare; Value 1 is the one every other value must match.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while every value is exactly equal to Value 1. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`.

## Examples

### Highlight the selected tab

One looped tab bar; each tab compares its index with the selected option.

```text
layer tab_row group "Tab Row" @0,794 402x50 layout=row
  layer tab rectangle "Tab" 134x50 color←tab_color.output
layer home_hit hitArea "Home" @0,794 134x50
layer search_hit hitArea "Search" @134,794 134x50
layer profile_hit hitArea "Profile" @268,794 134x50
patch tap_home interaction layer=@home_hit
patch tap_search interaction layer=@search_hit
patch tap_profile interaction layer=@profile_hit
patch selected optionSwitch[3] setTo0←tap_home.tap setTo1←tap_search.tap setTo2←tap_profile.tap
patch tabs loop count=3
patch is_selected equalsExactly<index>[2] value1←tabs.index value2←selected.option
patch highlight popAnimation number←is_selected.output
patch tab_color transition<color> progress←highlight.output start=#F2F2F7FF end=#111111FF
```

### Show Get Started on the last page

```text
layer dot_1 oval "Dot 1" @163,780 12x12
layer dot_2 oval "Dot 2" @195,780 12x12
layer dot_3 oval "Dot 3" @227,780 12x12
layer start_button rectangle "Get Started" @24,700 354x56 cornerRadius=28 opacity←button_fade.output
patch tap_1 interaction layer=@dot_1
patch tap_2 interaction layer=@dot_2
patch tap_3 interaction layer=@dot_3
patch page optionSwitch[3] setTo0←tap_1.tap setTo1←tap_2.tap setTo2←tap_3.tap
patch on_last equalsExactly<index>[2] value1←page.option value2=2
patch button_fade popAnimation number←on_last.output
```

## Common mistakes

- An animation's output never equals its target, so the check stays off: animated numbers stop at values like 0.99997. Use Equals with a small tolerance instead.
- Every item in a looped list lights up, or none does: you compared the selected option with a fixed number instead of the Loop's Index. Wire the Loop's Index into Value 1 and the selected option into Value 2.
- "Yes" doesn't match "yes ": text comparison is exact. Clean the text first with Change Case or Text Replace.

## Pairs well with

- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Option Equals](optionEquals.md): Finds which option a value matches and outputs its number, or −1 when nothing matches.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Equals Exactly (`builtin.compare.eq`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0, base value) |
| `value2` | Input (port 1) |
