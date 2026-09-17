<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Any

Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped.

| | |
|---|---|
| Type key | `loopAny` |
| Category | [Loops](README.md#loops) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | loop any, any true, some, any tapped, or across loop, exists, reduce or |

## How it works
Any looks across a whole loop and answers one question: is at least one item on? It's how you react to a tap on any copy of a repeated layer.

- **Loop** takes a loop of on/off values (booleans) or pulses.
- **Output** is on when one or more items are on. An empty loop gives off.

Or compares separate inputs at each position; Any collapses a whole loop into one answer.

## Tips
- Any tells you that something was tapped; Loop Option Switch tells you which copy it was.
- Wire a looped Down through Any and Not to pause auto-scrolling while a finger is on any item.
- To ask whether every item is on, use All.

## Advanced: Grouping
Grouping splits one loop into several answers. Give each item a group number, counted from 0, and Output becomes a loop with one answer per group. Groups that no item belongs to answer off. Leave Grouping at −1 for a single answer.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `boolean` · whole loop | `false` | The loop of on/off values or pulses to check. |
| **Grouping**<br>`grouping` | `number` · whole loop · advanced | `-1` | The group number of each item, counted from 0, for one answer per group; −1 gives one answer for the whole loop. step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On when at least one item is on and off for an empty loop; a loop with one answer per group when Grouping is set. |

## Examples

### Open a sheet when any card is tapped

```text
layer card rectangle "Card" position←grid.position size←grid.size cornerRadius=16
layer sheet rectangle "Sheet" @0,474 402x400 cornerRadius=24 opacity←pop.output
patch cards loop count=6
patch grid gridLayout index←cards.index columns=2 origin=16,120 width=370 itemHeight=100 spacing=10
patch tap_card interaction layer=@card
patch tapped_any loopAny loop←tap_card.tap
patch open switch turnOn←tapped_any.output
patch pop popAnimation number←open.on
```

## Common mistakes

- A layer bound to Any flickers on for a single frame: a looped Tap is on only on the frame of the tap. Wire Any into a Switch's Turn On or Flip so the change stays.
- Any stays on: you checked a state like Down or a Switch's On, and one copy is still on. Hover the cable to see which item is on, or check Tap when you mean a one-time event.
- Output turned into a loop: Grouping isn't −1. Set it back to −1 for a single answer.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Loop Option Switch](loopOptionSwitch.md): Remembers which item in a loop pulsed most recently, like which tab or card was tapped.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [All](loopAll.md): Turns a loop of on/off values into one value that's on only when every item is on, like all boxes being checked.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Any (`builtin.loop.any`)
