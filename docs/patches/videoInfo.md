<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Video Info

Reads a Video layer's current time, length, and progress, for scrubbers, time labels, and player controls.

| | |
|---|---|
| Type key | `videoInfo` |
| Category | [Media](README.md#media) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | video time, current time, video duration, playback position, video progress, scrubber, video player controls |

## How it works
Video Info watches a Video layer and reports where playback is. Pick the layer in **Layer**.

- **Current Time** is how far into the video playback is, in seconds.
- **Duration** is the video's length in seconds, 0 until it has loaded.
- **Progress** runs from 0 at the start to 1 at the end.
- **Natural Size** is the video's own width and height.

The values come from the layer as it was drawn on the previous frame, so they're one frame behind.

## Tips
- Wire Progress into a Transition to move a playhead along a bar.
- To scrub, turn on the layer's Scrub and drive its Scrub Time; Current Time follows along.
- Compare Progress with 1 using Greater Than or Equal to show a replay button when a clip ends.

## Coming from Origami
Progress and Natural Size are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The Video layer to read. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Current Time**<br>`currentTime` | `number` (duration) | How far into the video playback is, in seconds, from the previous frame. |
| **Duration**<br>`duration` | `number` (duration) | The video's length in seconds, from the previous frame; 0 until it has loaded. |
| **Progress**<br>`progress` | `number` (progress) | Playback position from 0 (start) to 1 (end); 0 while Duration is unknown. |
| **Natural Size**<br>`naturalSize` | `size` (distance) | The video's own width and height, from the previous frame. |

## Examples

### Move a playhead along a bar

```text
layer clip video "Clip" @0,120 402x226 video←clip_asset.output
layer track rectangle "Track" @16,360 370x4
layer playhead oval "Playhead" 14x14 anchor=0.5,0.5 position←head_move.output
patch clip_asset videoAsset video=asset:trailer
patch clip_info videoInfo layer=@clip
patch head_move transition<point> progress←clip_info.progress start=16,362 end=386,362
```

### Show a replay button when the clip ends

Loop is off, so Progress reaches 1 and stays there.

```text
layer clip video "Clip" @0,120 402x226 loop=false video←clip_asset.output
layer replay_button oval "Replay Button" @171,203 60x60 enabled←clip_ended.output
patch clip_asset videoAsset video=asset:trailer
patch clip_info videoInfo layer=@clip
patch clip_ended greaterThanOrEqual value1←clip_info.progress value2=1
```

## Common mistakes

- Every output stays at 0: Layer is empty or points at a layer that isn't a Video layer. Pick the Video layer itself in Layer.
- A progress bar jumps back to the start at the end: the Video layer's Loop is on, so playback wraps to 0. Turn Loop off when the clip should stop on its last frame.

## Pairs well with

- [Video](videoAsset.md): Holds a video clip from your assets or a web address, ready to send to Video layers and other patches.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Greater Than or Equal](greaterThanOrEqual.md): Checks whether a value is at least another value, so reaching the threshold exactly also counts.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Video Info (`builtin.layer.videoinfo`)
