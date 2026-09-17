<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Reverse Progress

Flips a progress value so 0 becomes 1 and 1 becomes 0, for animations that run the opposite way.

| | |
|---|---|
| Type key | `reverseProgress` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>R</kbd> |
| Search terms | invert progress, one minus, flip progress, opposite, crossfade, inverse |

## How it works
Reverse Progress outputs 1 minus its input. 0 becomes 1, 1 becomes 0, and 0.3 becomes 0.7. Use it when one thing should appear as another disappears, driven by the same animation.

- **Progress** is the value to flip, usually from Pop Animation or Classic Animation.
- **Output** isn't clamped, so a spring overshoot of 1.1 becomes -0.1.

## Tips
- Crossfade two photos from one animation: wire the progress into one photo's Opacity and the reversed progress into the other's.
- To reverse a Transition, you can also swap its Start and End.

## Coming from Origami
Both ports are named Progress in Origami; the output is named Output here.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | `0` | The progress value to flip, usually 0–1. step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` (progress) | 1 minus Progress: 0 becomes 1 and 1 becomes 0. Values outside 0–1 stay unclamped. |

## Examples

### Crossfade two photos with one tap

```text
layer photo_a rectangle "Photo A" @0,0 402x874 opacity←pop.output
layer photo_b rectangle "Photo B" @0,0 402x874 opacity←fade_out.output
patch tap_screen interaction
patch toggle switch flip←tap_screen.tap
patch pop popAnimation number←toggle.on bounciness=0
patch fade_out reverseProgress progress←pop.output
```

## Common mistakes

- Both layers fade out together: the reversed value and the original go to the same layer or to layers that are both hidden at 0. Wire the original into one layer and the reversed value into the other.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Reverse Progress (`origami.reverseprogress`)
- **Also imports:** `origami.reverseProgress`

| Sonobe port | Origami label |
|---|---|
| `output` | Progress |
