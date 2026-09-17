<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Image

Holds a picture from your assets or a web address, ready to send to Image layers and other patches.

| | |
|---|---|
| Type key | `imageAsset` |
| Category | [Media](README.md#media) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | image file, picture, photo, png, jpg, bitmap, graphic, image url, asset |

## How it works
An Image patch holds one picture. Drop an image file into the patch editor to create one, or choose an asset in **Image**. Connect **Output** to an Image layer's Image, or to patches that choose between pictures, such as Option Picker or If / Else.

- **Image** is a picture from your project's assets.
- **URL** loads a picture from the web instead. When it isn't empty, it replaces Image.

The patch doesn't draw anything itself; an Image layer does.

## Tips
- To swap pictures when something changes, wire several Image patches into If / Else or Option Picker.
- Image Info reads a picture's size and name.
- Web pictures load in the background, so an Image layer may stay empty for a moment.

## Coming from Origami
The patch type key is `imageAsset`; the display name is still Image. The URL input is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Image**<br>`image` | `image` | none | The picture from your project's assets; drop an image file on the patch or choose an asset. |
| **URL**<br>`url` | `text` (url) · advanced | `""` | A web address to load the picture from instead; when it isn't empty, it replaces Image. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `image` | The picture, ready for an Image layer's Image or another patch. |

## Examples

### Swap album art at night

If / Else picks between two Image patches when the Switch flips.

```text
layer album_art image "Album Art" @51,160 300x300 image←artwork.output
layer night_button rectangle "Night Button" @16,700 370x56
patch cover_day imageAsset image=asset:cover_day
patch cover_night imageAsset image=asset:cover_night
patch tap_night interaction layer=@night_button
patch night switch flip←tap_night.tap
patch artwork ifElse<image> condition←night.on ifTrue←cover_night.output ifFalse←cover_day.output
```

### Load a photo from the web

```text
layer hero image "Hero" @0,0 402x300 fillMode=fill image←hero_photo.output
patch hero_photo imageAsset url="https://images.example.com/beach.jpg"
```

## Common mistakes

- The picture never shows up: the Image patch isn't linked to a layer. Link Output into an Image layer's Image property.
- A web picture leaves the layer empty: the URL points to a web page rather than the image file. Open the picture on its own and copy that address, which usually ends in .jpg, .png, or .webp.

## Pairs well with

- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Image Info](imageInfo.md): Reads a picture's natural size, pixel density, name, and aspect ratio, so layouts can match the image.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Image (`builtin.image`)
