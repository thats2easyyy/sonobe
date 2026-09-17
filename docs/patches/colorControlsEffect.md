<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Color Controls Effect

Adjusts a layer's brightness, contrast, saturation, and hue through its Effects property.

| | |
|---|---|
| Type key | `colorControlsEffect` |
| Category | [Layers & Effects](README.md#layers--effects) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | brightness, contrast, saturation, hue rotate, color adjust, grayscale, desaturate, tone, color filter, image adjustments |

## How it works
Color Controls Effect makes an effect value that shifts a layer's colors. Wire **Effect** into a layer's **Effects** property and the layer, including its children, changes tone. Every control starts at a neutral value that leaves the layer unchanged.

- **Brightness** lightens or darkens: 0 is unchanged, −1 is black, and 1 is twice as bright.
- **Contrast** spreads colors apart: 1 is unchanged, 0 is flat gray, and 2 doubles the contrast.
- **Saturation** sets how vivid colors are: 1 is unchanged, 0 is black and white, and 2 is twice as vivid.
- **Hue Rotation** turns every color around the color wheel, in degrees. 180 swaps colors for their opposites.

## Tips
- Gray out a disabled card: Saturation 0 and Brightness 0.1.
- Animate one control with a Transition and leave the others at their neutral values.
- Combine it with Blur Effect by collecting both in a Loop Builder wired into Effects.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Brightness**<br>`brightness` | `number` | `0` | Lightens or darkens the layer: 0 is unchanged, −1 is black, and 1 is twice as bright. Range -1 to 1, step 0.01. |
| **Contrast**<br>`contrast` | `number` | `1` | Spreads colors apart: 1 is unchanged, 0 is flat gray, and 2 doubles the contrast. Range 0 to 2, step 0.01. |
| **Saturation**<br>`saturation` | `number` | `1` | How vivid colors are: 1 is unchanged, 0 is black and white, and 2 is twice as vivid. Range 0 to 2, step 0.01. |
| **Hue Rotation**<br>`hueRotation` | `number` (angle) | `0` | Turns every color around the color wheel, in degrees; 0 is unchanged and 180 gives opposite colors. Range -180 to 180, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Effect**<br>`effect` | `layerEffect` | Wire into a layer's Effects property to recolor that layer. |

## Examples

### Bring a photo to color when tapped

```text
layer photo image "Photo" @16,140 370x370 cornerRadius=20 effects←tone.effect
patch tap_photo interaction layer=@photo
patch revealed switch flip←tap_photo.tap
patch reveal_anim classicAnimation number←revealed.on duration=0.6
patch vividness transition<number> progress←reveal_anim.output start=0 end=1
patch tone colorControlsEffect saturation←vividness.output
```

### Brighten a thumbnail on hover

One spring drives both controls, so brightness and contrast rise together while the pointer is over the thumbnail.

```text
layer thumb image "Thumb" @136,300 130x130 cornerRadius=12 effects←hover_tone.effect
patch hover_thumb hover layer=@thumb
patch lift popAnimation number←hover_thumb.hovering bounciness=2 speed=18
patch lighten transition<number> progress←lift.output start=0 end=0.15
patch punch transition<number> progress←lift.output start=1 end=1.1
patch hover_tone colorControlsEffect brightness←lighten.output contrast←punch.output
```

## Common mistakes

- The layer turns gray as soon as you connect it: Saturation or Contrast is at 0. Their neutral value is 1; only Brightness and Hue Rotation are neutral at 0.
- The label and icons on a card change color too: effects apply to the whole layer, children included. Apply the effect to the photo layer instead of the group that holds everything.

## Pairs well with

- [Blur Effect](blurEffect.md): Creates a blur for a layer's Effects property, softening everything the layer draws, with an option to keep its edges sharp.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Hover](hover.md): Reports whether the mouse pointer is over a layer and where it is, for hover highlights and tooltips on desktop.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
