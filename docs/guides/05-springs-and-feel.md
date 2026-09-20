# Springs and feel

Level 2 · Next: [06 Gestures](06-gestures.md)

## What you'll be able to do

- Pick a spring by feel in a few seconds.
- Read and convert the four ways people write spring numbers.
- Tune toward a goal like "settles under 400 ms and barely bounces".
- Hand exact values to engineers working in SwiftUI, Android, CSS or motion.dev.
- Carry a finger's speed into the animation that takes over when it lets go.

## What a spring is

A spring pulls toward its target. The farther away it is, the harder it pulls, and friction slows it down. Only two things really matter: how stiff the spring is, which sets its speed, and how strongly it resists bouncing. Every spring setting you'll meet is a different way of saying those two things.

Here's Pop Animation with its default settings, jumping from 0 to 1:

```
value
 1.02 ┤             ╭──╮
 1.00 ┤           ╭─╯  ╰────────────   settled
      │          ╱
 0.59 ┤      ╭──╯
      │    ╱
 0.00 ┼───╯
      └──┬───────┬───────┬───────┬───────┬──▶ time
         0     0.1 s   0.2 s   0.3 s   0.5 s
```

It covers most of the distance in the first 0.2 seconds after it starts moving, runs about 2% past the target, and comes to rest at about 0.48 seconds.

## Start with a preset

The inspector offers four presets: Smooth, Snappy, Bouncy and Gentle. Start with the one closest to the feel you want, then adjust.

| Preset | Feels | Use it for | Response | Damping fraction | Overshoot | Settles in |
|---|---|---|---|---|---|---|
| Smooth | Calm, no bounce | Sheets, page transitions, anything large | 0.5 s | 1.0 | 0% | about 0.75 s |
| Snappy | Quick, with at most a hint of wobble | Toggles, buttons, menus | 0.3 s | 0.85 | under 1% | about 0.43 s |
| Bouncy | Playful, visibly overshoots | Likes, stickers, celebrations | 0.5 s | 0.7 | about 5% | about 0.82 s |
| Gentle | Slow and soft | Ambient motion, onboarding illustrations, big hero elements | 0.75 s | 0.9 | under 1% | about 1.00 s |

"Settles in" means the time until the value stays within 0.1% of its target, counted from when the spring starts moving, at 60 frames per second. The inspector shows each preset with a live curve.

Two other tools report slightly different times for the same spring, and both are right by their own rules:

- A trace after a tap, like `sonobe sim` or Claude's `sim_trace`, counts from the tap. The spring starts moving a few frames later, so Pop Animation's default spring reads 517 ms there instead of 0.48 s.
- The inspector's curve label waits until both the value and its speed have come to rest, which is stricter. It shows 0.57 s for the default spring.

## Four ways to say the same spring

You'll meet spring numbers in four forms. They all describe the same physics.

### 1. Bounciness and Speed

This is what Pop Animation uses. It comes from Facebook's POP and Rebound animation libraries. Bounciness 0 means no bounce, and higher values wobble more. Higher Speed is faster. The defaults are 5 and 10. These numbers are friendly to tweak, but they aren't linear, and modern platform APIs don't accept them.

### 2. Tension and Friction

This is Rebound's scale, often called Origami units. You'll see it in older Origami files and in Rebound code for Android and the web. It converts to physical stiffness and damping with a fixed formula.

### 3. Mass, Stiffness and Damping

This is the physics textbook version. It's used by SwiftUI's interpolating springs, Jetpack Compose, motion.dev and most animation libraries. Mass is almost always 1.

### 4. Response and Damping Fraction

This is Apple's perceptual version. Response is roughly how long the spring takes to get there, in seconds. Damping fraction 0 bounces forever, and 1 doesn't bounce at all. SwiftUI also offers Duration and Bounce, where duration is the response and bounce is 1 minus the damping fraction.

### One spring, four languages

Here's Pop Animation's default spring written every way:

| Language | Numbers |
|---|---|
| Bounciness / Speed | 5 / 10 |
| Tension / Friction (Origami units) | 59.2 / 8.68 |
| Mass / Stiffness / Damping | 1 / 299.6 / 27.05 |
| Response / Damping Fraction | 0.36 s / 0.78 |
| SwiftUI Duration / Bounce | 0.36 s / 0.22 |

The spring converter in the inspector shows all of these at once, so you never have to do the math by hand. For the curious, here are the formulas (with mass 1):

```
stiffness        = (2π ÷ response)²
damping          = 4π × damping fraction ÷ response
damping fraction = damping ÷ (2 × √stiffness)

stiffness        = (tension − 30) × 3.62 + 194
damping          = (friction − 8) × 3 + 25
```

Bounciness and Speed become tension and friction through a curve fit taken from Rebound. It isn't something to do in your head, which is what the converter is for.

## Tuning by feel

There are two knobs, and each answers one question:

- "Is it too slow or too fast?" Change Speed, or the response. Leave the bounce alone.
- "Is it too wobbly or too dead?" Change Bounciness, or the damping fraction. Leave the speed alone.

Here's what the knobs do, measured:

| Bounciness / Speed | Response | Damping fraction | Overshoot | Settles in |
|---|---|---|---|---|
| 0 / 10 | 0.36 s | 0.995 | 0% | 0.53 s |
| 5 / 10 | 0.36 s | 0.78 | 2% | 0.48 s |
| 10 / 10 | 0.36 s | 0.59 | 10% | 0.60 s |
| 5 / 20 | 0.28 s | 0.78 | 2% | 0.37 s |

Two things stand out. Changing Bounciness leaves the response alone, but a bouncier spring takes longer to settle. And the spring with no bounce at all settles more slowly than the one with a little. A spring with zero bounce creeps in at the end. A hint of overshoot often feels faster, even though it travels farther.

