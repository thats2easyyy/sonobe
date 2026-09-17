<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# All

Turns a loop of on/off values into one value that's on only when every item is on, like all boxes being checked.

| | |
|---|---|
| Type key | `loopAll` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | loop all, all true, every, every item, all checked, and across loop, reduce and |

## How it works
All looks across a whole loop and is on only when every item is on. It's the partner of Any.

- **Loop** takes a loop of on/off values (booleans).
- **Output** is on when no item is off. An empty loop counts as all on, because no item is off.

## Tips
- Enable a Continue button once every checklist item is checked.
- When one item being on is enough, use Any instead.
- All is the same as Not on every item, then Any, then Not.

## Advanced: Grouping
Grouping splits one loop into several answers. Give each item a group number, counted from 0, and Output becomes a loop with one answer per group. Groups that no item belongs to answer on. Leave Grouping at −1 for a single answer.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `boolean` · whole loop | `false` | The loop of on/off values to check. |
| **Grouping**<br>`grouping` | `number` · whole loop · advanced | `-1` | The group number of each item, counted from 0, for one answer per group; −1 gives one answer for the whole loop. step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On when every item is on, including for an empty loop; a loop with one answer per group when Grouping is set. |

## Examples

### Enable Continue when every box is checked

```text
layer check rectangle "Check" position←grid.position size←grid.size cornerRadius=12 color←fill.output
layer continue_button rectangle "Continue" @16,760 370x56 cornerRadius=28 opacity←ready.output
patch items loop count=3
patch grid gridLayout index←items.index columns=1 origin=16,120 width=370 itemHeight=56 spacing=8
patch tap_check interaction layer=@check
patch checked switch flip←tap_check.tap
patch fill transition<color> progress←checked.on start=#E5E5EAFF end=#34C759FF
patch all_checked loopAll loop←checked.on
patch ready transition<number> progress←all_checked.output start=0.4 end=1
```

## Common mistakes

- All never turns on with a looped Tap: every copy would have to be tapped in the same frame. Store each copy's choice in a Switch and check the Switch's On instead.
- The button turns on before anything is listed: an empty loop counts as all on. Also require Loop Count greater than 0.

## Pairs well with

- [Any](loopAny.md): Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [And](and.md): Turns on only while every one of its inputs is on.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
