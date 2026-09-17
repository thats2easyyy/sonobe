<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Video

Holds a video clip from your assets or a web address, ready to send to Video layers and other patches.

| | |
|---|---|
| Type key | `videoAsset` |
| Category | [Media](README.md#media) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | video file, movie, clip, mp4, mov, footage, video url, asset |

## How it works
A Video patch holds one video clip. Drop a video file into the patch editor to create one, or choose an asset in **Video**. Connect **Output** to a Video layer's Video.

- **Video** is a clip from your project's assets.
- **URL** loads a clip from the web instead. When it isn't empty, it replaces Video.

The patch only holds the clip. Play, loop, speed, volume, and scrubbing are properties of the Video layer, and Video Info reads where playback is.

## Tips
- MP4 files with H.264 video play everywhere. Some .mov files play only on Apple devices.
- Wire several Video patches into Option Picker to switch clips.
- Browsers let a video with sound start only after the person first taps or clicks, so set the layer's Volume to 0 for background loops.

## Coming from Origami
The patch type key is `videoAsset`; the display name is still Video. The URL input is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Video**<br>`video` | `video` | none | The clip from your project's assets; drop a video file on the patch or choose an asset. |
| **URL**<br>`url` | `text` (url) · advanced | `""` | A web address to load the clip from instead; when it isn't empty, it replaces Video. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `video` | The clip, ready for a Video layer's Video or another patch. |

## Examples

### Play a looping background video

Volume 0 lets the clip start without a tap in the web player.

```text
layer background video "Background" @0,0 402x874 fillMode=fill volume=0 video←intro_clip.output
patch intro_clip videoAsset video=asset:intro
```

### Switch between two clips

Option Picker sends one of two clips to the same Video layer.

```text
layer player video "Player" @0,120 402x226 video←clip_picker.output
layer next_button rectangle "Next Button" @16,780 370x56
patch clip_a videoAsset video=asset:clip_a
patch clip_b videoAsset video=asset:clip_b
patch tap_next interaction layer=@next_button
patch showing_b switch flip←tap_next.tap
patch clip_picker optionPicker<video>[2] option←showing_b.on option0←clip_a.output option1←clip_b.output
```

## Common mistakes

- The clip shows but doesn't move: the Video layer's Play is off, or this browser can't decode the file. Turn Play on, and prefer MP4 files with H.264 video.
- A video with sound won't start in the web player: browsers allow playback with sound only after the person first taps or clicks. Start it from a tap, or set the layer's Volume to 0 for a background loop.

## Pairs well with

- [Video Info](videoInfo.md): Reads a Video layer's current time, length, and progress, for scrubbers, time labels, and player controls.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Video (`builtin.video`)
