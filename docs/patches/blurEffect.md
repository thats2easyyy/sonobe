<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Blur Effect

Creates a blur for a layer's Effects property, softening everything the layer draws, with an option to keep its edges sharp.

| | |
|---|---|
| Type key | `blurEffect` |
| Category | [Layers & Effects](README.md#layers--effects) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | blur, gaussian blur, layer effect, filter, soften, defocus, depth of field, hard edges, focus pull |

## How it works
Blur Effect makes an effect value: a description of a visual effect a layer applies to itself. Wire **Effect** into a layer's **Effects** property, in the Filters section of the inspector, and the layer and its children look out of focus.

- **Radius** is how strong the blur is, in points. 0 turns it off.
- **Hard Edges** keeps the layer's outline crisp and opaque instead of letting the blur fade out past its edges. Turn it on for full-bleed photos and backgrounds.

To apply several effects to one layer, collect them in a Loop Builder and wire its loop into Effects. They apply in order.

## Tips
- Animate Radius with a Transition to pull focus, for example to blur the page while a menu opens.
- A Radius of 20 to 30 gives a soft backdrop behind menus and sheets; 2 to 6 reads as slightly out of focus.
- For a different blur on each copy of a looped layer, drive the layer's Blur property instead. Effects applies a loop of effects to every copy.

## Coming from Origami
The output is called Effect instead of Layer Effect. Radius uses the same scale as the layer's Blur property.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Radius**<br>`radius` | `number` (distance) | `10` | How strong the blur is, in points; 0 turns it off, and larger values look more out of focus. Range 0 to 100, step 1. |
| **Hard Edges**<br>`hardEdges` | `boolean` | `false` | When on, the layer's edges stay sharp and opaque instead of fading out past its bounds. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Effect**<br>`effect` | `layerEffect` | Wire into a layer's Effects property to blur that layer. |

## Examples

### Blur the page while a menu is held open

A long press opens the menu, and the same animation drives the blur, so both move together.

```text
layer photo image "Photo" @0,0 402x874 effects←background_blur.effect
layer menu rectangle "Menu" @101,357 200x160 cornerRadius=16 color=#FFFFFFFF opacity←menu_anim.output
patch hold longPress layer=@photo
patch menu_anim popAnimation number←hold.longPress bounciness=3 speed=16
patch blur_amount transition<number> progress←menu_anim.output start=0 end=20
patch background_blur blurEffect radius←blur_amount.output hardEdges=true
```

### Stack a soft blur with a dimmed tone

A Loop Builder collects both effects, and the layer applies them in order.

```text
layer hero image "Hero" @0,0 402x320 effects←stack.loop
patch soft blurEffect radius=6 hardEdges=true
patch dim colorControlsEffect brightness=-0.2 saturation=0.6
patch stack loopBuilder<layerEffect>[2] item0←soft.effect item1←dim.effect
```

## Common mistakes

- Nothing blurs: Effect isn't wired into the layer's Effects property, or it's wired into a different layer. Open the layer's Filters section and connect Effect to Effects.
- The photo's edges look faded and see-through: without Hard Edges, the blur pulls in transparent pixels from outside the layer. Turn on Hard Edges for full-bleed images and backgrounds.
- The panel's own text blurs instead of what's behind it: Blur Effect blurs the layer's own content. To frost what's behind a panel, use the panel's Background Blur property or Glass Effect.

## Pairs well with

- [Color Controls Effect](colorControlsEffect.md): Adjusts a layer's brightness, contrast, saturation, and hue through its Effects property.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Long Press](longPress.md): Turns on when a press is held still on a layer for a set time, and tells a quick tap apart from a hold.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Blur Effect (`builtin.blurLayerEffect`)

| Sonobe port | Origami label |
|---|---|
| `effect` | Layer Effect |
