<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Greater Than or Equal

Checks whether a value is at least another value, so reaching the threshold exactly also counts.

| | |
|---|---|
| Type key | `greaterThanOrEqual` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | greater or equal, more than or equal to, bigger than or equal to, at least, minimum, >= |

## How it works
Greater Than or Equal turns on while Value 1 is bigger than Value 2 or exactly equal to it. Use it when reaching the threshold should count, such as a progress bar reaching 1 or a count reaching its limit.

- **Value 1** is the value you're checking. **Value 2** is the threshold.
- Add more values to check a chain: with three values, the output is on only when Value 1 ≥ Value 2 ≥ Value 3.
- **Output** is on while the whole chain holds.

## Tips
- A Classic Animation lands exactly on its target, so `output ≥ 1` reliably detects that it finished. Springs can overshoot and settle, so use Equals with a tolerance for those.
- With nothing connected, both values are 0 and the output is on.

## Coming from Origami
Origami's ports are unnamed, and older tutorials call this patch Greater or Equal. Here the ports are Value 1, Value 2, and so on, with the same chain rule.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value in the chain; each one must be greater than or equal to the next.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while each value is greater than or equal to the next one. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `index`, `boolean`.

## Examples

### Hold for 2 seconds to confirm

```text
layer track rectangle "Hold to Confirm" @24,700 354x56 cornerRadius=28
layer done_label text "Done" "Confirmed" @150,776 opacity←done_fade.output
patch hold interaction layer=@track
patch fill classicAnimation number←hold.down duration=2
patch complete greaterThanOrEqual[2] value1←fill.output value2=1
patch done_fade popAnimation number←complete.output
```

## Common mistakes

- Something is already on when the prototype starts: both inputs default to 0, and 0 ≥ 0 is true. Set the threshold to the value you mean before wiring the output.
- The action repeats every frame after the threshold: the output is a state that stays on. Put a Pulse patch (Turned On) after it to act once.

## Pairs well with

- [Less Than or Equal](lessThanOrEqual.md): Checks whether a value is at most another value, so matching the threshold exactly also counts.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [And](and.md): Turns on only while every one of its inputs is on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Greater Than or Equal (`builtin.compare.gteq`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0, base value) |
| `value2` | Input (port 1) |
