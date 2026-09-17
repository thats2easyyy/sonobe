<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Bouncy Converter

Converts Pop Animation's bounciness and speed into the tension and friction that Spring Animation uses.

| | |
|---|---|
| Type key | `bouncyConverter` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | pop converter, bounciness to tension, pop to spring, tension friction, stiffness and damping, spring handoff, rebound spring config |

## How it works
Bouncy Converter translates a Pop Animation feel into physical spring numbers. It doesn't animate anything; it recalculates every frame.

- **Bounciness** (typically 0–20): higher bounces more; 0 settles with almost no overshoot.
- **Speed** (typically 0–20): higher is stiffer and faster.
- **Tension** and **Friction** are the spring's stiffness and damping. Wire them into Spring Animation's Tension and Friction, leave Mass at 1, and the motion matches Pop Animation, with gesture velocity handoff added.

## Tips
- Pop Animation's defaults, Bounciness 5 and Speed 10, give Tension 299.6 and Friction 27.0.
- Engineers whose spring API takes stiffness and damping with mass 1 can use Tension and Friction as they are.
- Going the other way? Spring Converter outputs Bounciness and Speed from an iOS-style spring.

## Coming from Origami
Origami's docs don't say which scale Tension and Friction use. Sonobe outputs physical stiffness and damping, which is what its Spring Animation takes.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Bounciness**<br>`bounciness` | `number` | `5` | How much Pop Animation bounces, typically 0–20; 0 settles with almost no overshoot. Range 0 to 20, step 0.5. |
| **Speed**<br>`speed` | `number` | `10` | How fast and stiff Pop Animation feels, typically 0–20; values below 0 act like 0. Range 0 to 20, step 0.5. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Tension**<br>`tension` | `number` | Stiffness for Spring Animation's Tension, assuming Mass 1. |
| **Friction**<br>`friction` | `number` | Damping for Spring Animation's Friction, assuming Mass 1. |

## Examples

### Reuse a Pop Animation feel in Spring Animation

Spring Animation gets the exact curve of Pop Animation with Bounciness 8 and Speed 12.

```text
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch feel bouncyConverter bounciness=8 speed=12
patch spring springAnimation number←toggle.on tension←feel.tension friction←feel.friction
patch grow transition<number> progress←spring.output start=1 end=1.1
```

## Common mistakes

- Spring Animation doesn't match the Pop Animation it came from: Spring Animation's Mass isn't 1. These numbers assume mass 1, so leave Mass at its default.
- Negative Speed doesn't make the spring any slower: Pop-style springs can't go below Speed 0. For slower springs, use Spring Converter with a longer Response.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Spring Converter](springConverter.md): Converts an iOS-style spring, set by response and damping fraction, into Spring Animation and Pop Animation settings.
- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Bouncy Converter (`builtin.bouncyconverter`)
