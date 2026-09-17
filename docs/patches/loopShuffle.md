<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Shuffle

Puts a loop's items in a random order each time it gets a pulse, and keeps that order until the next one.

| | |
|---|---|
| Type key | `loopShuffle` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | shuffle, randomize order, random order, scramble, mix up, deck, fisher yates |

## How it works
Loop Shuffle mixes up the order of a loop's items when it gets a pulse (a signal that lasts one frame), then keeps that order until the next pulse. Before the first pulse, items stay in their original order.

- **Loop** is the loop to shuffle.
- **Shuffle** picks a new random order. With two or more items, the order always changes.
- **Reset** puts the items back in their original order.

The patch remembers positions, not values, so if items update (new text, an animating number), they keep their shuffled places. When items are added, they appear at the end until you shuffle again.

## Tips
- Wire When Prototype Starts into Shuffle to shuffle before the first frame is drawn.
- To shuffle several related loops together (a photo and its caption), shuffle a loop of indices once and use Loop Select to reorder each loop with it.
- Random draws come from the prototype's seed, so simulations and tests repeat exactly.

## Coming from Origami
Reset is a Sonobe addition. Sonobe labels the output Output.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop whose items you want in a random order. |
| **Shuffle**<br>`shuffle` | `pulse` | — | Pulse to pick a new random order. With two or more items the order always changes. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to put the items back in their original order. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | The items in the current shuffled order, or in original order before the first shuffle. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Deal the cards in a random order

The shuffle happens on the first frame, so the original order is never drawn.

```text
layer deck group "Deck" @16,120 358x80 layout=row spacing=8
  layer card rectangle "Card" 80x80 cornerRadius=12 color←shuffled.output
patch start whenPrototypeStarts
patch shuffled loopShuffle<color> loop=loop[#FF3B30FF|#34C759FF|#007AFFFF|#FFCC00FF] shuffle←start.started
```

### Shuffle quiz answers and sort them back

```text
layer answers group "Answers" @16,200 358x240 layout=column spacing=12
  layer answer text "Answer" text←quiz.output
layer shuffle_button rectangle "Shuffle" @16,780 170x52
layer in_order_button rectangle "In Order" @204,780 170x52
patch tap_shuffle interaction layer=@shuffle_button
patch tap_in_order interaction layer=@in_order_button
patch quiz loopShuffle<text> loop=loop["Paris"|"Rome"|"Madrid"|"Berlin"] shuffle←tap_shuffle.tap reset←tap_in_order.tap
```

## Common mistakes

- The order keeps changing on its own: Shuffle is wired to a Repeating Pulse or a state that flickers on and off. Wire a single event such as Tap or When Prototype Starts.
- Photos and their captions no longer match: two Loop Shuffle patches each drew their own order. Shuffle one loop of indices and reorder every related loop with Loop Select.
- Tapping a looped card doesn't shuffle unless it's the first card: looped Taps into Shuffle only listen to item 0. Combine them with Any first.

## Pairs well with

- [When Prototype Starts](whenPrototypeStarts.md): Sends one pulse on the prototype's first frame, and again each time the prototype restarts.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Random](random.md): Picks a random number between Start and End, and picks a new one each time Randomize gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Shuffle (`builtin.loop.mutations.shuffle`)

| Sonobe port | Origami label |
|---|---|
| `output` | Loop |
