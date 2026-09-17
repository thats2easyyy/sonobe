<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Point 3D Unpack

Splits a 3D point into its X, Y, and Z numbers so you can use or change each one on its own.

| | |
|---|---|
| Type key | `point3dUnpack` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | vec3 unpack, split xyz, separate xyz, get x y z, break apart, decompose, unpack xyz |

## How it works
Point 3D Unpack takes one 3D point and gives you its three numbers on separate ports. It's the reverse of Point 3D.

- **Value** is the 3D point to split, such as a Transition set to Point 3D, or a motion sensor reading.
- **X**, **Y**, and **Z** are its first, second, and third numbers, available on the same frame.

## Tips
- To tilt a layer in 3D, animate one 3D point, split it here, and wire X into Rotation X, Y into Rotation Y, and Z into Rotation.
- To change one part, unpack the point, adjust that number with a math patch, and pack all three again with Point 3D.
- Device Motion's acceleration is a 3D point. Unpack it to react to tilting along one axis.

## Coming from Origami
The unnamed input is called Value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `point3d` | `[0, 0, 0]` | The 3D point to split, such as animated angles or a motion reading. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **X**<br>`x` | `number` | The first number in the point, usually the horizontal part. |
| **Y**<br>`y` | `number` | The second number in the point, usually the vertical part. |
| **Z**<br>`z` | `number` | The third number in the point, usually depth. |

## Examples

### Tilt a card in 3D when you tap it

One Transition animates all three angles together, and Point 3D Unpack sends each angle to its own rotation property.

```text
layer card rectangle "Card" @76,300 250x160 cornerRadius=16 color=#FFFFFFFF rotationX←angles.x rotationY←angles.y rotation←angles.z
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch tilt transition<point3d> progress←pop.output start=0,0,0 end=20,-15,4
patch angles point3dUnpack value←tilt.output
```

## Common mistakes

- The wire from a Point won't connect: a Point has two numbers and this patch expects three. Use Point Unpack for 2D points.
- The card spins flat instead of tipping back: Z drives Rotation, which turns the layer on the screen. Wire X into Rotation X to tip it forward and back, and Y into Rotation Y to turn it side to side.

## Pairs well with

- [Point 3D](point3d.md): Combines three numbers into one 3D point, such as separate X, Y, and Z scale amounts.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Device Motion](deviceMotion.md): Reads how a phone is tilted, moving, and rotating, for tilt effects, parallax, and shake gestures.
- [Smooth Value](smoothValue.md): Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Point 3D Unpack (`builtin.getpoint3d`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
