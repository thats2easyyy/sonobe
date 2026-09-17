<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Greater Than

Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.

| | |
|---|---|
| Type key | `greaterThan` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>></kbd> |
| Search terms | more than, bigger than, larger than, above, exceeds, threshold, > |

## How it works
Greater Than turns on while Value 1 is bigger than Value 2. It's the usual way to react when something crosses a threshold: a sheet dragged far enough, a timer past 3 seconds, a count above zero.

- **Value 1** is the value you're checking. **Value 2** is the threshold.
- Add more values to check a chain: with three values, the output is on only when Value 1 > Value 2 > Value 3, which checks that Value 2 sits strictly between the other two.
- Equal values don't count as greater. Use Greater Than or Equal when the threshold itself should count.
- **Output** is on while the whole chain holds.

## Tips
- Wire the output into a Switch's Turn On to remember that the threshold was crossed.
- Use a Pulse patch (Turned On) to fire an action once at the moment the value crosses.
- For "between two numbers" with clearer controls, use In Range.

## Coming from Origami
Origami's ports are unnamed. Here they're Value 1, Value 2, and so on, in the same order and with the same chain rule.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value in the chain; each one must be greater than the next.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while each value is greater than the next one. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `index`, `boolean`.

## Examples

### Show a Skip button after 3 seconds

```text
layer skip text "Skip" "Skip" @330,64 opacity←skip_fade.output
patch clock time
patch late greaterThan[2] value1←clock.time value2=3
patch skip_fade popAnimation number←late.output
```

### Show a caption between 2 and 5 seconds

Three values form a chain: 5 > time > 2.

```text
layer caption text "Caption" "Swipe to explore" @24,760 opacity←caption_fade.output
patch clock time
patch showing greaterThan[3] value1=5 value2←clock.time value3=2
patch caption_fade popAnimation number←showing.output
```

## Common mistakes

- The check is on when you expected off: Value 1 and Value 2 are the wrong way round. Value 1 is the value you're measuring and Value 2 is the threshold.
- A drag-to-dismiss triggers while the finger is still down: Greater Than turns on as soon as the drag passes the threshold. Combine it with Not of Interaction Down in an And so it only acts on release.

## Pairs well with

- [Less Than](lessThan.md): Checks whether a value is less than another, such as a scroll pulled past the top or an item before the current one.
- [And](and.md): Turns on only while every one of its inputs is on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [In Range](inRange.md): Checks whether a number lies between a minimum and a maximum, and tells you if it's below or above instead.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Greater Than (`builtin.compare.gt`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0, base value) |
| `value2` | Input (port 1) |
