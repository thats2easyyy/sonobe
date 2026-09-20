<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Interface Orientation

Reports which way the interface would face as the device rotates, from the directions you allow and a starting orientation.

| | |
|---|---|
| Type key | `interfaceOrientation` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | rotation lock, orientation lock, auto rotate, screen rotation, landscape mode, portrait mode, rotate interface |

## How it works
Interface Orientation works out which way the interface would face as the device rotates, from the directions you allow. It only reports that: no host turns the interface from it yet. The viewer's Rotate button turns the interface by itself, with or without this patch, and the web player on a phone keeps the project's orientation.

- **Portrait**, **Landscape Left**, **Landscape Right**, and **Upside Down** say which ways the interface may face. When the device turns to a direction that's off, Orientation keeps its current value.
- **Start In** is the orientation reported when the prototype starts or restarts. If the device can't show it, Orientation starts at portrait.
- **Orientation** and **Landscape** report the result.

Landscape Left means the device is turned counterclockwise, with its top edge on the left. Phones with a camera cutout, like recent iPhones, never face upside down.

## Tips
- Resize layouts from Device Info's Screen Size, which swaps when the viewer rotates.
- On a phone, where the web player keeps the project's orientation, use Landscape to rearrange layers for a phone turned on its side.
- Use one Interface Orientation patch per prototype.

## Coming from Origami
Orientation and Landscape are new outputs. Origami turns the interface from this patch; Sonobe doesn't yet, and the interface keeps the project's orientation instead of always portrait.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Start In**<br>`startIn` | `enum` | `portrait` | The orientation reported when the prototype starts or restarts; portrait if the device can't show it. |
| **Portrait**<br>`portrait` | `boolean` | `true` | When on, Orientation turns to Portrait when the device is held upright. |
| **Landscape Left**<br>`landscapeLeft` | `boolean` | `true` | When on, Orientation turns to Landscape Left when the device is turned counterclockwise. |
| **Landscape Right**<br>`landscapeRight` | `boolean` | `true` | When on, Orientation turns to Landscape Right when the device is turned clockwise. |
| **Upside Down**<br>`upsideDown` | `boolean` | `false` | When on, Orientation turns to Upside Down when the device is turned over; phones with a camera cutout never do. |

**Start In options**

- **Portrait** (`portrait`): Upright, with the top edge at the top.
- **Landscape Left** (`landscapeLeft`): Turned counterclockwise, with the top edge on the left.
- **Landscape Right** (`landscapeRight`): Turned clockwise, with the top edge on the right.
- **Upside Down** (`upsideDown`): Turned halfway around, with the top edge at the bottom.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Orientation**<br>`orientation` | `enum` | Which way the interface would face. |
| **Landscape**<br>`landscape` | `boolean` | True while Orientation is Landscape Left or Landscape Right. |

## Examples

### Show a hint while the device is on its side

Upside Down stays off, so turning the device over doesn't count.

```text
layer turn_hint text "Turn Hint" @24,60 text="Turn your phone upright" opacity←rotation.landscape
patch rotation interfaceOrientation startIn=portrait portrait=true landscapeLeft=true landscapeRight=true upsideDown=false
```

## Common mistakes

- Rotating the viewer turns the interface although Landscape Left and Landscape Right are off: no host turns the interface from this patch yet, so it can't lock rotation. Its own Orientation and Landscape do stay put.
- Orientation starts at portrait although Start In is Upside Down: phones with a camera cutout can't show upside down. Pick another Start In or another device.
- Layers keep their portrait size after the viewer rotates: sizes don't follow the screen by themselves. Drive them from Device Info's Screen Size.

## Pairs well with

- [Device Info](deviceInfo.md): Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Web-limited.** No host turns the interface from it yet. The viewer's Rotate button turns the interface by itself, and the web player keeps the project's orientation, so the patch only reports which way the interface would face.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Interface Orientation (`builtin.deviceorientation`)
