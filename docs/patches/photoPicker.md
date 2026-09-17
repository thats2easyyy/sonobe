<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Photo Picker

Opens the system photo picker so people can choose photos or videos, then outputs what they chose.

| | |
|---|---|
| Type key | `photoPicker` |
| Category | [Media](README.md#media) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | photo library, photo library media, camera roll, image picker, file picker, upload photo, choose photo, gallery, attach |

## How it works
Photo Picker opens the computer's or phone's own picker for photos and videos. Send a pulse (a signal that's on for one frame) to **Open**, usually from a tap.

- **Media Type** limits the picker to photos, videos, or both.
- **Multiple** lets people choose several items at once.
- **Reset** forgets what was chosen.

After someone chooses:

- **Image** is the first item's picture. For a video, it's a still frame.
- **Video** is the first item's video, empty for photos.
- **Is Video** and **Natural Size** describe the first item.
- **Images** and **Videos** are loops (lists that make a layer repeat once per item) with every chosen item.
- **Count** says how many were chosen, and **Picked** pulses when a new choice arrives.
- **Error** turns on when a file can't be used.

## Tips
- Choosing again replaces the previous items. Canceling keeps them.
- The files stay on the device; nothing is uploaded.

## Coming from Origami
Photo Library listed the whole library. Photo Picker opens the system picker instead, because browsers can't read a photo library. Sort By, Order, Album, and isFavorite aren't available, and Photo Library Media's outputs are built in.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Open**<br>`open` | `pulse` | — | Pulse to open the system photo picker; send it from a tap, because browsers refuse to open pickers on their own. |
| **Media Type**<br>`mediaType` | `enum` | `all` | Which kinds of files people can choose. |
| **Multiple**<br>`multiple` | `boolean` | `false` | When on, people can choose several items at once. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to forget the chosen items and empty every output. |
| **Max Count**<br>`maxCount` | `number` · advanced | `10` | The most items kept while Multiple is on; extra choices are dropped. Range 1 to 100, step 1. |

**Media Type options**

- **All** (`all`): Photos and videos.
- **Photos** (`photos`)
- **Videos** (`videos`)

## Outputs

| Output | Type | Description |
|---|---|---|
| **Image**<br>`image` | `image` | The first chosen item's picture (a still frame for a video); empty until someone chooses. |
| **Video**<br>`video` | `video` | The first chosen item's video; empty for photos. |
| **Is Video**<br>`isVideo` | `boolean` | True when the first chosen item is a video. |
| **Natural Size**<br>`naturalSize` | `size` (distance) | The first chosen item's width and height in pixels, which count as points. |
| **Images**<br>`images` | `image` · whole loop | A loop with every chosen item's picture, in the order they were chosen. |
| **Videos**<br>`videos` | `video` · whole loop · advanced | A loop with every chosen item's video, with empty values for photos. |
| **Count**<br>`count` | `number` | How many items are chosen. step 1. |
| **Picked**<br>`picked` | `pulse` | Pulses when a new choice arrives. |
| **Loading**<br>`loading` | `boolean` · advanced | True while the picker is open or the chosen files are still loading. |
| **Error**<br>`error` | `boolean` | True when the last choice couldn't be used, for example an unsupported file format. |
| **Error Message**<br>`errorMessage` | `text` · advanced | Readable text explaining why the last choice failed; empty otherwise. |

## Examples

### Tap the avatar to choose a profile photo

```text
layer avatar image "Avatar" @151,160 100x100 cornerRadius=50 fillMode=fill image←photo_picker.image
patch tap_avatar interaction layer=@avatar
patch photo_picker photoPicker open←tap_avatar.tap mediaType=photos
```

### Show every chosen photo in a row

Images is a loop, so the thumbnail repeats once per photo inside a row layout.

```text
layer thumbnails group "Thumbnails" @16,600 370x80 layout=row spacing=8
  layer thumbnail image "Thumbnail" 80x80 fillMode=fill image←photo_picker.images
layer add_button rectangle "Add Button" @16,700 370x56
patch tap_add interaction layer=@add_button
patch photo_picker photoPicker open←tap_add.tap mediaType=photos multiple=true
```

## Common mistakes

- Nothing happens on Open: the pulse comes from a timer or When Prototype Starts, and browsers only open pickers right after a tap or click. Wire Open to an Interaction's Tap.
- A layer linked to Images disappears before anything is chosen: Images is an empty loop, so the layer repeats zero times. Use Image for a single picture, or show a placeholder while Count is 0.
- An iPhone photo turns Error on: some browsers can't decode HEIC photos. Try Safari or the desktop app, or export the photo as JPEG.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Image Info](imageInfo.md): Reads a picture's natural size, pixel density, name, and aspect ratio, so layouts can match the image.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.

## Availability

**Web-limited.** Uses the system file picker, which browsers open only right after a tap, click, or key press; headless simulation has no picker, and some browsers can't decode HEIC photos.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Photo Library (`builtin.photolibrary`)
- **Also imports:** `builtin.photoLibrary`, `builtin.photomediainfos`, `builtin.photoMediaInfo`

| Sonobe port | Origami label |
|---|---|
| `image` | Photo Library Media › Image |
| `video` | Photo Library Media › Video |
| `isVideo` | Photo Library Media › isPlayable |
| `naturalSize` | Photo Library Media › Natural Size |
| `images` | Photo Media |
