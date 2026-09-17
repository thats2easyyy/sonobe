<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Device Info

Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.

| | |
|---|---|
| Type key | `deviceInfo` |
| Category | [Device](README.md#device) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | screen size, safe area, dark mode, screen scale, device orientation, device name, uses a mouse, responsive, notch |

## How it works
Device Info describes the phone, tablet, or computer your prototype is showing on: the device picked in the viewer, or the real phone when you open the web player on one. It has no inputs.

- **Screen Size** is the width and height in points. They swap while the interface is in landscape.
- **Safe Area** is how many points system UI covers on each edge, as [top, right, bottom, left]: the status bar, camera cutout, and home indicator.
- **Screen Scale** is how many pixels make up one point, such as 3 on recent iPhones.
- **Orientation** is how far the device is turned, in degrees. **Landscape** is true while the screen is wider than it's tall.
- **Uses a Mouse** is true for computer devices, where people point and click instead of touching.
- **Dark Mode** follows the system appearance.
- **Device Name** is the device's display name, like iPhone 17 Pro.

## Tips
- Wire Screen Size into a full-screen layer's Size so it fits every device and orientation.
- Unpack Safe Area with Edges Unpack and use Top to keep headers below the status bar.
- Feed Dark Mode into If / Else to pick colors for each theme.
- Rotating the viewer turns the interface only when an Interface Orientation patch allows it.

## Coming from Origami
Device is called Device Name. Safe Area is a Point 4D in [top, right, bottom, left] order. Landscape is new.

## Inputs

This patch has no fixed inputs.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Screen Size**<br>`screenSize` | `size` (distance) | Width and height of the screen in points; they swap while the interface is in landscape. |
| **Safe Area**<br>`safeArea` | `point4d` (distance) | Points covered by system UI on each edge, as [top, right, bottom, left]: status bar, camera cutout, and home indicator. |
| **Screen Scale**<br>`screenScale` | `number` | Pixels per point, such as 3 on recent iPhones and 1 or 2 on computer displays. |
| **Orientation**<br>`orientation` | `number` (angle) | How far the device is turned in degrees: 0 upright, 90 turned left, 180 upside down, 270 turned right. |
| **Landscape**<br>`landscape` | `boolean` | True while the screen is wider than it is tall. |
| **Uses a Mouse**<br>`usesMouse` | `boolean` | True when the device is a computer, where people use a mouse or trackpad instead of touch. |
| **Dark Mode**<br>`darkMode` | `boolean` | True while the system appearance is dark. |
| **Device Name**<br>`deviceName` | `text` | The device's display name, such as iPhone 17 Pro. |

## Examples

### Fill the screen on every device

```text
layer backdrop rectangle "Backdrop" @0,0 size←info.screenSize color=#101820FF
patch info deviceInfo
```

### Switch a card to dark colors

```text
layer card rectangle "Card" @16,120 370x220 cornerRadius=20 color←theme.output
patch info deviceInfo
patch theme ifElse<color> condition←info.darkMode ifTrue=#1C1C1EFF ifFalse=#FFFFFFFF
```

### Enlarge a photo in landscape

Interface Orientation lets the interface turn, and Landscape drives the spring.

```text
layer photo image "Photo" @16,200 370x250 scale←zoom.output
patch rotation interfaceOrientation landscapeLeft=true landscapeRight=true
patch info deviceInfo
patch pop popAnimation number←info.landscape bounciness=2 speed=12
patch zoom transition<number> progress←pop.output start=1 end=1.6
```

## Common mistakes

- Landscape never turns true when you rotate the viewer: the interface stays upright unless an Interface Orientation patch allows landscape. Add one and leave Landscape Left and Landscape Right on.
- A header slides under the status bar on some devices: a fixed top padding only fits one device. Use the top value of Safe Area instead.
- Uses a Mouse is false while you click around in the desktop app: it describes the device you picked, not your computer. Pick a Desktop device to preview the mouse layout.

## Pairs well with

- [Interface Orientation](interfaceOrientation.md): Chooses which ways the interface turns when the device rotates, and which orientation it starts in.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.
- [Edges Unpack](edgesUnpack.md): Splits an Edges value into separate top, right, bottom, and left distances.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Device Info (`builtin.deviceinfo`)

| Sonobe port | Origami label |
|---|---|
| `usesMouse` | Uses a Mouse |
| `deviceName` | Device |
