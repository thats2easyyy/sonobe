<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Camera

Shows the live camera feed and takes photos or records videos you can show in Image and Video layers.

| | |
|---|---|
| Type key | `camera` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | webcam, viewfinder, take photo, capture photo, record video, selfie camera, camera feed, live video, getusermedia |

## How it works
Camera turns on the device's camera. The browser or system asks for permission the first time.

- **Enabled** turns the camera on and off. It starts off, so a prototype doesn't use the camera until you choose.
- **Camera** picks the front (selfie) camera or the back camera. Computers with one camera use it for both.
- **Capture** is a pulse (a signal that's on for one frame) that takes a photo.
- **Recording** records video while it's on and finishes the clip when it turns off.

The outputs:

- **Stream** is the live feed. Link it to a Video layer's Video to build a viewfinder.
- **Image** is the latest photo, and **Captured** pulses when a new one is ready.
- **Video** is the latest recording, and **Recorded** pulses when a new one is ready.
- **Available** is on while the camera is running.

## Tips
- Selfie feeds look natural mirrored: give the viewfinder layer a Scale XYZ of -1, 1, 1.
- Face, Hand, Object, and QR Code Detection can watch the viewfinder layer.
- On a phone, the web player needs an HTTPS address to use the camera.

## Coming from Origami
Record Video is Recording, and Capture Image is Capture. Quality, Record Audio, Available, Captured, and Recorded are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `false` | When on, the camera runs; it starts off, and turning it off releases the camera and turns its light off. |
| **Camera**<br>`camera` | `enum` | `back` | Which camera to use; a device with only one camera uses it for both options. |
| **Capture**<br>`capture` | `pulse` | — | Pulse to take a photo from the live feed. |
| **Recording**<br>`recording` | `boolean` | `false` | When on, records video; turning it off finishes the clip. |
| **Quality**<br>`quality` | `enum` · advanced | `medium` | The feed's target size, which the device may round to the nearest size it supports. |
| **Record Audio**<br>`recordAudio` | `boolean` · advanced | `false` | When on, recordings include microphone sound, which asks for microphone permission. |

**Camera options**

- **Front** (`front`): The screen-side (selfie) camera.
- **Back** (`back`): The camera on the back of a phone or tablet.

**Quality options**

- **Low** (`low`): 640 × 480.
- **Medium** (`medium`): 1280 × 720.
- **High** (`high`): 1920 × 1080.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Stream**<br>`stream` | `video` | The live camera feed for a Video layer's Video; empty while the camera is off. |
| **Image**<br>`image` | `image` | The most recent photo; empty until the first capture finishes. |
| **Video**<br>`video` | `video` | The most recent recording; empty until a recording finishes. |
| **Available**<br>`available` | `boolean` | True while the camera is running with permission granted. |
| **Captured**<br>`captured` | `pulse` | Pulses when a new photo is ready on Image. |
| **Recorded**<br>`recorded` | `pulse` | Pulses when a new recording is ready on Video. |

## Examples

### Take a photo with a shutter button

```text
layer viewfinder video "Viewfinder" @0,0 402x640 fillMode=fill video←cam.stream
layer shutter oval "Shutter" @166,700 70x70
layer last_photo image "Last Photo" @16,700 70x70 fillMode=fill image←cam.image
patch tap_shutter interaction layer=@shutter
patch cam camera enabled=true capture←tap_shutter.tap
```

### Hold to record, then play the clip

Down is on while the button is held, so the recording lasts as long as the press.

```text
layer viewfinder video "Viewfinder" @0,0 402x640 fillMode=fill video←cam.stream
layer record_button oval "Record Button" @166,700 70x70
layer playback video "Playback" @16,660 90x160 fillMode=fill video←cam.video
patch press_record interaction layer=@record_button
patch cam camera enabled=true recording←press_record.down recordAudio=true
```

## Common mistakes

- The viewfinder stays black everywhere: Enabled is still off, since the camera starts off. Turn Enabled on and allow the permission prompt.
- The viewfinder stays black on a phone: the web player was opened from a plain http:// address, and browsers only allow the camera on HTTPS or localhost. Open it through an HTTPS link, or test in the desktop app.
- Available stays off: camera permission was denied earlier, so the browser doesn't ask again. Allow the camera in the browser's site settings (or in System Settings on a Mac), then restart the prototype.
- Capture gives nothing: the pulse arrives before the camera is running, for example from When Prototype Starts. Capture from a tap, or wait until Available turns on.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Snapshot](snapshot.md): Captures a layer, or the whole screen, as a picture when it gets a pulse.
- [Face Detection](faceDetection.md): Finds faces in an Image or Video layer and outputs where each face, its eyes, and its mouth are.
- [QR Code Detection](qrCodeDetection.md): Scans an Image or Video layer for QR codes and outputs each code's text and corners.
- [Microphone](microphone.md): Listens to the device microphone for live sound levels and records clips you can play back.

## Availability

**Web-limited.** Uses getUserMedia, which needs camera permission and a secure page (HTTPS or localhost), so the LAN web player over plain HTTP can't use it; headless simulation has no camera.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Camera (`builtin.camera`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `capture` | Capture Image |
| `recording` | Record Video |