A process that works:

1. Pick the preset closest to the feel.
2. Watch it at real size, on a real device if you can. Scan the Viewer's QR code to open the prototype on your phone. A trackpad doesn't feel like a thumb. To watch it again from the start, tap the phone with three fingers and choose Restart Prototype, or press ⌘R in Sonobe, which restarts the phone too.
3. Change one knob at a time. Right-click Bounciness or Speed in Properties and choose Make Knob to get a slider you can drag while the spring runs, and a preset to flip back to ([guide 13](13-knobs-and-presets.md)).
4. Test interruptions. Tap rapidly, or reverse direction mid-flight. Pop Animation keeps its speed when its target changes, so it should turn around smoothly.
5. Test at the real distance. The same spring feels different on a 40-point toggle and a 700-point sheet. Big distances usually want less bounce.

My rule of thumb is that bounce is seasoning. Large surfaces, and anything you drag, want a damping fraction between 0.9 and 1. Small, celebratory things can take 0.6 to 0.7.

## Classic Animation still has a place

Not everything should be a spring. Use Classic Animation for fades, progress bars, loaders and timed sequences, or when a spec says "200 ms ease out". It takes exactly its Duration, with a curve like Cubic Out. When its target changes, it starts over from where it is and takes the full Duration again, which is why it's a poor fit for things people touch.

## Handoff to engineers

Give engineers the physics numbers, not Bounciness and Speed, unless they're using Rebound. These examples are all Pop Animation's default spring (Bounciness 5, Speed 10). Paste in your own numbers from the converter.

SwiftUI:

```swift
withAnimation(.spring(duration: 0.36, bounce: 0.22)) {
    isExpanded.toggle()
}

// The same spring as exact physics
withAnimation(.interpolatingSpring(mass: 1, stiffness: 299.6, damping: 27.05)) {
    isExpanded.toggle()
}
```

Jetpack Compose:

```kotlin
val scale by animateFloatAsState(
    targetValue = if (expanded) 1.08f else 1f,
    animationSpec = spring(dampingRatio = 0.78f, stiffness = 299.6f),
)
```

motion.dev:

```js
import { animate } from "motion";

animate(card, { scale: 1.08 }, { type: "spring", stiffness: 299.6, damping: 27.05, mass: 1 });
```

CSS has no built-in spring. The practical route is the `linear()` easing function, which draws a curve through sampled points over the spring's settle time. This version uses only 11 samples, so it's coarse. Real handoff code uses more:

```css
.card {
  transition: transform 480ms
    linear(0, 0.222 10%, 0.567 20%, 0.819 30%, 0.954 40%, 1.008 50%, 1.020 60%, 1.016 70%, 1.009 80%, 1.004 90%, 1);
}
```

Rebound, on older Android and web code:

```java
SpringConfig config = SpringConfig.fromBouncinessAndSpeed(5, 10);
```

Along with the numbers, tell engineers what triggers the animation, whether it can be interrupted, and whether it should start from the finger's speed.

## Velocity handoff from gestures

When you flick a sheet, the animation that takes over should start at the finger's speed. If it starts from zero, there's a visible stall right at release, and the sheet feels like it slipped out of your hand.

Spring Animation handles this with two inputs. While Gesture Active is on, the spring sits on its target, so you can feed it the finger's position. When Gesture Active turns off, the spring starts moving at whatever speed is in Gesture Velocity.

```
Gesture (Sheet) ── Down ───────────────────────────────▶ Spring Animation . Gesture Active
                ── Velocity ─▶ Point Unpack . Y ───────▶ Spring Animation . Gesture Velocity

finger's Y while down, snap target once released ──────▶ Spring Animation . Number
                                                                   │
                                                                   ▼
                                                           Sheet . Position Y
```

Gesture's Velocity is in points per second on each axis, and it holds its value on the release frame, which is the frame the spring reads. The Bottom Sheet recipe in `examples/08-bottom-sheet` builds this sheet step by step, and guide 06 builds a snapping picture-in-picture the same way.

Pop Animation does something related on its own. When its target changes mid-flight, it keeps its current speed.

When you hand off a flick to engineers, check the velocity units. Some APIs want absolute speed, like Compose's `initialVelocity` or motion.dev's `velocity`, both in value units per second. Others want speed relative to the distance still to travel. UIKit's `initialSpringVelocity` is the classic example, where 1 means "the whole distance in one second". A flick at 1,800 points per second with 450 points left to travel is a relative velocity of 4.

## Try it

1. Put four squares side by side, all driven by the same Switch, each with a different preset. Tap and compare.
2. Tune a toggle to settle in under 300 ms with no visible bounce. Hint: raise Speed, keep Bounciness near 0, and check the settle time under the spring's curve in the inspector.
3. Use the converter to turn Bounciness 10, Speed 6 into SwiftUI's duration and bounce. The answer is about 0.43 seconds and 0.41.
4. Give a like button the Bouncy preset and a full-screen card expansion the Smooth preset. Then swap them, and notice why each one belongs where it was.
5. Build a sheet you can flick. Try it with Gesture Velocity connected, then without.

## Common mistakes

- Handing Bounciness and Speed to an engineer working in SwiftUI or Compose. Send response and damping fraction, or stiffness and damping.
- Turning both knobs at once. You'll lose track of which one fixed it.
- Judging feel on a trackpad, or in a viewer shrunk to half size.
- Big bouncy sheets. Overshoot on a large surface reads as sloppy, not playful.
- Mixing velocity units between points per second and relative velocity.
- Using Classic Animation for something the user drags. Every retarget restarts the clock and throws away the finger's speed.
