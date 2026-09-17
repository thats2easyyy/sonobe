<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Equals

Checks whether two numbers or points are equal within a tolerance, for values that never land exactly on a round number.

| | |
|---|---|
| Type key | `equals` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>E</kbd> |
| Search terms | approximately equal, almost equal, close to, nearly, within tolerance, ≈, epsilon, settled |

## How it works
Equals turns on when two values are close enough to count as the same. Animated and calculated values often end up at 0.9999 instead of 1, so an exact check would miss them.

- **Value 1** and **Value 2** are the values to compare. Change the type to compare points, 3D points, 4D points, or sizes.
- **Tolerance** is how far apart they may be and still count as equal. 0.1 makes 2.1 equal 2. The edge counts as equal. For points, it's the straight-line distance in points.
- **Output** is on while the values are within the tolerance.

## Tips
- Detect when an animation has arrived: compare its output with the target, then use Pulse (Turned On) to start the next step.
- For whole numbers, indexes, text, or colors, use Equals Exactly.
- Set Tolerance to 0 when you need a precise match on numbers that come straight from a literal or a counter.

## Coming from Origami
Origami's Equals compares numbers only, and its ports are First Value, Second Value, and Tolerance. Here they're Value 1 and Value 2, so you can swap between comparison patches without rewiring. The point, size, and 4D types are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value 1**<br>`value1` | `variant` | `0` | The first value to compare. |
| **Value 2**<br>`value2` | `variant` | `0` | The value to compare with Value 1. |
| **Tolerance**<br>`tolerance` | `number` | `0.001` | How far apart the values may be and still count as equal; 0.1 makes 2.1 equal 2, and 0 asks for an exact match. At least 0, step 0.001. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while Value 1 and Value 2 are within the tolerance of each other. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Pop in a badge once the card finishes growing

```text
layer card rectangle "Card" @16,120 370x220 cornerRadius=16 scale←grow.output
layer badge oval "Badge" @346,108 28x28 scale←badge_pop.output
patch tap_card interaction layer=@card
patch expanded switch flip←tap_card.tap
patch pop popAnimation number←expanded.on
patch grow transition<number> progress←pop.output start=1 end=1.08
patch settled_open equals value1←pop.output value2=1 tolerance=0.01
patch badge_pop popAnimation number←settled_open.output
```

## Common mistakes

- The output flickers on and off while a spring bounces around its target: the spring passes through the target on every swing. Raise the Tolerance a little and follow Equals with a short Delay, or check that the Switch driving the spring is on as well.
- Nothing happens when an animation ends: the animation settles at 0.9996 and the Tolerance is 0. Use a tolerance such as 0.01.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [And](and.md): Turns on only while every one of its inputs is on.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Equals (`builtin.compare.equalapprox`)
- **Also imports:** `builtin.compare.equalApprox`

| Sonobe port | Origami label |
|---|---|
| `value1` | First Value |
| `value2` | Second Value |
