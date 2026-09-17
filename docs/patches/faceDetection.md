<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Face Detection

Finds faces in an Image or Video layer and outputs where each face, its eyes, and its mouth are.

| | |
|---|---|
| Type key | `faceDetection` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Not on the web yet |
| Search terms | face tracking, find faces, ar face, face filter, selfie filter, eyes, mouth, face recognition, vision |

## How it works
Face Detection finds faces in a picture or video, such as a camera viewfinder. Pick the Image or Video layer in **Layer**.

Most outputs are loops (lists that make a layer repeat once per item) with one item per face, and they line up: item 2 of Face Position and item 2 of Mouth Position describe the same face.

- **Face Position** and **Face Size** give each face's box, so a rectangle linked to both frames the face.
- **Face Angle** is how far each face tilts, in degrees, ready for a layer's Rotation.
- **Left Eye**, **Right Eye**, and **Mouth** outputs give each feature's center, with a Detected flag for each.
- **Tracking ID** stays the same for a face while it stays in view.
- **Max Faces** limits how many faces are reported, largest first.

Positions are in the same space as the layer's Position, so layers in the same group line up with the faces.

## Tips
- Link Face Detected into an overlay's Enabled to hide it when nobody is in frame.
- Choose High quality for small or distant faces; Low is faster for live video.
- Left and right mean the sides of the picture, not the person's own left and right.

## Coming from Origami
Tracking IDs work at every quality here. Count and Available are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The Image or Video layer to search for faces, such as a viewfinder showing a Camera feed. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, detection runs; when off, every output is empty. |
| **Max Faces**<br>`maxFaces` | `number` | `10` | The most faces to report; the largest faces win. Range 1 to 32, step 1. |
| **Quality**<br>`quality` | `enum` | `low` | How carefully to search: Low checks up to 10 frames a second at reduced size, and High checks every new frame at full size to find small or distant faces. |
| **Positioning**<br>`positioning` | `enum` · advanced | `relative` | Whether positions are in the layer's parent space or in the picture's own pixels. |

**Quality options**

- **Low** (`low`): Faster; good for live camera feeds.
- **High** (`high`): More accurate; slower.

**Positioning options**

- **Relative to Layer** (`relative`): Points in the same space as the layer's Position.
- **Absolute Pixels** (`absolute`): Pixels of the picture or video frame, from its top-left.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Face Detected**<br>`faceDetected` | `boolean` | True when at least one face is found. |
| **Count**<br>`count` | `number` | How many faces are found. step 1. |
| **Face Position**<br>`facePosition` | `point` (distance) · whole loop | A loop with the top-left corner of each face's box. |
| **Face Size**<br>`faceSize` | `size` (distance) · whole loop | A loop with the width and height of each face's box. |
| **Face Angle**<br>`faceAngle` | `number` (angle) · whole loop | A loop with how far each face tilts, in degrees; positive tilts clockwise. |
| **Left Eye Detected**<br>`leftEyeDetected` | `boolean` · whole loop | A loop that's true for each face whose left eye, on the picture's left, was found. |
| **Left Eye Position**<br>`leftEyePosition` | `point` (distance) · whole loop | A loop with each left eye's center, or 0, 0 when it wasn't found. |
| **Right Eye Detected**<br>`rightEyeDetected` | `boolean` · whole loop | A loop that's true for each face whose right eye, on the picture's right, was found. |
| **Right Eye Position**<br>`rightEyePosition` | `point` (distance) · whole loop | A loop with each right eye's center, or 0, 0 when it wasn't found. |
| **Mouth Detected**<br>`mouthDetected` | `boolean` · whole loop | A loop that's true for each face whose mouth was found. |
| **Mouth Position**<br>`mouthPosition` | `point` (distance) · whole loop | A loop with each mouth's center, or 0, 0 when it wasn't found. |
| **Tracking ID**<br>`trackingId` | `index` · whole loop | A loop with an ID for each face that stays the same while that face stays in view. |
| **Available**<br>`available` | `boolean` | True when this platform can detect faces. |

## Examples

### Frame every face in the viewfinder

Face Position and Face Size are loops, so the box repeats once per face.

```text
layer selfie video "Selfie" @0,0 402x874 fillMode=fill video←cam.stream
layer face_box rectangle "Face Box" color=#00000000 strokeWidth=3 strokeColor=#FFD60AFF position←faces.facePosition size←faces.faceSize
patch cam camera enabled=true camera=front
patch faces faceDetection layer=@selfie
```

### Show a hint when nobody is in frame

```text
layer selfie video "Selfie" @0,0 402x874 fillMode=fill video←cam.stream
layer hint text "Hint" "Look at the camera" @16,780 enabled←no_face.output
patch cam camera enabled=true camera=front
patch faces faceDetection layer=@selfie maxFaces=1
patch no_face not value←faces.faceDetected
```

## Common mistakes

- No faces are found in a camera prototype: Layer is empty or points at a layer that doesn't show the feed. Link Camera's Stream into a Video layer, then pick that Video layer in Layer.
- The face box sits in the wrong place: the box layer is in a different group than the Video layer, so their positions start from different corners. Put the box in the same group as the Video layer and keep its Anchor at the top-left.
- Available is off: this platform has no face detector yet. The patch keeps its wiring, so the prototype still loads and works where detection is available.

## Pairs well with

- [Camera](camera.md): Shows the live camera feed and takes photos or records videos you can show in Image and Video layers.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Not on the web yet.** Needs a face-detection model: browsers have no standard detector for it, and Sonobe doesn't ship one yet.

Loads from files and outputs idle values, but can't run on the web yet.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Face Detection (`builtin.facedetection`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `trackingId` | Tracking ID |
