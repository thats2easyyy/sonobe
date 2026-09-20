<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Device Motion

Reads how a phone is tilted, moving, and rotating, for tilt effects, parallax, and shake gestures.

| | |
|---|---|
| Type key | `deviceMotion` |
| Category | [Device](README.md#device) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | accelerometer, gyroscope, tilt, shake, motion sensor, parallax, attitude, rotation rate, gravity |

## How it works
Device Motion reads the motion sensors in a phone or tablet. Its axes follow the device: **x** points to the right edge, **y** to the top edge, and **z** out of the screen toward you.

- **Tilt** is how far the device is tipped, in degrees: x front to back, y side to side, and z the compass heading where the device reports one.
- **Acceleration** is in g (1 g is the pull of gravity) and includes gravity. A still, upright phone reads about [0, -1, 0], and tipping the right edge down pushes x toward 1.
- **Rotation Rate** is how fast the device turns around each axis, in degrees per second. It reads near 0 while the device is still.
- **Available** is true once motion data arrives.
- **Enabled** turns the sensors off to save battery.

Computers have no motion sensors, so open the web player on a phone to try it. The first time, the player asks permission to use motion.

## Tips
- Sensor values jitter. Pass them through Smooth Value before they drive a layer.
- For parallax, Remap Tilt into a small position offset.
- Detect a shake by measuring Acceleration with Length and checking Greater Than about 2.

## Coming from Origami
Has Acceleration and Has Rotation Rate are combined into Available. Rotation Rate is in degrees per second. Tilt and Enabled are new. Headphone motion tracking isn't supported.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, the patch stops reading the sensors, Available turns false, and the other outputs hold. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Tilt**<br>`tilt` | `point3d` (angle) | How far the device is tipped in degrees: x front to back, y side to side, z compass heading (0 when unknown). |
| **Acceleration**<br>`acceleration` | `point3d` | Acceleration along the device's x, y, and z axes in g, including gravity; an upright, still phone reads about [0, -1, 0]. |
| **Rotation Rate**<br>`rotationRate` | `point3d` | How fast the device turns around its x, y, and z axes, in degrees per second; near 0 when still. |
| **Available**<br>`available` | `boolean` | True once motion data is arriving; false on computers, without permission, or while disabled. |

## Examples

### Tilt the phone to pan a panorama

Acceleration's x component rises as you tip the right edge down; Smooth Value reads that first component.

```text
layer panorama image "Panorama" @0,0 1200x874 position←pan.output
patch motion deviceMotion
patch smooth smoothValue value←motion.acceleration risingHysteresis=0.9
patch tilt progress value←smooth.output start=-0.5 end=0.5 clampToRange=true
patch pan transition<point> progress←tilt.progress start=[0,0] end=[-798,0]
```

### Count shakes

```text
layer shake_count text "Shake Count" @16,120 text←shakes.count
patch motion deviceMotion
patch strength length<point3d> value←motion.acceleration
patch hard_shake greaterThan[2] value1←strength.length value2=2.2
patch shake_pulse pulse on←hard_shake.output
patch shakes counter increase←shake_pulse.turnedOn
```

## Common mistakes

- Nothing moves in the desktop viewer: computers have no motion sensors. Open the web player on a phone, or send deviceMotion events in a simulation.
- The layer trembles even when the phone lies still: raw sensor values jitter. Put a Smooth Value with a hysteresis around 0.9 between the sensor and the layer.
- Available stays false on an iPhone: iOS asks permission first and only on secure (https) pages, and Preview on Phone's address is plain http://. Test motion on an Android phone for now.

## Pairs well with

- [Smooth Value](smoothValue.md): Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.
- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.
- [Length](length.md): Measures how far a number, point, or vector is from zero, such as how far a drag has traveled in any direction.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Web-limited.** Uses the DeviceMotionEvent and DeviceOrientationEvent web APIs, which only phones and tablets provide. iOS Safari also asks permission and only allows it on secure (https) pages, so the http:// LAN player can't read motion on iPhones.

Works in the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Device Motion (`builtin.motion`)

| Sonobe port | Origami label |
|---|---|
| `available` | Has Acceleration |
