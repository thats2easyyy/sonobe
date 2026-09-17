<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Running Total

Gives each item in a loop the total of the items before it, for stacking uneven rows or staggering delays.

| | |
|---|---|
| Type key | `runningTotal` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | cumulative sum, prefix sum, accumulate, offsets, subtotal, stack positions, scan |

## How it works
Running Total walks through a loop and gives every item the sum of the items that come before it. For 1, 3, 5 you get 0, 1, 4: the first item has nothing before it.

- **Loop** is the list of numbers. On/off values count as 1 and 0.
- **Include Current** adds each item's own value too, so 1, 3, 5 gives 1, 4, 9.
- **Total** is the loop of running totals, one per item.

## Tips
- Stack rows of different heights: the total of the heights before a row is where that row starts.
- Stagger delays so each item waits for the ones before it to finish.
- Only need the grand total? Use Loop Sum.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `number` · whole loop | empty loop | The loop of numbers to total; on/off values count as 1 and 0. |
| **Include Current**<br>`includeCurrent` | `boolean` | `false` | When on, each total includes the item itself (1, 3, 5 gives 1, 4, 9); when off, only the items before it count. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Total**<br>`total` | `number` · whole loop | For each item, the sum of the items before it, plus the item itself when Include Current is on. |

## Examples

### Fan cards out by uneven angles

Each card turns a little further than the one before it: the steps -24, 12, 16, 20 become rotations -24, -12, 4, 24.

```text
layer card rectangle "Card" @126,300 150x220 cornerRadius=16 pivot=0.5,1 rotation←angles.total
patch steps loopBuilder<number>[4] item0=-24 item1=12 item2=16 item3=20
patch angles runningTotal loop←steps.loop includeCurrent=true
```

## Common mistakes

- The first item isn't offset at all: totals start at 0 for the first item. Add the starting value, such as a header height, to every total with Add.
- Every item is shifted one step too far: Include Current is on, so each total already counts the item itself. Turn it off when you want where an item starts.

## Pairs well with

- [Loop Sum](loopSum.md): Adds up every item in a loop into one total, like a cart price, a count of checked items, or a content height.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Running Total (`builtin.loop.sum`)

| Sonobe port | Origami label |
|---|---|
| `loop` | Input |
| `total` | Output |
