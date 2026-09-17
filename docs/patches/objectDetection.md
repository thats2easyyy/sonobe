<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Object Detection

Finds the most eye-catching regions of an Image or Video layer, for smart cropping and highlighting subjects.

| | |
|---|---|
| Type key | `objectDetection` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | saliency detection, salient regions, smart crop, subject detection, attention, focus area, auto framing, vision |

## How it works
Object Detection finds what stands out in a picture or video: a subject against a plain background, a bright spot, a busy detail. It finds where things are, not what they are. Pick the Image or Video layer in **Layer**.

- **Mode** chooses what to find. **Objects** returns up to three standout regions. **Attention** returns the one region most worth keeping when you crop.
- **Region Detected** is on when something was found, and **Count** says how many regions there are.
- **Position** and **Size** are loops (lists that make a layer repeat once per item) with each region's box, in the same space as the layer's Position.

## Tips
- Frame the regions with a stroked Rectangle linked to Position and Size.
- For a smart thumbnail, use Attention mode and move the picture so the region stays in view.
- Busy, textured pictures give larger, less precise regions.

## Coming from Origami
Type is Mode. Origami uses the operating system's saliency model, while Sonobe runs its own algorithm, so the regions differ. Count and Available are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The Image or Video layer to search for standout regions, such as a viewfinder showing a Camera feed. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, detection runs; when off, every output is empty. |
| **Mode**<br>`mode` | `enum` | `objects` | What to find: up to three standout objects, or the one region most worth keeping when cropping. |

**Mode options**

- **Objects** (`objects`): Up to three standout regions.
- **Attention** (`attention`): The one region most worth keeping when cropping.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Region Detected**<br>`regionDetected` | `boolean` | True when at least one region is found. |
| **Count**<br>`count` | `number` | How many regions are found. step 1. |
| **Position**<br>`position` | `point` (distance) · whole loop | A loop with the top-left corner of each region's box, in the layer's parent space. |
| **Size**<br>`size` | `size` (distance) · whole loop | A loop with the width and height of each region's box. |
| **Available**<br>`available` | `boolean` | True when this platform can detect regions. |
| **Error**<br>`error` | `boolean` · advanced | True when the layer's pixels can't be read, for example a cross-site picture without CORS. |
| **Error Message**<br>`errorMessage` | `text` · advanced | Readable text explaining why detection can't run; empty otherwise. |

## Examples

### Frame the standout subjects of a photo

Position and Size are loops, so the box repeats once per region.

```text
layer photo image "Photo" @16,120 370x370 fillMode=fit image←photo_asset.output
layer subject_box rectangle "Subject Box" color=#00000000 strokeWidth=2 strokeColor=#FF375FFF position←subjects.position size←subjects.size
patch photo_asset imageAsset image=asset:street
patch subjects objectDetection layer=@photo
```

### Follow the focus of a live camera

Pop Animation glides the box when the region moves.

```text
layer feed video "Feed" @0,0 402x874 fillMode=fill video←cam.stream
layer focus_box rectangle "Focus Box" color=#00000000 strokeWidth=2 strokeColor=#FFFFFFFF position←focus_move.output size←focus.size
patch cam camera
patch focus objectDetection layer=@feed mode=attention
patch focus_move popAnimation<point> number←focus.position bounciness=0 speed=12
```

## Common mistakes

- Error turns on for a web picture: the page can't read pixels from other sites unless they allow it (CORS). Add the picture to your project's assets.
- Attention mode frames the whole picture: nothing in it stands out, such as a flat texture or an evenly lit scene. Try Objects mode, or a picture with a clear subject.
- The box is offset from the subject: the rectangle is in a different group than the Image layer. Keep the overlay in the same group, with its Anchor at the top-left.

## Pairs well with

- [Image](imageAsset.md): Holds a picture from your assets or a web address, ready to send to Image layers and other patches.
- [Camera](camera.md): Shows the live camera feed and takes photos or records videos you can show in Image and Video layers.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.

## Availability

**Web-limited.** Runs a built-in saliency algorithm on the layer's pixels, which browsers expose only for same-site or CORS-enabled media; headless simulation can't decode pictures.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Object Detection (`builtin.saliencydetection`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `mode` | Type |
| `errorMessage` | Error Description |
