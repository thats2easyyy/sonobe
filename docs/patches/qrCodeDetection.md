<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# QR Code Detection

Scans an Image or Video layer for QR codes and outputs each code's text and corners.

| | |
|---|---|
| Type key | `qrCodeDetection` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | qr code, barcode, qr scanner, scan code, code reader, decode qr, scan, vision |

## How it works
QR Code Detection finds QR codes in a picture or video, such as a camera viewfinder, and reads them. Pick the Image or Video layer in **Layer**.

- **QR Detected** is on while at least one code is found, and **Count** says how many.
- **Message** is a loop (a list that makes a layer repeat once per item) with each code's text, often a web address.
- **Top Left**, **Top Right**, **Bottom Left**, and **Bottom Right** are loops with each code's corners, in the same space as the layer's Position. They follow the code's own orientation, so a tilted code gives tilted corners.
- **Quality** trades speed for accuracy. High helps with small or distant codes.

The loops line up: item 1 of Message and item 1 of Top Left describe the same code.

## Tips
- Wire QR Detected into a Pulse and use Turned On to move to a success screen once.
- Link Top Left into a marker layer's Position to show where the code is.
- Scanning a still picture works too: pick an Image layer.

## Coming from Origami
Count and Available are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The Image or Video layer to search for QR codes, such as a viewfinder showing a Camera feed. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, detection runs; when off, every output is empty. |
| **Quality**<br>`quality` | `enum` | `low` | How carefully to search: Low checks up to 10 frames a second at reduced size, and High checks every new frame at full size to find small or distant codes. |

**Quality options**

- **Low** (`low`): Faster; good for live camera feeds.
- **High** (`high`): More accurate; slower.

## Outputs

| Output | Type | Description |
|---|---|---|
| **QR Detected**<br>`qrDetected` | `boolean` | True when at least one QR code is found. |
| **Count**<br>`count` | `number` | How many codes are found. step 1. |
| **Message**<br>`message` | `text` · whole loop | A loop with each code's decoded text, often a web address. |
| **Top Left**<br>`topLeft` | `point` (distance) · whole loop | A loop with each code's top-left corner, following the code's own orientation. |
| **Top Right**<br>`topRight` | `point` (distance) · whole loop | A loop with each code's top-right corner. |
| **Bottom Left**<br>`bottomLeft` | `point` (distance) · whole loop | A loop with each code's bottom-left corner. |
| **Bottom Right**<br>`bottomRight` | `point` (distance) · whole loop | A loop with each code's bottom-right corner. |
| **Available**<br>`available` | `boolean` | True when this platform can detect QR codes. |

## Examples

### Scan a code and show its text

Message is a loop, so the text layer repeats once per code.

```text
layer viewfinder video "Viewfinder" @0,0 402x874 fillMode=fill video←cam.stream
layer result text "Result" @16,780 text←scanner.message
patch cam camera
patch scanner qrCodeDetection layer=@viewfinder
```

### Move to a success screen once a code is scanned

```text
layer viewfinder video "Viewfinder" @0,0 402x874 fillMode=fill video←cam.stream
layer success rectangle "Success" @0,0 402x874 color=#34C759FF opacity←success_fade.output
patch cam camera
patch scanner qrCodeDetection layer=@viewfinder
patch found pulse on←scanner.qrDetected
patch linked switch turnOn←found.turnedOn
patch success_fade popAnimation number←linked.on
```

## Common mistakes

- Available is off in the web player: this browser has no built-in QR decoder. Use Chrome on a Mac or an Android phone, or the desktop app on a Mac.
- The success screen flickers on and off: QR Detected turns off whenever the code leaves view for a moment. Send it through a Pulse into a Switch's Turn On so the change sticks.
- Nothing scans from the camera: Layer is empty or points at a layer that doesn't show the feed. Link Camera's Stream into a Video layer and pick that layer.

## Pairs well with

- [Camera](camera.md): Shows the live camera feed and takes photos or records videos you can show in Image and Video layers.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.

## Availability

**Web-limited.** Uses the Shape Detection API's BarcodeDetector, which ships only in Chromium on macOS, Android, and ChromeOS; Windows, Linux, Firefox, and Safari have none, and headless simulation can't decode pictures.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** QR Code Detection (`builtin.qrdetection`)
- **Also imports:** `builtin.qrDetection`

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
