<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Transition

Turns a progress value into a value between Start and End, so one animation can drive any property.

| | |
|---|---|
| Type key | `transition` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>T</kbd> |
| Search terms | lerp, interpolate, tween, map range, mix, blend, convert range, start end |

## How it works
Transition maps **Progress** onto a range you choose. At progress 0 the output is **Start**, at 1 it's **End**, and in between it blends proportionally: with Start 50 and End 100, progress 0.5 gives 75.

- **Progress** is usually the output of Pop Animation or Classic Animation running from 0 to 1.
- **Start** and **End** can be reversed (End smaller than Start) to move the other way.
- **Output** isn't clamped. Progress 2 gives 150 in the example above, and -0.5 gives 25, so a bouncy spring overshoots the End value the same way it overshoots 1.

Right-click to change the type. Points, sizes, and anchors blend each component; colors blend red, green, blue, and alpha.

## Tips
- This is the T in ISAT: Interaction, Switch, Animation, Transition. Drive several Transitions from one animation to keep scale, position, and color in sync.
- Need the reverse direction on another property? Swap Start and End, or use Reverse Progress.
- Going from a range back to progress (like a scroll offset to 0–1)? Use Progress.

## Coming from Origami
Same formula and ports. Origami's docs say values "wrap" outside 0–1, but they extrapolate, as here. Origami's Percentage type is a number here.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | `0` | How far along the range to be: 0 gives Start, 1 gives End. Values outside 0–1 extend past the ends. step 0.01. |
| **Start**<br>`start` | `variant` | `0` | The output when Progress is 0. |
| **End**<br>`end` | `variant` | `1` | The output when Progress is 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The blended value between Start and End, the same type as Start and End. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `point` | `start` | `[0, 0]` |
| `point` | `end` | `[100, 100]` |
| `point3d` | `start` | `[0, 0, 0]` |
| `point3d` | `end` | `[100, 100, 0]` |
| `point4d` | `start` | `[0, 0, 0, 0]` |
| `point4d` | `end` | `[1, 1, 1, 1]` |
| `size` | `start` | `[100, 100]` |
| `size` | `end` | `[200, 200]` |
| `anchor` | `start` | `[0, 0]` |
| `anchor` | `end` | `[1, 1]` |
| `color` | `start` | `#FFFFFFFF` |
| `color` | `end` | `#000000FF` |

## Examples

### Tap a card to grow it and tint it yellow

One spring drives two Transitions, so scale and color stay in sync.

```text
layer card rectangle "Card" @16,120 358x220 color←shade.output scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch grow transition<number> progress←pop.output start=1 end=1.08
patch shade transition<color> progress←pop.output start=#FFFFFFFF end=#FFD60AFF
```

### Slide a menu in from the left

```text
layer menu rectangle "Menu" @-300,0 300x874 position←slide.output
layer menu_button rectangle "Menu Button" @16,62 44x44
patch tap_menu interaction layer=@menu_button
patch open switch flip←tap_menu.tap
patch pop popAnimation number←open.on bounciness=0 speed=14
patch slide transition<point> progress←pop.output start=[-300,0] end=[0,0]
```

## Common mistakes

- The property jumps between two values: Progress comes straight from a Switch or Interaction, which only outputs 0 or 1. Put Pop Animation or Classic Animation in between.
- A color fade turns gray or dark in the middle: blending toward a transparent color also blends toward its black channels. Fade with the layer's Opacity instead, or give End the same RGB with alpha 0.
- The layer moves too far when it bounces: Transition extends past End when a spring overshoots 1. Use Bounciness 0 for this property, or clamp the result.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Reverse Progress](reverseProgress.md): Flips a progress value so 0 becomes 1 and 1 becomes 0, for animations that run the opposite way.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Transition (`builtin.transition`)
