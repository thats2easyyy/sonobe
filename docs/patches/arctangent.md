<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Arctangent

Measures the direction of an X and Y offset as an angle in degrees, so a layer can point toward a finger or another layer.

| | |
|---|---|
| Type key | `arctangent` |
| Category | [Math](README.md#math) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | atan, atan2, angle, direction, point at, look at, heading, inverse tangent, trigonometry |

## How it works
Give Arctangent how far something is across (**X**) and down (**Y**) from a center, and it tells you which direction that is, in degrees.

- 0° points right, 90° points down, 180° points left, and -90° points up. The output runs from just above -180 up to 180.
- Y grows downward on screen, so angles grow clockwise, the same way layer Rotation turns. Wire the output into Rotation and a layer drawn pointing right will face that direction.
- **Y** comes first and **X** second, like `atan2(y, x)` in code. Either can be negative, and X can be 0.

## Tips
- To aim at a finger, subtract the layer's center from the touch position first, then feed in the difference's Y and X.
- For an angle from 0 to 360, add 360 and take Modulo 360.
- For a dial's progress from 0 to 1, add 180 and divide by 360. It starts on the left and increases clockwise.

## Coming from Origami
The ports, their order, and the degree unit match. The exact output range is Sonobe's documented choice; Origami's docs don't state it.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Y**<br>`y` | `number` | `0` | How far down the target is from the center, in points or any unit; negative means up. |
| **X**<br>`x` | `number` | `1` | How far right the target is from the center, in the same unit as Y; negative means left. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Angle**<br>`angle` | `number` (angle) | The direction in degrees, from just above -180 to 180: 0 is right, 90 is down, 180 is left, and -90 is up. |

## Examples

### Point an arrow at your finger

The offset from the arrow's center (195, 437) to the touch becomes an angle, and Rotation turns the arrow, drawn pointing right, to face it.

```text
layer arrow rectangle "Arrow" @155,433 80x8 cornerRadius=4 rotation←aim.angle
patch touch interaction
patch touch_xy pointUnpack value←touch.position
patch offset mathExpression expression="dx = px - 195; dy = py - 437" px←touch_xy.x py←touch_xy.y
patch aim arctangent y←offset.dy x←offset.dx
```

### Aim a needle down and to the left

A fixed offset of 60 right-to-left and 60 down gives 135°.

```text
layer needle rectangle "Needle" @155,433 80x8 cornerRadius=4 rotation←aim.angle
patch aim arctangent y=60 x=-60
```

## Common mistakes

- The layer points a quarter turn off: 0° means pointing right. Draw the artwork pointing right, or add 90 when it's drawn pointing up.
- A spring on the angle spins the layer almost all the way around: the output jumps between 180 and -180 when the direction crosses the left side. Take the short way by adding or subtracting 360, or animate the offset instead of the angle.
- The angle barely changes as your finger moves: the touch position is measured from the prototype's top-left, not from the layer. Subtract the layer's center from the position before splitting it into X and Y.

## Pairs well with

- [Cosine](cosine.md): Turns an angle in degrees into a smooth wave from -1 to 1 that starts at its peak, for swinging and circular motion.
- [Sine](sine.md): Turns an angle in degrees into a smooth wave from -1 to 1, for bobbing, breathing, and circular motion.
- [Point Unpack](pointUnpack.md): Splits a 2D point, such as a touch position, into separate X and Y numbers.
- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Arctangent (`builtin.math.atan`)
