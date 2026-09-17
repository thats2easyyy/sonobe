<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Interface Orientation

Chooses which ways the interface turns when the device rotates, and which orientation it starts in.

| | |
|---|---|
| Type key | `interfaceOrientation` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Supported |
| Search terms | rotation lock, orientation lock, auto rotate, screen rotation, landscape mode, portrait mode, rotate interface |

## How it works
Without this patch, the interface stays upright when you rotate the viewer or the phone. Interface Orientation lets it turn.

- **Portrait**, **Landscape Left**, **Landscape Right**, and **Upside Down** say which ways the interface may turn. When the device turns to a direction that's off, the interface keeps its current orientation.
- **Start In** is the orientation shown when the prototype starts or restarts. If the device can't show it, the prototype starts in portrait.
- **Orientation** and **Landscape** report the interface's current orientation.

Landscape Left means the device is turned counterclockwise, with its top edge on the left. Test with the viewer's rotate button. Phones with a camera cutout, like recent iPhones, never turn upside down.

## Tips
- Resize layouts from Device Info's Screen Size, which swaps when the interface turns.
- Lock rotation while something is open: wire a Switch's On through Not into Landscape Left and Landscape Right.
- Use one Interface Orientation patch per prototype.

## Coming from Origami
Orientation and Landscape are new outputs. Without the patch, the interface keeps the project's orientation instead of always portrait.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Start In**<br>`startIn` | `enum` | `portrait` | The orientation shown when the prototype starts or restarts; portrait if the device can't show it. |
| **Portrait**<br>`portrait` | `boolean` | `true` | When on, the interface turns upright when the device is held upright. |
| **Landscape Left**<br>`landscapeLeft` | `boolean` | `true` | When on, the interface turns when the device is turned counterclockwise. |
| **Landscape Right**<br>`landscapeRight` | `boolean` | `true` | When on, the interface turns when the device is turned clockwise. |
| **Upside Down**<br>`upsideDown` | `boolean` | `false` | When on, the interface turns when the device is upside down; phones with a camera cutout never do. |

**Start In options**

- **Portrait** (`portrait`): Upright, with the top edge at the top.
- **Landscape Left** (`landscapeLeft`): Turned counterclockwise, with the top edge on the left.
- **Landscape Right** (`landscapeRight`): Turned clockwise, with the top edge on the right.
- **Upside Down** (`upsideDown`): Turned halfway around, with the top edge at the bottom.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Orientation**<br>`orientation` | `enum` | The interface's current orientation. |
| **Landscape**<br>`landscape` | `boolean` | True while the interface is in Landscape Left or Landscape Right. |

## Examples

### Let a video fill the screen in any orientation

```text
layer player video "Player" @0,0 size←info.screenSize
patch rotation interfaceOrientation startIn=portrait portrait=true landscapeLeft=true landscapeRight=true upsideDown=false
patch info deviceInfo
```

### Lock rotation while a sheet is open

```text
layer sheet_button rectangle "Sheet Button" @16,780 370x56 cornerRadius=14
patch tap_button interaction layer=@sheet_button
patch sheet_open switch flip←tap_button.tap
patch unlocked not value←sheet_open.on
patch rotation interfaceOrientation landscapeLeft←unlocked.output landscapeRight←unlocked.output
```

## Common mistakes

- Rotating the viewer doesn't turn the interface: that direction is off, or there's no Interface Orientation patch. Add one and turn on each direction you support.
- The prototype starts in portrait although Start In is Upside Down: phones with a camera cutout can't show upside down. Pick another Start In or another device.
- Layers keep their portrait size after the interface turns: sizes don't follow the screen by themselves. Drive them from Device Info's Screen Size.

## Pairs well with

- [Device Info](deviceInfo.md): Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Interface Orientation (`builtin.deviceorientation`)
