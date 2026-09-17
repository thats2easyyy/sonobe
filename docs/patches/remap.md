<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Remap

Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.

| | |
|---|---|
| Type key | `remap` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | map range, map value, range map, scale range, lerp, interpolate, normalize, linear map |

## How it works
Remap answers "when the input is here, what should the output be?" Set the two ends of each range and everything in between follows along.

- **Value** is what you're reading, such as a scroll offset or a drag position.
- **From Start** and **From End** are the input range. **To Start** and **To End** are the outputs at those two points.
- Past the input range, the output keeps going beyond To Start and To End. Turn on **Clamp to Range** to hold it at the ends.
- Either range can run backwards (From Start 200, From End 0) to flip the direction.
- Set the type to Point, Size, or Color to map onto those: scroll 0–100 can fade a background from white to black.
- **Curve** (advanced) eases the values in between instead of changing at a steady rate.

## Tips
- Collapsing header: Value from the scroll offset, From 0 → 150, To 120 → 64, Clamp to Range on.
- If From Start equals From End, Remap acts like a switch: To End once Value reaches From Start, To Start below it.

## Coming from Origami
Remap does the job of a Progress patch feeding a Transition patch, in one patch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `number` | `0` | The number to convert, such as a scroll offset or drag distance. |
| **From Start**<br>`fromStart` | `number` | `0` | The input value that produces To Start. |
| **From End**<br>`fromEnd` | `number` | `1` | The input value that produces To End. It can be smaller than From Start. |
| **To Start**<br>`toStart` | `variant` | `0` | The output when Value equals From Start. |
| **To End**<br>`toEnd` | `variant` | `1` | The output when Value equals From End. |
| **Clamp to Range**<br>`clampToRange` | `boolean` | `false` | When on, the output stops at To Start and To End instead of continuing past them. |
| **Curve**<br>`curve` | `enum` · advanced | `linear` | How values in between change: Linear changes steadily; the others ease in, out, or both. Options: Linear (`linear`), Quadratic In (`quadraticIn`), Quadratic Out (`quadraticOut`), Quadratic In & Out (`quadraticInOut`), Cubic In (`cubicIn`), Cubic Out (`cubicOut`), Cubic In & Out (`cubicInOut`), Exponential In (`exponentialIn`), Exponential Out (`exponentialOut`), Exponential In & Out (`exponentialInOut`), Sinusoidal In (`sinusoidalIn`), Sinusoidal Out (`sinusoidalOut`), Sinusoidal In & Out (`sinusoidalInOut`). |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value converted to the output range. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `point` | `toStart` | `[0, 0]` |
| `point` | `toEnd` | `[100, 100]` |
| `point3d` | `toStart` | `[0, 0, 0]` |
| `point3d` | `toEnd` | `[100, 100, 100]` |
| `point4d` | `toStart` | `[0, 0, 0, 0]` |
| `point4d` | `toEnd` | `[1, 1, 1, 1]` |
| `size` | `toStart` | `[100, 100]` |
| `size` | `toEnd` | `[200, 200]` |
| `anchor` | `toStart` | `[0, 0]` |
| `anchor` | `toEnd` | `[1, 1]` |
| `color` | `toStart` | `#FFFFFFFF` |
| `color` | `toEnd` | `#000000FF` |

## Examples

### Fade a title as a carousel scrolls

Scrolling left makes the position's x negative; a Point wired into a number input reads its x.

```text
layer title text "Title" @16,120 opacity←title_fade.output
layer strip group "Card Strip" @0,200 1170x400
patch strip_scroll scroll layer=@strip
patch title_fade remap value←strip_scroll.position fromStart=0 fromEnd=-150 toStart=1 toEnd=0 clampToRange=true
```

### Tint the background from a slider

```text
layer backdrop colorFill "Backdrop" color←tint.output
layer track rectangle "Track" @40,400 310x40 cornerRadius=20
patch press interaction layer=@track
patch tint remap<color> value←press.position fromStart=40 fromEnd=350 toStart="#FFFFFFFF" toEnd="#1C1C1EFF" clampToRange=true
```

## Common mistakes

- The header keeps shrinking after you pass From End: values outside the input range keep extrapolating. Turn on Clamp to Range.
- Nothing changes as you scroll: the input range doesn't match what Value actually does (scrolling down often makes the offset negative). Look at Value with a Watch patch, then set From Start and From End to the numbers you see.

## Pairs well with

- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
