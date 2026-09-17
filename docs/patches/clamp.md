<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Clamp

Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.

| | |
|---|---|
| Type key | `clamp` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | clip, limit, bound, constrain, keep in range, min max, cap |

## How it works
Clamp lets a value through untouched while it's between **Min** and **Max**. Past either limit, the output holds at that limit.

- **Value** is what you want to keep in range.
- **Min** is the lowest allowed value and **Max** is the highest. If Min is greater than Max, Clamp swaps them, so the order doesn't matter.
- Vectors clamp each component separately, which keeps a point inside a rectangle.

## Tips
- Clamp progress to 0–1 before a Transition so a bouncy scroll can't push the animation past its ends.
- Bound a feedback loop: Add → Clamp → back into Add keeps a running total inside a range.
- Converting ranges anyway? Remap has a Clamp to Range option.

## Coming from Origami
This is Origami's **Clip** patch, renamed so it isn't confused with a layer's Clip Contents. Clip only handles numbers; Clamp also handles vectors. Origami doesn't document Min greater than Max; Clamp swaps them.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to keep in range. |
| **Min**<br>`min` | `variant` | `0` | The lowest value allowed through. |
| **Max**<br>`max` | `variant` | `1` | The highest value allowed through. If it's below Min, the two limits swap. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value, held between Min and Max. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `point` | `max` | `[1, 1]` |
| `point3d` | `max` | `[1, 1, 1]` |
| `point4d` | `max` | `[1, 1, 1, 1]` |
| `size` | `max` | `[1, 1]` |

## Examples

### Keep a card on screen while dragging

The card is 120 pt square on a 390 × 844 screen, so its top-left stays between [0, 0] and [270, 724].

```text
layer card rectangle "Card" @16,300 120x120 cornerRadius=24 position←keep_on_screen.output
patch move drag layer=@card
patch keep_on_screen clamp<point> value←move.position min=[0,0] max=[270,724]
```

## Common mistakes

- The layer won't move at all: Min and Max are equal (both 0 after changing the type), so every value holds at one number. Set Max to the far limit, such as the content height.
- The layer still slides past the edge: Clamp only changes its own output. Wire Clamp's Output into the layer's Position, not the original value.

## Pairs well with

- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Clip (`builtin.range`)
