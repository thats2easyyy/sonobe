<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Spring Converter

Converts an iOS-style spring, set by response and damping fraction, into Spring Animation and Pop Animation settings.

| | |
|---|---|
| Type key | `springConverter` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | swiftui spring, response to tension, damping fraction, stiffness and damping, tension friction, bounciness speed, spring handoff, spring math |

## How it works
Spring Converter turns the two numbers iOS engineers use to describe a spring into the numbers Sonobe's other spring patches take. It doesn't animate anything; it recalculates every frame.

- **Response** is roughly how long the spring takes to arrive, in seconds.
- **Damping Fraction** runs 0–1: 1 means no bounce, lower values bounce more.
- **Mass**, **Tension**, and **Friction** go into Spring Animation's matching inputs. Tension is the spring's stiffness and Friction its damping.
- **Bounciness** and **Speed** go into Pop Animation for the same feel. Bounciness goes below 0 for springs that don't bounce, and Pop Animation accepts that.

## Tips
- The defaults, Response 0.55 and Damping Fraction 0.825, give Tension 130.5 and Friction 18.85, which are Spring Animation's own defaults.
- Pop Animation can't make very slow springs. Above about 0.67 s of Response, Speed stays at 0 and the Pop version settles a little faster with the same bounce; use Spring Animation or Fluid Spring Animation there.
- Fluid Spring Animation takes Response and Damping Fraction directly, and Spring Preset turns named feels into the same numbers.

## Coming from Origami
The app labels the Bounciness output "Bouciness"; imports accept it. Mass is always 1. Bounciness can go below 0 here, so no-bounce springs keep their feel in Pop Animation.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Response**<br>`response` | `number` (duration) | `0.55` | Roughly how long the spring takes to reach its target, in seconds; smaller values are stiffer. At least 0.01, step 0.01. |
| **Damping Fraction**<br>`dampingFraction` | `number` | `0.825` | How much the bounce is damped: 1 settles without overshoot, 0 oscillates forever, and values up to 2 approach more slowly. Range 0 to 1, step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Mass**<br>`mass` | `number` | The spring's mass for Spring Animation; always 1. |
| **Tension**<br>`tension` | `number` | Stiffness for Spring Animation's Tension: higher is snappier. |
| **Friction**<br>`friction` | `number` | Damping for Spring Animation's Friction: higher bounces less. |
| **Bounciness**<br>`bounciness` | `number` | Bounciness for Pop Animation with the same feel; negative for springs that don't bounce. |
| **Speed**<br>`speed` | `number` | Speed for Pop Animation with the same feel; 0 for springs slower than Pop Animation allows, which then get the closest Pop spring. |

## Examples

### Match an engineer's SwiftUI spring on a card

The spec says spring(response: 0.4, dampingFraction: 0.8); Spring Animation gets the same stiffness and damping.

```text
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch feel springConverter response=0.4 dampingFraction=0.8
patch spring springAnimation number←toggle.on mass←feel.mass tension←feel.tension friction←feel.friction
patch grow transition<number> progress←spring.output start=1 end=1.08
```

### Give Pop Animation an iOS-style bounce

```text
layer badge oval "Badge" @171,400 60x60 scale←bump.output
patch tap_badge interaction layer=@badge
patch toggle switch flip←tap_badge.tap
patch feel springConverter response=0.3 dampingFraction=0.6
patch pop popAnimation number←toggle.on bounciness←feel.bounciness speed←feel.speed
patch bump transition<number> progress←pop.output start=1 end=1.3
```

## Common mistakes

- The spring barely moves or wobbles wildly: Tension and Friction went into Pop Animation's Bounciness and Speed, or the reverse. Tension and Friction feed Spring Animation; Bounciness and Speed feed Pop Animation.
- The Pop Animation version settles faster than the Spring Animation version: Response is above about 0.67 s, softer than Pop Animation can go, so Speed stays at 0 and Pop uses its closest spring. Use Spring Animation or Fluid Spring Animation for slow springs.

## Pairs well with

- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Fluid Spring Animation](fluidSpringAnimation.md): Animates toward a target with an Apple-style spring you tune by response time and damping fraction.
- [Spring Preset](springPreset.md): Picks a named spring feel, like Snappy or Bouncy, and outputs matching values for every kind of spring patch.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Spring Converter (`builtin.springconverter`)
- **Also imports:** `builtin.springConverter`

| Sonobe port | Origami label |
|---|---|
| `bounciness` | Bouciness |
