<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Fluid Spring Animation

Animates toward a target with an Apple-style spring you tune by response time and damping fraction.

| | |
|---|---|
| Type key | `fluidSpringAnimation` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | fluid spring, swiftui spring, ios spring, apple spring, response damping, damping ratio, interruptible spring, throw |

## How it works
Fluid Spring Animation moves its output toward **Number** like a physical spring: it speeds up, slows as it arrives, and may overshoot a little before settling. You tune it with the two numbers iOS engineers use (SwiftUI's `spring(response:dampingFraction:)`), so their specs drop straight in.

- **Number** is the target. When it changes mid-animation, the spring keeps its current speed and heads for the new target, so interruptions never jump.
- **Response** is roughly how long the spring takes to arrive, in seconds. Smaller feels snappier.
- **Damping Fraction** sets the bounce: 1 settles without overshoot, 0.7 bounces a little, 0 never stops.
- **Gesture Active** and **Gesture Velocity** let you throw things. While Gesture Active is on, the output follows Number exactly; when it turns off, the spring starts moving at Gesture Velocity.
- Numbers, points, sizes, and colors all work. Each part springs on its own.

## Tips
- Have a `spring(duration:bounce:)` spec? Use the duration as Response and 1 − bounce as Damping Fraction (for bounce 0 or more).
- Response 0.3–0.5 with Damping Fraction 0.8–1 feels native for most UI.
- Rather pick a feel than tune numbers? Use Spring Preset.

## Coming from Origami
Origami's Fluid Spring Animation (v223) has no published port list. Sonobe's ports follow Spring Converter's Response and Damping Fraction, and the spring math matches Spring Converter exactly.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Number**<br>`number` | `variant` | `0` | The target value; the output springs toward it whenever it changes. |
| **Response**<br>`response` | `number` (duration) | `0.55` | Roughly how long the spring takes to reach the target, in seconds; smaller values feel snappier. At least 0.01, step 0.01. |
| **Damping Fraction**<br>`dampingFraction` | `number` | `0.825` | How much the bounce is damped: 1 settles without overshoot, 0 oscillates forever, and values up to 2 approach more slowly. Range 0 to 1, step 0.01. |
| **Gesture Active**<br>`gestureActive` | `boolean` | `false` | While on, the output follows Number exactly; when it turns off, the spring starts moving at Gesture Velocity. |
| **Gesture Velocity**<br>`gestureVelocity` | `variant` (velocity) | `0` | The gesture's velocity in units per second, handed to the spring on the frame Gesture Active turns off. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The current animated value. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

## Examples

### Tap to grow a card with an iOS-style spring

```text
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch spring fluidSpringAnimation number←toggle.on response=0.4 dampingFraction=0.7
patch grow transition<number> progress←spring.output start=1 end=1.08
```

### Press to shrink a button with no bounce

Damping Fraction 1 gives a quick, settled press like a native button.

```text
layer button rectangle "Button" @101,700 200x56 scale←shrink.output
patch press interaction layer=@button
patch spring fluidSpringAnimation number←press.down response=0.25 dampingFraction=1
patch shrink transition<number> progress←spring.output start=1 end=0.94
```

## Common mistakes

- Nothing bounces: Damping Fraction is 1 or higher, which settles without overshoot. Lower it to 0.6–0.8 for a visible bounce.
- The layer snaps instead of animating: Response is 0 or tiny, so the spring arrives within a frame. Use 0.3–0.6 seconds.
- A thrown layer ignores the fling: Gesture Velocity is read only on the frame Gesture Active turns off. Drive Gesture Active from the gesture's Down and Gesture Velocity from its velocity so they change together.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Spring Preset](springPreset.md): Picks a named spring feel, like Snappy or Bouncy, and outputs matching values for every kind of spring patch.
- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Spring Converter](springConverter.md): Converts an iOS-style spring, set by response and damping fraction, into Spring Animation and Pop Animation settings.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Fluid Spring Animation
