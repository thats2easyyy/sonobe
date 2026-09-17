<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Option Switch

Remembers which item in a loop pulsed most recently, like which tab or card was tapped.

| | |
|---|---|
| Type key | `loopOptionSwitch` |
| Category | [Loops](README.md#loops) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | which one was tapped, selected index, tab selection, radio group, segmented control, single select, last pulsed, loop index switch |

## How it works
Loop Option Switch watches a loop of pulses, signals that are on for one frame, and remembers the position of the last item that fired. It starts at 0 and holds its value until another item pulses.

- **Select** takes a loop of pulses, usually the Tap output of an Interaction on a repeated layer.
- **Option** is the position, counted from 0, of the most recent item that pulsed.

If several items pulse in the same frame, the highest position wins. When the loop gets shorter, Option stops at the last position.

## Tips
- Wire Option into Loop Select to show the tapped item's title or image.
- Compare each copy's Index with Option using Equals Exactly to highlight the selected copy.
- For a few separate buttons that aren't repeated, use Option Switch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Select**<br>`select` | `pulse` · whole loop | — | Pulse to select: when item i of this loop pulses, Option becomes i. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Option**<br>`option` | `index` | The position, counted from 0, of the item that pulsed most recently; 0 until the first pulse. |

## Examples

### Slide an indicator under the tapped tab

A second Grid Layout turns the selected option into the indicator's position, and Pop Animation springs it there.

```text
layer tab rectangle "Tab" position←tab_grid.position size←tab_grid.size cornerRadius=10
layer indicator rectangle "Indicator" position←slide.output size←marker_grid.size cornerRadius=2
patch tabs loop count=4
patch tab_grid gridLayout index←tabs.index columns=4 origin=16,790 width=370 itemHeight=44 spacing=6
patch tap_tab interaction layer=@tab
patch current loopOptionSwitch select←tap_tab.tap
patch marker_grid gridLayout index←current.option columns=4 origin=16,838 width=370 itemHeight=4 spacing=6
patch slide popAnimation<point> number←marker_grid.position
```

## Common mistakes

- The first tab looks selected before anyone taps: Option starts at 0, the first item. If nothing should look selected at first, gate the highlight with a Switch whose Turn On comes from Any on the same Tap loop.
- Option never changes: the Interaction points at a layer that isn't repeated, so Tap is one pulse instead of a loop. Point the Interaction at the repeated layer so each copy reports its own taps.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Grid Layout](gridLayout.md): Calculates a position and size for each item so repeated layers fill a grid of evenly sized columns.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Loop Option Switch (`origami.loopoptionswitch`)
- **Also imports:** `builtin.loop.loopoptionswitch`

| Sonobe port | Origami label |
|---|---|
| `select` | Input |
