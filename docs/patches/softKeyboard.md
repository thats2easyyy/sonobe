<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Soft Keyboard

Reports the on-screen keyboard's height and slide progress, so text inputs and buttons can ride above it.

| | |
|---|---|
| Type key | `softKeyboard` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | keyboard info, keyboard height, on-screen keyboard, virtual keyboard, keyboard avoidance, composer bar |

## How it works
Soft Keyboard reports the on-screen keyboard that slides up while someone types into a Text Field on a phone or tablet.

- **Visible Height** is how many points the keyboard covers right now. It animates as the keyboard slides.
- **Height** is the keyboard's full height for the current device and orientation, even while it's hidden.
- **Progress** runs from 0 (hidden) to 1 (fully shown) along with the slide.
- **Visible** is true while the keyboard is up or on its way up.
- **Keyboard Type** picks which keyboard to measure. Auto follows the Text Field being edited.

The desktop viewer simulates the keyboard for phone and tablet devices. On a real phone, the web player measures the real keyboard. Computers have no on-screen keyboard, so everything stays 0.

## Tips
- Keep a message bar above the keyboard by moving it up by Visible Height.
- Fade or shrink content with Progress so it moves in sync with the keyboard.

## Coming from Origami
Keyboard Info is called Soft Keyboard. Visible and Visible Height are new, and Keyboard Type adds Auto.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Keyboard Type**<br>`keyboardType` | `enum` | `auto` | Which keyboard to measure; Auto follows the Text Field being edited, and number and phone pads are shorter on phones. |
| **Appearance**<br>`appearance` | `enum` · advanced | `default` | Light or dark styling for the simulated keyboard the desktop viewer draws; doesn't change any measurement. |

**Keyboard Type options**

- **Auto** (`auto`): Follows the Keyboard setting of the Text Field being edited.
- **Default** (`default`): The standard letter keyboard.
- **Number** (`number`): A number pad.
- **Email** (`email`): Letters with @ and . keys.
- **URL** (`url`): Letters with / and .com keys.
- **Phone** (`phone`): A phone dial pad.

**Appearance options**

- **Default** (`default`): Follows the system appearance.
- **Light** (`light`)
- **Dark** (`dark`)

## Outputs

| Output | Type | Description |
|---|---|---|
| **Visible Height**<br>`visibleHeight` | `number` (distance) | How many points of the screen the keyboard covers right now, animating as it slides. |
| **Height**<br>`height` | `number` (distance) | The keyboard's full height in points for this device and orientation, even while hidden. |
| **Progress**<br>`progress` | `number` (progress) | 0 while hidden, 1 when fully shown, easing between as the keyboard slides. |
| **Visible**<br>`visible` | `boolean` | True while the keyboard is shown or sliding up. |

## Examples

### Keep a message bar above the keyboard

Multiplying by [0, -1] turns the covered height into an upward offset.

```text
layer composer group "Composer" @0,818 402x56 position←composer_position.output
  layer message_field textField "Message Field" @16,6 370x44
patch keyboard_info softKeyboard
patch rise multiply<point>[2] value1←keyboard_info.visibleHeight value2=[0,-1]
patch composer_position add<point>[2] value1=[0,818] value2←rise.output
```

### Dim the feed while typing

```text
layer feed rectangle "Feed" @0,0 402x874 opacity←dim.output
patch keyboard_info softKeyboard
patch dim transition<number> progress←keyboard_info.progress start=1 end=0.4
```

## Common mistakes

- The bar jumps instead of sliding: it follows Visible, which switches instantly. Use Visible Height or Progress, which animate.
- Everything stays 0 in the desktop viewer: the device is a computer, which has no on-screen keyboard. Pick a phone or tablet device and tap into a Text Field.
- The bar floats too high on iPhones: Visible Height already includes the home-indicator area. Don't add the bottom Safe Area on top of it.

## Pairs well with

- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Device Info](deviceInfo.md): Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.

## Availability

**Web-limited.** Browsers don't report the on-screen keyboard directly. The phone web player estimates its height from the VisualViewport API and approximates the slide animation; the desktop viewer simulates a keyboard for phone and tablet devices.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Keyboard Info (`builtin.keyboard.info`)

| Sonobe port | Origami label |
|---|---|
| `keyboardType` | Type |
| `appearance` | Appearence |
