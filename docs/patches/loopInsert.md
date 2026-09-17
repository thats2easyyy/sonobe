<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Insert

Adds a value into a loop at a chosen position each time it gets a pulse.

| | |
|---|---|
| Type key | `loopInsert` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | insert, prepend, add item, push front, splice, insert at index, add to list |

## How it works
Loop Insert adds **Value** into a loop at position **Index** each time **Insert** gets a pulse (a signal that lasts one frame). The loop grows by one item per pulse, and the patch remembers what it added.

- **Loop** is the starting list. Leave it unconnected to start empty and build a list over time.
- **Value** is copied on the pulse frame. Changing it later doesn't change items already added.
- **Index** is where the new item lands: 0 puts it first, and a number past the end adds it last.
- **Reset** forgets every insert and outputs Loop as it is.
- **Output Index** counts the result's items from 0.

The patch stores its inserts, not a copy of the list. If Loop changes, the stored inserts are applied to the new loop, so your additions survive new data.

## Tips
- Record a live history: Repeating Pulse into Insert with Index 0 puts the newest reading first.
- Keep a fixed length: pulse Loop Remove Last on the same event.
- Adding to the end? Loop Append does that without an Index.

## Coming from Origami
Sonobe labels the outputs Output and Output Index (keys `output` and `outputIndex`), because the input already uses Index. Reset is a Sonobe addition.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The starting list. Leave it unconnected to start empty and build the list with pulses. |
| **Value**<br>`value` | `variant` | `0` | The value to add, copied on the frame Insert fires. |
| **Index**<br>`index` | `index` | `0` | Where the new item goes, counted from 0. 0 puts it first; a number past the end puts it last. At least 0, step 1. |
| **Insert**<br>`insert` | `pulse` | — | Pulse to add Value at Index. Every pulse adds one more item. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to forget every insert and output Loop as it is. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | Loop with every inserted value in place. |
| **Output Index**<br>`outputIndex` | `index` · whole loop | The position of each result item, counted from 0: [0, 1, 2, …]. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Put the newest card on top

```text
layer add_button rectangle "Add" @16,780 358x52
layer feed group "Feed" @16,100 358x660 layout=column spacing=12
  layer card text "Card" text←posts.output
patch tap_add interaction layer=@add_button
patch post_number counter increase←tap_add.tap
patch posts loopInsert value←post_number.count index=0 insert←tap_add.tap
```

### Draw a live level meter

Every 0.1 s a new reading goes in front, so bars scroll away from the start. Add Loop Remove Last on the same tick to cap its length.

```text
layer meter group "Meter" @16,300 358x120 layout=row spacing=2
  layer bar rectangle "Bar" 6x120 opacity←history.output
patch tick repeatingPulse interval=0.1
patch reading random randomize←tick.tick start=0.2 end=1
patch history loopInsert value←reading.value index=0 insert←tick.tick
```

## Common mistakes

- Nothing gets added: Insert needs a pulse, and a state that stays on fires only once. Wire a Tap, a Repeating Pulse's Tick, or When Prototype Starts into Insert.
- Tapping any looped row inserts the first row's value: looped Taps and Values into a single-value port only use item 0. Turn the taps into one pulse with Any, and pick the tapped value with Loop Option Switch and Loop Select.
- The list grows forever: every pulse adds one item. Pulse Loop Remove Last on the same event to keep a fixed length, or pulse Reset to start over.

## Pairs well with

- [Repeating Pulse](repeatingPulse.md): Sends a pulse over and over at a steady interval, like a metronome.
- [Loop Remove Last](loopRemoveLast.md): Removes a loop's last item each time it gets a pulse, like undoing the latest addition.
- [Loop Append](loopAppend.md): Adds a value to the end of a loop each time it gets a pulse.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Insert (`builtin.loop.mutations.insert`)

| Sonobe port | Origami label |
|---|---|
| `output` | Loop |
| `outputIndex` | Index |
