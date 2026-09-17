<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Sum

Adds up every item in a loop into one total, like a cart price, a count of checked items, or a content height.

| | |
|---|---|
| Type key | `loopSum` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | sum, total, add all, aggregate, count on, reduce, grand total |

## How it works
Loop Sum adds every item in a loop together and outputs one total.

- **Loop** is the list to add up. On/off values count as 1 and 0, so summing them counts how many are on.
- **Sum** is the total. An empty loop sums to zero.

Choose the type from the patch's type menu. Numbers add normally, points and sizes add component by component (x with x, y with y), and text joins end to end in order.

## Tips
- Sum a loop of row heights to size a list whose rows have different heights.
- Sum prices times quantities to show a cart total.
- Need the total of the items before each item, to stack things? Use Running Total.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop of values to add up; on/off values count as 1 and 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Sum**<br>`sum` | `variant` | The total of every item; zero for an empty loop. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `text`.

## Examples

### Show how many items are checked

```text
layer check rectangle "Check" position←grid.position size←grid.size cornerRadius=12 opacity←dim.output
layer summary text "Summary" @16,440 text←checked_count.sum
patch items loop count=5
patch grid gridLayout index←items.index columns=1 origin=16,120 width=370 itemHeight=48 spacing=8
patch tap_check interaction layer=@check
patch checked switch flip←tap_check.tap
patch dim transition<number> progress←checked.on start=0.4 end=1
patch checked_count loopSum loop←checked.on
```

## Common mistakes

- Sum shows one item's value: the cable carries a single value, not a loop, for example after Loop Select. Connect the loop itself.
- The count jumps to 1 and back to 0: you summed a looped Tap, which is on for one frame. Store each item's choice in a Switch and sum its On.

## Pairs well with

- [Running Total](runningTotal.md): Gives each item in a loop the total of the items before it, for stacking uneven rows or staggering delays.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Sum (`origami.loopsum`)
- **Also imports:** `origami.LoopSum`, `builtin.loop.total`

| Sonobe port | Origami label |
|---|---|
| `loop` | Input |
