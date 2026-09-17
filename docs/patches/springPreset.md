<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Spring Preset

Picks a named spring feel, like Snappy or Bouncy, and outputs matching values for every kind of spring patch.

| | |
|---|---|
| Type key | `springPreset` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | spring feel, motion preset, easing preset, snappy, bouncy spring, duration and bounce, swiftui spring, spring values, stiffness damping |

## How it works
Spring Preset turns a feel into numbers, so you choose how motion should feel instead of tuning physics. It outputs the same spring in every format Sonobe's spring patches use.

| Preset | Feel | Duration | Bounce |
|---|---|---|---|
| Smooth | Settles calmly, no overshoot | 0.5 s | 0 |
| Snappy | Quick, a hint of overshoot | 0.3 s | 0.15 |
| Bouncy | Playful wobble | 0.5 s | 0.3 |
| Gentle | Slow and soft | 0.75 s | 0.1 |
| Custom | Your own Duration and Bounce | | |

- **Duration** is roughly how long the spring takes to get there, in seconds. **Bounce** runs from 0 (no overshoot) toward 1 (bouncing forever); negative values feel heavier and slower to settle. Both apply only when Preset is Custom.
- **Mass**, **Tension**, and **Friction** go into Spring Animation.
- **Bounciness** and **Speed** go into Pop Animation.
- **Response** and **Damping Fraction** go into Fluid Spring Animation, and match SwiftUI's `spring(response:dampingFraction:)`.

## Tips
- Start with Smooth for sheets and screens, Snappy for toggles and taps, and Bouncy for delight like likes and badges.
- Bounciness can be negative for springs with no bounce. Pop Animation accepts that, so wire the outputs straight in.
- Custom's Duration and Bounce match SwiftUI's `spring(duration:bounce:)`, so developers can copy them.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Preset**<br>`preset` | `enum` | `smooth` | The feel to output. Custom uses Duration and Bounce instead. |
| **Duration**<br>`duration` | `number` (duration) | `0.5` | Roughly how long the spring takes to arrive, in seconds. Used only when Preset is Custom. At least 0.01, step 0.05. |
| **Bounce**<br>`bounce` | `number` | `0` | How much it overshoots: 0 means none, values toward 1 bounce more, and negative values settle more slowly. Used only when Preset is Custom. Range -1 to 1, step 0.05. |

**Preset options**

- **Smooth** (`smooth`): Settles calmly with no overshoot. A safe default for screens, sheets, and fades.
- **Snappy** (`snappy`): Quick with a hint of overshoot. Good for toggles, taps, and small UI.
- **Bouncy** (`bouncy`): Playful overshoot that wobbles into place. Good for likes, badges, and delight.
- **Gentle** (`gentle`): Slow and soft with a little give. Good for large surfaces and ambient motion.
- **Custom** (`custom`): Uses your own Duration and Bounce.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Mass**<br>`mass` | `number` | The spring's mass for Spring Animation. Always 1. |
| **Tension**<br>`tension` | `number` | Stiffness for Spring Animation's Tension, in raw physics units. |
| **Friction**<br>`friction` | `number` | Damping for Spring Animation's Friction, in raw physics units. |
| **Bounciness**<br>`bounciness` | `number` | Bounciness for Pop Animation. Can be negative for springs with no bounce. |
| **Speed**<br>`speed` | `number` | Speed for Pop Animation. For slow feels like Gentle it's the closest spring Pop can make. |
| **Response**<br>`response` | `number` (duration) | Response in seconds for Fluid Spring Animation (SwiftUI response). |
| **Damping Fraction**<br>`dampingFraction` | `number` | Damping fraction for Fluid Spring Animation: 1 means no bounce, lower values bounce more. |

## Examples

### Give a like button a Bouncy pop

```text
layer heart shape "Heart" @171,400 60x60 scale←grow.output
patch tap_heart interaction layer=@heart
patch liked switch flip←tap_heart.tap
patch feel springPreset preset=bouncy
patch pop popAnimation number←liked.on bounciness←feel.bounciness speed←feel.speed
patch grow transition<number> progress←pop.output start=1 end=1.2
```

### Open a sheet with a custom duration and bounce

```text
layer sheet rectangle "Sheet" @0,874 402x600 position←rise.output
layer open_button rectangle "Open" @111,700 180x56
patch tap_open interaction layer=@open_button
patch open switch flip←tap_open.tap
patch feel springPreset preset=custom duration=0.45 bounce=0.1
patch spring springAnimation number←open.on mass←feel.mass tension←feel.tension friction←feel.friction
patch rise transition<point> progress←spring.output start=[0,874] end=[0,274]
```

## Common mistakes

- Changing Duration or Bounce does nothing: they only apply when Preset is Custom. Switch Preset to Custom first.
- Only part of the spring changes: Tension is wired but Friction and Mass aren't, so Spring Animation mixes the preset with its own defaults. Wire all three outputs.

## Pairs well with

- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Fluid Spring Animation](fluidSpringAnimation.md): Animates toward a target with an Apple-style spring you tune by response time and damping fraction.
- [Spring Converter](springConverter.md): Converts an iOS-style spring, set by response and damping fraction, into Spring Animation and Pop Animation settings.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
