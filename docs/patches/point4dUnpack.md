<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Point 4D Unpack

Splits a 4D point into its X, Y, Z, and W numbers so each one can drive something different.

| | |
|---|---|
| Type key | `point4dUnpack` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | vec4 unpack, split xyzw, separate xyzw, get x y z w, break apart, decompose, color channels |

## How it works
Point 4D Unpack takes one 4D point and gives you its four numbers on separate ports. It's the reverse of Point 4D.

- **Value** is the 4D point to split, such as the output of a Transition or Pop Animation set to Point 4D.
- **X**, **Y**, **Z**, and **W** are its first through fourth numbers, available on the same frame.

A color connects here too: red, green, blue, and alpha arrive on X, Y, Z, and W, each from 0 to 1.

## Tips
- Animate four properties as one value, then fan them out from here so they stay in sync.
- For padding or corners, Edges Unpack and Corner Radii Unpack give the same numbers with ports named by side and corner.

## Coming from Origami
This is Origami's Vec4 Unpack. The unnamed input is called Value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `point4d` | `[0, 0, 0, 0]` | The 4D point to split; a color also works and splits into red, green, blue, and alpha. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **X**<br>`x` | `number` | The first number; red from 0 to 1 when Value is a color. |
| **Y**<br>`y` | `number` | The second number; green from 0 to 1 when Value is a color. |
| **Z**<br>`z` | `number` | The third number; blue from 0 to 1 when Value is a color. |
| **W**<br>`w` | `number` | The fourth number; alpha from 0 (transparent) to 1 (opaque) when Value is a color. |

## Examples

### Lift a card when you press it

One Transition animates four numbers from resting to lifted, and Point 4D Unpack sends them to the shadow, the scale, and the corners.

```text
layer card rectangle "Card" @38,300 326x200 color=#FFFFFFFF shadowOpacity←lift.x shadowRadius←lift.y scale←lift.z cornerRadius←lift.w
patch press interaction layer=@card
patch pressed popAnimation number←press.down
patch rise transition<point4d> progress←pressed.output start=0.08,4,1,20 end=0.3,24,1.04,28
patch lift point4dUnpack value←rise.output
```

## Common mistakes

- The numbers from a color look tiny: color channels run from 0 to 1, not 0 to 255. Multiply by 255 when you need the larger scale.
- A Point or Point 3D won't connect: Value needs exactly four numbers. Use the unpack patch that matches the point's size.

## Pairs well with

- [Point 4D](point4d.md): Combines four numbers into one 4D point so you can animate, compare, or pass four values as one.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Vec4 Unpack (`builtin.getvec4`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
