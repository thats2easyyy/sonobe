# Loops

Level 3 · Next: [08 Components and variables](08-components-and-variables.md)

## What you'll be able to do

- Think of a loop as a list traveling along a single cable.
- Turn one layer into a list or a grid.
- Give every item its own state, like each card remembering whether it's expanded.
- Predict what happens when lists of different lengths meet.
- Pick one item out of a loop, like the page a set of dots should highlight.

## A loop is a list on a cable

Normally a cable carries one value. A loop cable carries a list of values, like `[0, 1, 2, 3, 4, 5]`. Loop cables are green, and a "×6" badge tells you how many items they carry. Any patch fed a loop runs once for each item.

Here's a list of six notifications, spaced 80 points apart and starting 116 points from the top:

```
Loop (Count 6) ══[0 1 2 3 4 5]══▶ Multiply by 80 ══[0 80 160 240 320 400]══▶ Add 116 ══▶ Row . Position Y
       ×6                                  ×6                                    ×6          6 rows
```

| Index | × 80 | + 116 |
|---|---|---|
| 0 | 0 | 116 |
| 1 | 80 | 196 |
| 2 | 160 | 276 |
| 3 | 240 | 356 |
| 4 | 320 | 436 |
| 5 | 400 | 516 |

Loops count from 0. A Loop with Count 6 gives you indexes 0 to 5, not 1 to 6.

## Replicated layers

When a loop drives one of a layer's properties, that layer becomes one copy per item. Feed six Y positions into Row's Position Y and you get six rows. The number of copies is the length of the longest loop connected to the layer.

Every copy shares the same settings except the properties driven by loops. So one copy can differ from the next in position, text, image or color, while everything else stays identical.

Without positions, the copies stack on top of each other and look like one layer. The easy fix is a layout group. Put the replicated layer inside a group set to Column layout and you have a list, with no math at all. Use Grid layout for a grid.

To repeat a whole cell, like a photo, a title and a button together, make the cell a component and feed the loop into its inputs. Each item gets its own instance. Guide 08 covers components.

## Per-index state

Patches that remember things keep separate memory for each index. That means one graph can give every card its own expanded state.

Put an Interaction on a replicated card, and its outputs become loops too. Tap card 3, and Tap is a loop with a pulse only at index 3:

```
index:      0    1    2    3    4    5
Tap:        0    0    0    1    0    0      pulse at index 3, for one frame
Switch:     0    0    0    1    0    0      only index 3 flipped, and it stays flipped
Pop:        0    0    0    ↗    0    0      only index 3 animates
Scale:      1    1    1    1.08 1    1
```

That's the same tap-to-grow graph from guide 01, unchanged. Loops multiplied it.

## When lengths don't match

When loops of different lengths meet at one patch, Sonobe follows one rule:

> The output is as long as the longest loop. Shorter loops wrap around and start again from the beginning. A plain value that isn't a loop applies to every item.

| Inputs | Output |
|---|---|
| `[1, 2, 3]` + `10` | `[11, 12, 13]` |
| `[1, 2, 3, 4, 5, 6]` + `[100, 200]` | `[101, 202, 103, 204, 105, 206]` |
| `[a, b, c]` and `[x, y, z, w, v]` | 5 items, pairing a+x, b+y, c+z, a+w, b+v |

Wrapping is handy on purpose. A two-color loop `[white, light gray]` on six rows gives you zebra stripes.

It's also a quiet source of bugs. If you add a seventh notification but forget to add a seventh name, the first name shows up again at the bottom. Diagnostics warns when loop lengths don't match, so check the warning before you decide the wrap was intended.

Loops are capped at 10,000 items. Past that, Sonobe stops and shows a diagnostic instead of freezing your prototype.

## Building a grid

### With layout

Take a group with Grid layout, 402 points wide, with Spacing `3` and Padding `0, 3, 0, 3`. Inside it, put one 130 × 130 Image layer whose Image is driven by a Loop Builder holding nine photos. You get a three-by-three grid, filled in order.

### With math

When you need numbers you can animate, like cards fanning out or tiles shuffling, compute positions yourself. With three columns and a 133-point step (130 plus the 3-point gap):

```
x = (index mod 3) × 133 + 3
y = floor(index ÷ 3) × 133 + 3
```

| Index | Column | Row | x | y |
|---|---|---|---|---|
| 0 | 0 | 0 | 3 | 3 |
| 1 | 1 | 0 | 136 | 3 |
| 4 | 1 | 1 | 136 | 136 |
| 8 | 2 | 2 | 269 | 269 |

## Picking one item

Loop Select pulls items out by index. Give it nine photos and index 4, and you get photo 4 on its own.

To find out which item was tapped, use Loop Option Switch. It turns a loop of pulses into one number, the index of the most recently pulsed item. Compare that with each item's index and you get a loop of booleans that highlights exactly one item:

```
Dot . Tap (loop) ─▶ Loop Option Switch ─▶ current page (one number)
                                                  │
Loop . Index ───────────────────────────▶ Equals ◀┘  ═[0 0 1 0 0]═▶ Pop Animation ─▶ Transition 8 → 20 ─▶ Dot . Width
```

Page dots work the same way. Five dots in a Row group, Equals compares each index with the current page, and the matching dot grows from 8 points wide to 20. Because Pop Animation keeps separate state per index, the old dot shrinks while the new one grows, each on its own spring.

## Reading loops in Sonobe

- A loop cable shows a "×N" badge with its item count.
- Hovering a looped port shows the value for each index.
- In traces and in Claude's tools, one item is addressed with `#` and its index. `@card.scale#3` is card 3's scale.

## Try it

1. Build the six notification rows with Loop, Multiply and Add.
2. Delete the math and put the row inside a Column layout group instead. Notice what you no longer need.
3. Stripe the rows with a two-color loop.
4. Make any card grow when tapped, independently of the others.
5. Build five page dots that highlight the current page.
6. Build the three-column photo grid both ways, with layout and with math.

## Common mistakes

- Off by one. A Count of 5 gives indexes 0 to 4, so the last item is index 4.
- Forgetting layout or positions, so every copy stacks in one spot and it looks like the loop didn't work.
- Accidental wrapping from a shorter, stale loop. Read the length-mismatch warning.
- Expecting one Switch downstream of a looped Interaction to be shared by all items. It keeps one state per index. If you want one shared value, reduce the loop to a single value first, for example with Loop Option Switch.
- Replicating heavy layers, like blurred cards, into huge loops. Every item is a full layer with its own cost.
