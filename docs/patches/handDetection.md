<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Hand Detection

Finds hands in an Image or Video layer and outputs where each hand and its fingertips are.

| | |
|---|---|
| Type key | `handDetection` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Not on the web yet |
| Search terms | hand tracking, hand pose, finger tracking, pinch, fingertip, hand landmarks, gesture detection, vision |

## How it works
Hand Detection finds hands in a picture or video, such as a camera viewfinder. Pick the Image or Video layer in **Layer**.

Most outputs are loops (lists that make a layer repeat once per item) with one item per hand, and they line up: item 0 of every loop describes the same hand.

- **Hand Position** and **Hand Size** give each hand's box.
- **Wrist**, **Thumb Tip**, **Index Tip**, **Middle Tip**, **Ring Tip**, and **Pinky Tip** give key points, ready for a layer's Position.
- **Pinch Distance** is the distance between the thumb tip and the index tip, in points. It's small while pinching.
- **Handedness** says whether each hand is a left or a right hand.
- **Max Hands** limits how many hands are reported, largest first.

Positions are in the same space as the layer's Position, so layers in the same group line up with the hands.

## Tips
- Compare Pinch Distance with Less Than to turn a pinch into an on/off state.
- Set Max Hands to 1 when one person controls the prototype; the loops stay simple.
- Landmarks holds all 21 points of each hand for advanced effects.

## Coming from Origami
Origami added Hand Detection without published documentation, so these ports are Sonobe's design, modeled on Face Detection.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The Image or Video layer to search for hands, such as a viewfinder showing a Camera feed. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, detection runs; when off, every output is empty. |
| **Max Hands**<br>`maxHands` | `number` | `2` | The most hands to report; the largest hands win. Range 1 to 8, step 1. |
| **Quality**<br>`quality` | `enum` | `low` | How carefully to search: Low checks up to 10 frames a second at reduced size, and High checks every new frame at full size to find small or distant hands. |
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
| **Hand Detected**<br>`handDetected` | `boolean` | True when at least one hand is found. |
| **Count**<br>`count` | `number` | How many hands are found. step 1. |
| **Hand Position**<br>`handPosition` | `point` (distance) · whole loop | A loop with the top-left corner of each hand's box. |
| **Hand Size**<br>`handSize` | `size` (distance) · whole loop | A loop with the width and height of each hand's box. |
| **Wrist**<br>`wrist` | `point` (distance) · whole loop | A loop with each hand's wrist position. |
| **Thumb Tip**<br>`thumbTip` | `point` (distance) · whole loop | A loop with each hand's thumb tip position. |
| **Index Tip**<br>`indexTip` | `point` (distance) · whole loop | A loop with each hand's index fingertip position. |
| **Middle Tip**<br>`middleTip` | `point` (distance) · whole loop | A loop with each hand's middle fingertip position. |
| **Ring Tip**<br>`ringTip` | `point` (distance) · whole loop | A loop with each hand's ring fingertip position. |
| **Pinky Tip**<br>`pinkyTip` | `point` (distance) · whole loop | A loop with each hand's pinky fingertip position. |
| **Pinch Distance**<br>`pinchDistance` | `number` (distance) · whole loop | A loop with the distance between each hand's thumb tip and index tip, in points; small while pinching. |
| **Handedness**<br>`handedness` | `enum` · whole loop | A loop saying whether each hand is a left or a right hand. Options: Left (`left`), Right (`right`). |
| **Confidence**<br>`confidence` | `number` (progress) · whole loop · advanced | A loop with how sure the detector is about each hand, from 0 to 1. |
| **Landmarks**<br>`landmarks` | `json` · whole loop · advanced | A loop with each hand's 21 points as [x, y] pairs, from the wrist to the pinky tip. |
| **Tracking ID**<br>`trackingId` | `index` · whole loop · advanced | A loop with an ID for each hand that stays the same while that hand stays in view. |
| **Available**<br>`available` | `boolean` | True when this platform can detect hands. |

## Examples

### Follow the index fingertip with a dot

```text
layer feed video "Feed" @0,0 402x874 fillMode=fill video←cam.stream
layer cursor oval "Cursor" 24x24 anchor=0.5,0.5 position←hands.indexTip
patch cam camera enabled=true camera=front
patch hands handDetection layer=@feed maxHands=1
```

### Pinch to light a bulb

Less Than turns on while the fingertips are within 30 points.

```text
layer feed video "Feed" @0,0 402x874 fillMode=fill video←cam.stream
layer bulb oval "Bulb" @151,120 100x100 color=#FFD60AFF opacity←glow.output
patch cam camera enabled=true camera=front
patch hands handDetection layer=@feed maxHands=1
patch pinching lessThan value1←hands.pinchDistance value2=30
patch glow popAnimation number←pinching.output
```

## Common mistakes

- A pinch never registers: Pinch Distance is a loop, so a comparison gives one answer per hand. Set Max Hands to 1, or combine the answers with Any.
- The fingertip dot moves the opposite way: the viewfinder layer is mirrored with Scale XYZ, but positions come from the unmirrored picture. Mirror a group that holds both the viewfinder and the dot, or mirror neither.
- Available is off: this platform has no hand detector yet. The patch keeps its wiring, so the prototype still loads and works where detection is available.

## Pairs well with

- [Camera](camera.md): Shows the live camera feed and takes photos or records videos you can show in Image and Video layers.
- [Less Than](lessThan.md): Checks whether a value is less than another, such as a scroll pulled past the top or an item before the current one.
- [Any](loopAny.md): Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Not on the web yet.** Needs a hand-landmark model: browsers have no standard detector for it, and Sonobe doesn't ship one yet.

Loads from files and outputs idle values, but can't run on the web yet.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Hand Detection
