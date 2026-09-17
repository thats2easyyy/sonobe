# Tap to Grow

Tap a photo card and it springs bigger. Tap again and it springs back. It takes four patches, and those four jobs sit behind most interactions you'll ever build: **I**nteraction, **S**witch, **A**nimation, **T**ransition.

Level 0 · Guides: [01 Your first prototype](../../docs/guides/01-first-prototype.md), [02 ISAT](../../docs/guides/02-isat.md)

## What you'll learn

- How a tap becomes a pulse, and why a Switch has to remember it.
- Why the animated value runs from 0 to 1, and only a Transition turns it into real units.
- How one spring can drive several properties so they all arrive at the same moment.
- How to judge the feel from a trace instead of squinting at the viewer.

## Build it step by step

1. **Draw the card.** Add a Group named Card, 338 × 440, with Anchor `[0.5, 0.5]` at Position `[201, 470]`, Corner Radius 32 and Clip Contents on. Inside it, a Gradient fills the card, three Ovals make a sun and two hills, and two Text layers hold the title. The text layers have Receives Touches off, so a tap anywhere on the card reaches the Card group.
2. **Listen for taps.** Add an Interaction patch and set its Layer to Card. This is `tap_card`. Its Tap output pulses (it's true for one frame) when a press lifts on the card without sliding.
3. **Remember the state.** Add a Switch named Card Zoomed (`card_zoomed`) and connect `tap_card.tap` to Flip. Every tap flips it on or off, and it stays that way.
4. **Animate.** Add a Pop Animation named Zoom Spring (`zoom_spring`) and connect `card_zoomed.on` to Number. Set Bounciness to 6 and Speed to 12. Its output glides from 0 to 1 and back, overshooting a touch.
5. **Turn 0…1 into a scale.** Add a Transition named Card Scale (`card_scale`) with Start 1 and End 1.12. Connect `zoom_spring.output` to Progress and `card_scale.output` to the Card's Scale.
6. **Lift the shadow in step.** Add two more Transitions fed by the same spring: `card_shadow_radius` from 18 to 44 into Shadow Radius, and `card_shadow_opacity` from 0.08 to 0.26 into Shadow Opacity.
7. **Try it.** Tap the card. Now tap it again while it's still bouncing, and watch it turn around smoothly instead of starting over.

## The patch chain

```text
Tap Card ──tap──▶ Card Zoomed ──on──▶ Zoom Spring ──output──┬──▶ Card Scale       1 → 1.12    ──▶ Card · Scale
(Interaction)     (Switch)            (Pop Animation)        ├──▶ Shadow Radius   18 → 44      ──▶ Card · Shadow Radius
                                                             └──▶ Shadow Opacity  0.08 → 0.26  ──▶ Card · Shadow Opacity
```

| Patch | Type | Its one job |
|---|---|---|
| `tap_card` | Interaction | Fires a pulse when a press lifts on the card after moving less than 10 points. |
| `card_zoomed` | Switch | Remembers "zoomed or not". A pulse can't remember anything, because it's gone one frame later. |
| `zoom_spring` | Pop Animation | Moves toward 0 or 1 with a spring. Interrupted mid-flight, it keeps its speed and turns around. |
| `card_scale` | Transition | Maps progress 0 to Start (1) and 1 to End (1.12). The spring's small overshoot past 1 carries through. |
| `card_shadow_radius`, `card_shadow_opacity` | Transition | Same progress, different units, so the shadow lifts exactly as the card grows. |

Why is there an Animation in the middle? A Switch changes in a single frame. Wire it straight into the Transition and the card jumps instead of moving.

## Check it

`test.json` taps the card in a deterministic simulation and checks the traced values. The card has to end at 1.12, overshoot a little on the way, settle within about a second, and spring back to 1 after a second tap. Run the checks with:

```sh
npx vitest run examples/run.test.ts -t 01-tap-to-grow
```

To look at the numbers yourself, save `[{ "kind": "tap", "target": "@card", "atMs": 100 }]` as `tap.json` and trace the spring with the CLI:

```sh
node packages/cli/src/main.ts sim examples/01-tap-to-grow --events tap.json --trace @card.scale,zoom_spring.output --duration 1200
```

The summary lists start, end, overshoot, and when the value settled.

## Variations

- **Snappier.** Set Bounciness to 0 and Speed to 18. The card arrives in about 300 ms with no wobble.
- **Playful.** Bounciness 12 overshoots by roughly 10% and wobbles twice.
- **Press feedback.** Put the card inside another Group. Feed `tap_card.down` into a second Pop Animation (Bounciness 0, Speed 20) and a Transition from 1 to 0.97, into that Group's Scale. The card dips while your finger is down and zooms on release.
- **Timed instead of springy.** Swap Pop Animation for Classic Animation (0.3 s, Cubic Out) and tap rapidly. Every tap restarts the full 0.3 seconds, which feels sluggish for things people touch.
- **More properties, one feel.** Add a Transition from 32 to 20 into Corner Radius, or a color Transition into the hint text. They all land together because they share one spring.

## Common mistakes

- Using `tap_card.down` for a toggle. Down is only true while the finger is on the glass, so the card shrinks back the moment you let go.
- Typing the change (0.12) into End instead of the final value (1.12).
- Putting text on top of the card with Receives Touches on and listening to a layer behind it. Touches go to the front-most layer and bubble up to its parents, never to layers behind.
