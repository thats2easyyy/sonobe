<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Length

Measures how far a number, point, or vector is from zero, such as how far a drag has traveled in any direction.

| | |
|---|---|
| Type key | `length` |
| Category | [Math](README.md#math) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | magnitude, distance, hypotenuse, vector length, norm, pythagorean theorem, speed, how far |

## How it works
Length measures how far a value is from zero, ignoring direction. For a point, that's the straight-line distance from 0,0, the long side of a right triangle: the point 3,4 has a length of 5.

- **Value** is what you measure. Change the patch's type to measure a Number, Point, Point 3D, Point 4D, or Size. A number's length is the number without its sign, so -7 gives 7.
- **Length** is always a single number, 0 or more.

## Tips
- Wire Gesture's Translation into a Point Length to know how far someone dragged in any direction, then compare it with Greater Than to dismiss past a threshold.
- The length of a velocity is a speed in points per second, handy for spotting a fling.
- For the distance between two points, subtract one from the other first, then measure the result.

## Coming from Origami
Origami's position and vec4 types are called Point and Point 4D.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to measure: a number, or a point or vector whose components are in points or any unit. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Length**<br>`length` | `number` | How far Value is from zero: the square root of the sum of its squared components, always 0 or more. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Shrink a card the farther you drag

Translation is how far your finger has moved since it pressed. Length turns it into one distance in any direction, and the card shrinks by 20% over 400 points.

```text
layer card rectangle "Card" @16,300 358x220 cornerRadius=24 scale←shrink.output
patch pan gesture layer=@card
patch distance length<point> value←pan.translation
patch pulled progress value←distance.length start=0 end=400
patch shrink transition<number> progress←pulled.progress start=1 end=0.8
```

### Swell a ball the faster you drag it

The length of Velocity is speed in points per second, and Pop Animation smooths it so the ball doesn't flicker.

```text
layer ball oval "Ball" @151,380 100x100 scale←swell.output
patch pan gesture layer=@ball
patch speed length<point> value←pan.velocity
patch fast progress value←speed.length start=0 end=2000
patch grow popAnimation number←fast.progress
patch swell transition<number> progress←grow.output start=1 end=1.5
```

## Common mistakes

- Length only reflects the X of the point you wired in: the patch is still on the Number type, which keeps only X. Change its type to Point.
- The distance is measured from the top-left corner instead of between two layers: Length measures from 0,0. Subtract one point from the other first, then measure the difference.

## Pairs well with

- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Velocity](velocity.md): Measures how fast a value is changing, in units per second, by comparing it with the previous frame.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Length (`builtin.math.length`)
