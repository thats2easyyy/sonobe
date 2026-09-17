<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Snapshot

Captures a layer, or the whole screen, as a picture when it gets a pulse.

| | |
|---|---|
| Type key | `snapshot` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | screenshot, freeze frame, capture layer, render to image, screen capture, grab, rasterize, export image |

## How it works
Snapshot takes a picture of what's on screen. Send a pulse (a signal that's on for one frame) to **Capture**.

- **Layer** chooses what to capture, including everything inside it. Leave it empty to capture the whole screen.
- **Image** holds the latest picture until the next capture.
- **Captured** pulses when the picture is ready, usually a frame or two after Capture.

## Tips
- Freeze the screen before a big change: show the snapshot in an Image layer on top, change the layers underneath, then fade the snapshot out.
- Capture a group that combines a camera feed with stickers to make a photo booth result.
- The picture has the layer's own size at the screen's pixel density, so it stays sharp at a scale of 1.

## Coming from Origami
Capture is Origami's Sample. Captured is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer to capture, with everything inside it; empty captures the whole screen. |
| **Capture**<br>`capture` | `pulse` | — | Pulse to take a picture of the layer as it looks on this frame. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Image**<br>`image` | `image` | The latest picture; empty until the first capture finishes. |
| **Captured**<br>`captured` | `pulse` | Pulses when a new picture is ready on Image. |

## Examples

### Save a thumbnail of a card

```text
layer card group "Card" @16,120 370x220
layer thumbnail image "Thumbnail" @16,600 111x66 image←grab.image
layer save_button rectangle "Save Button" @16,780 370x56
patch tap_save interaction layer=@save_button
patch grab snapshot layer=@card capture←tap_save.tap
```

### Make a photo booth picture

The booth group combines the live feed and a sticker, and Snapshot flattens them into one picture.

```text
layer booth group "Booth" @0,0 402x640
  layer booth_feed video "Booth Feed" @0,0 402x640 fillMode=fill video←cam.stream
  layer sticker image "Sticker" @140,80 120x120 image←sticker_art.output
layer result image "Result" @16,660 120x190 image←grab.image
layer shutter oval "Shutter" @266,700 70x70
patch cam camera enabled=true camera=front
patch sticker_art imageAsset image=asset:party_hat
patch tap_shutter interaction layer=@shutter
patch grab snapshot layer=@booth capture←tap_shutter.tap
```

## Common mistakes

- The snapshot misses a change you just made: an animation hadn't finished moving when Capture fired. Send Capture after the animation ends, for example through a Delay.
- The picture is blank where a web image should be: the web player can't copy pictures from other sites unless they allow it (CORS). Add the picture to your project's assets instead.
- Image is still the old picture right after Capture: the new picture takes a frame or two to arrive. React to Captured instead of the Capture pulse.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Camera](camera.md): Shows the live camera feed and takes photos or records videos you can show in Image and Video layers.
- [Image Info](imageInfo.md): Reads a picture's natural size, pixel density, name, and aspect ratio, so layouts can match the image.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.

## Availability

**Web-limited.** The desktop app reads real pixels; the web player redraws the scene into a canvas, which leaves out cross-site images and videos without CORS headers, and headless simulation can't draw pixels.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Snapshot (`builtin.snapshot`)

| Sonobe port | Origami label |
|---|---|
| `capture` | Sample |
