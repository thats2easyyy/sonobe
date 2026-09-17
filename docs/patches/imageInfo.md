<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Image Info

Reads a picture's natural size, pixel density, name, and aspect ratio, so layouts can match the image.

| | |
|---|---|
| Type key | `imageInfo` |
| Category | [Media](README.md#media) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | image size, natural size, dimensions, aspect ratio, image name, picture info, resolution, file name |

## How it works
Image Info looks at one picture and tells you about it. Connect a picture to **Image**: an Image patch, a Photo Picker, a Snapshot, or a Camera capture.

- **Natural Size** is the picture's width and height in points.
- **Scale** is the picture's pixel density: 2 for a file named like `icon@2x.png`, 3 for `@3x`, otherwise 1. Natural Size already accounts for it.
- **Name** is the file's name without its extension.
- **Aspect Ratio** is width divided by height: above 1 for landscape pictures, below 1 for portrait ones.
- **Loading** is on while a picture from the web is still downloading.

## Tips
- Link Natural Size into an Image layer's Size to show a picture at its natural size.
- For a fixed width, the matching height is that width divided by Aspect Ratio.
- While a new picture loads, the outputs keep describing the previous one, so layouts don't jump.

## Coming from Origami
Size is called Natural Size here, matching Video Info and the Image layer. Aspect Ratio and Loading are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Image**<br>`image` | `image` | none | The picture to describe: an Image patch, a Photo Picker, a Snapshot, or any other picture. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Natural Size**<br>`naturalSize` | `size` (distance) | The picture's natural width and height in points. |
| **Scale**<br>`scale` | `number` | The picture's pixel density: 2 or 3 for files named @2x or @3x, otherwise 1. |
| **Name**<br>`name` | `text` | The file's name without its extension; empty for pictures made by patches. |
| **Aspect Ratio**<br>`aspectRatio` | `number` | Width divided by height; 0 when there's no picture. |
| **Loading**<br>`loading` | `boolean` | True while a picture from the web is still loading. |

## Examples

### Show a picture at its natural size

```text
layer photo image "Photo" @16,120 image←photo_asset.output size←photo_info.naturalSize
patch photo_asset imageAsset image=asset:beach
patch photo_info imageInfo image←photo_asset.output
```

### Caption a picture with its file name

```text
layer photo image "Photo" @16,120 370x240 fillMode=fit image←photo_asset.output
layer caption text "Caption" @16,372 text←photo_info.name
patch photo_asset imageAsset image=asset:beach
patch photo_info imageInfo image←photo_asset.output
```

## Common mistakes

- A layer sized by Image Info starts at zero size: a web picture reports 0 × 0 until it has loaded. Use If / Else on Loading to give the layer a placeholder size until then.
- Natural Size looks twice as large as expected: the file name has no @2x, so its pixels count as points. Export retina files with @2x or @3x in the name.

## Pairs well with

- [Image](imageAsset.md): Holds a picture from your assets or a web address, ready to send to Image layers and other patches.
- [Photo Picker](photoPicker.md): Opens the system photo picker so people can choose photos or videos, then outputs what they chose.
- [Snapshot](snapshot.md): Captures a layer, or the whole screen, as a picture when it gets a pulse.
- [Size Unpack](sizeUnpack.md): Splits a size into separate Width and Height numbers.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Image Info (`builtin.layer.imageinfo`)

| Sonobe port | Origami label |
|---|---|
| `naturalSize` | Size |
