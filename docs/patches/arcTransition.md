<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Arc Transition

Maps a 0–1 progress onto one smooth curve from Start through Middle to End, for out-and-back or curved motion.

| | |
|---|---|
| Type key | `arcTransition` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | arc, three point transition, out and back, bump, squash and stretch, quadratic interpolation, curved motion path, hop |

## How it works
Arc Transition is Transition with one extra stop. As **Progress** goes 0 → 0.5 → 1, the output goes **Start** → **Middle** → **End** along one smooth curve, with no corner at the middle.

- **Progress** usually comes from an animation of a switch (0 off, 1 on).
- **Start**, **Middle**, and **End** are the values at progress 0, 0.5, and 1. Make Start and End equal for an out-and-back bump, like a scale of 1 → 1.3 → 1 when something is liked.
- **Output** works on numbers, points, sizes, and colors. On a point, the output travels a curved path, so a layer hops instead of sliding in a straight line.

Progress outside 0–1 continues along the same curve.

## Tips
- Middle is where the output is at 0.5, which is the highest point only when Start equals End. With Start 0, Middle 1, End 1, it peaks at 1.125 around 0.75.
- Drive it with Classic Animation set to Linear for an even arc, or Pop Animation for a springy one.

## Coming from Origami
Origami doesn't document the formula. Sonobe uses one smooth curve (at progress 0.25 with 0, 1, 0 the output is 0.75, not 0.5) and adds point, size, and color types.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | `0` | Where along the arc to read, usually 0–1; values outside that continue along the curve. step 0.01. |
| **Start**<br>`start` | `variant` | `0` | The output when Progress is 0. |
| **Middle**<br>`middle` | `variant` | `1` | The value the output passes through when Progress is 0.5. |
| **End**<br>`end` | `variant` | `0` | The output when Progress is 1; set it equal to Start for an out-and-back bump. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The value on the arc for the current Progress. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `point` | `start` | `[0, 0]` |
| `point` | `middle` | `[100, -100]` |
| `point` | `end` | `[200, 0]` |
| `size` | `start` | `[100, 100]` |
| `size` | `middle` | `[140, 140]` |
| `size` | `end` | `[100, 100]` |
| `color` | `start` | `#FFFFFFFF` |
| `color` | `middle` | `#000000FF` |
| `color` | `end` | `#FFFFFFFF` |

## Examples

### Bump a heart when it's liked

Scale goes 1 → 1.3 → 1 as the like animates, in both directions.

```text
layer heart oval "Heart" @171,400 60x60 scale←bump.output
patch tap_heart interaction layer=@heart
patch liked switch flip←tap_heart.tap
patch anim classicAnimation number←liked.on duration=0.4 curve=linear
patch bump arcTransition progress←anim.output start=1 middle=1.3 end=1
```

## Common mistakes

- The layer ends up back where it started: Start and End are equal, which makes an out-and-back bump. Set End to the final value when the change should stick.
- The output overshoots End before settling: with Start and End different, the curve can bulge past End. Move Middle closer to halfway between them, or use Keyframes for exact stops.

## Pairs well with

- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Keyframes](keyframes.md): Maps a progress value through several keyframes, each a stop and a value, like a timeline driven by any number.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Arc Transition (`origami.arctransition`)
- **Also imports:** `builtin.arctransition`
