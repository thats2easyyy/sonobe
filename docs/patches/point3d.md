<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Point 3D

Combines three numbers into one 3D point, such as separate X, Y, and Z scale amounts.

| | |
|---|---|
| Type key | `point3d` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | vec3, 3d vector, xyz, pack xyz, combine xyz, make vector, scale xyz, triple |

## How it works
Point 3D packs three separate numbers into one value with three parts. Use it wherever a 3D point is expected, such as a layer's Scale XYZ or a Transition set to Point 3D.

- **X**, **Y**, and **Z** become the first, second, and third numbers. A change shows up on the same frame.
- **Output** is the packed point, in X, Y, Z order.

Drive one part from an animation and type the others in, so one axis moves while the rest stay put.

## Tips
- To change one part of an existing 3D point, split it with Point 3D Unpack, adjust that number, and pack it again here.
- A single number wired into a 3D point input fills all three parts, so uniform values don't need this patch.
- To tilt a layer in 3D, use Rotation X, Rotation Y, and Rotation. Each takes one number.

## Coming from Origami
Origami also uses Point 3D for Position with depth and for three-axis Rotation. In Sonobe, Position is a 2D point with a separate Z Position, and rotation is three number properties: Rotation X, Rotation Y, and Rotation.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **X**<br>`x` | `number` | `0` | The first number, usually a horizontal amount such as X scale or sideways offset. |
| **Y**<br>`y` | `number` | `0` | The second number, usually a vertical amount such as Y scale or up-and-down offset. |
| **Z**<br>`z` | `number` | `0` | The third number, usually depth, such as Z scale or distance toward the viewer. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `point3d` | The three numbers as one 3D point, in X, Y, Z order. |

## Examples

### Squash a button when you press it

X stretches wider while Y squashes shorter, and Z stays at 1. One spring drives both numbers, and Point 3D packs them into Scale XYZ.

```text
layer button rectangle "Button" @101,400 200x56 cornerRadius=28 color=#3478F6FF scaleXYZ←squash.output
patch press interaction layer=@button
patch pressed popAnimation number←press.down bounciness=12 speed=20
patch wide transition<number> progress←pressed.output start=1 end=1.12
patch short transition<number> progress←pressed.output start=1 end=0.88
patch squash point3d x←wide.output y←short.output z=1
```

## Common mistakes

- The layer disappears when you wire Point 3D into Scale XYZ: every part starts at 0, and a scale of 0 shrinks the layer to nothing. Set X, Y, and Z to 1 before you connect it.
- The layer only tips one way when a 3D point drives Rotation: Rotation takes one number, so the wire keeps only X. Split the point with Point 3D Unpack and wire X, Y, and Z into Rotation X, Rotation Y, and Rotation.
- The wire into Position won't connect: Position is a 2D point, and a 3D point has one number too many. Use a Point patch for Position and set depth with Z Position.

## Pairs well with

- [Point 3D Unpack](point3dUnpack.md): Splits a 3D point into its X, Y, and Z numbers so you can use or change each one on its own.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Device Motion](deviceMotion.md): Reads how a phone is tilted, moving, and rotating, for tilt effects, parallax, and shake gestures.
- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Point 3D (`builtin.point3d`)
