<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# In Range

Checks whether a number lies between a minimum and a maximum, and tells you if it's below or above instead.

| | |
|---|---|
| Type key | `inRange` |
| Category | [Logic](README.md#logic) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | between, is between, within range, range check, inside bounds, window, band, out of bounds |

## How it works
In Range answers "is this number between A and B?" and, if not, which side it's on. Exactly one of its three outputs is on at a time.

- **Value** is the number to check.
- **Min** and **Max** are the edges of the range. If Min is bigger than Max, the patch swaps them.
- **Bounds** says whether a value sitting exactly on an edge counts. The default includes both edges.
- **In Range** is on while Value is inside the range.
- **Below** is on while Value is under the range. **Above** is on while it's over the range.

## Tips
- Use Include Min when you split a scroll or a list into sections, like 0–100, 100–200, and so on. A value on a shared edge then belongs to exactly one section.
- Wire Above or Below into a Switch or a Pulse to react to overscroll past either end.
- To force a value back into the range, use Clamp.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `number` | `0` | The number to check. |
| **Min**<br>`min` | `number` | `0` | The lower edge of the range; if it's bigger than Max, the two are swapped. |
| **Max**<br>`max` | `number` | `1` | The upper edge of the range; if it's smaller than Min, the two are swapped. |
| **Bounds**<br>`bounds` | `enum` · advanced | `includeBoth` | Whether a value exactly on Min or Max counts as in range. |

**Bounds options**

- **Include Both** (`includeBoth`): Min ≤ Value ≤ Max: values on either edge count as in range.
- **Include Min** (`includeMin`): Min ≤ Value < Max: good for splitting a line into sections that don't overlap.
- **Include Max** (`includeMax`): Min < Value ≤ Max.
- **Exclude Both** (`excludeBoth`): Min < Value < Max: values on either edge are out of range.

## Outputs

| Output | Type | Description |
|---|---|---|
| **In Range**<br>`inRange` | `boolean` | On while Value is between Min and Max, following Bounds. |
| **Below**<br>`below` | `boolean` | On while Value is under the range (or on an excluded lower edge). |
| **Above**<br>`above` | `boolean` | On while Value is over the range (or on an excluded upper edge). |

## Examples

### Show a note halfway through a timer

```text
layer start_button rectangle "Start" @24,700 354x56 cornerRadius=28
layer note text "Note" "Halfway there" @140,640 opacity←note_fade.output
patch tap_start interaction layer=@start_button
patch timer wait start←tap_start.tap duration=6
patch middle inRange value←timer.progress min=0.4 max=0.6
patch note_fade popAnimation number←middle.inRange
```

### Highlight cells 3 to 5 in a looped row

```text
layer row group "Row" @16,120 370x40 layout=row spacing=4
  layer cell rectangle "Cell" 33x40 cornerRadius=6 color←cell_color.output
patch cells loop count=10
patch visible inRange value←cells.index min=3 max=6 bounds=includeMin
patch cell_color transition<color> progress←visible.inRange start=#E5E5EAFF end=#34C759FF
```

## Common mistakes

- Two neighboring sections are both on when the value sits on their shared edge: Include Both counts the edge in both ranges. Set Bounds to Include Min.
- The range check is always off with Min and Max both set to the same number: with that setup only an exact match counts, and only when Bounds is Include Both. Give the range some width.

## Pairs well with

- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [Less Than](lessThan.md): Checks whether a value is less than another, such as a scroll pulled past the top or an item before the current one.
- [And](and.md): Turns on only while every one of its inputs is on.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
