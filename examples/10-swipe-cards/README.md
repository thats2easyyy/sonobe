# Swipe Cards

A deck of dinner ideas. Drag the top card and it follows your finger and tilts, with a SAVE or SKIP badge fading in. Throw it, or drag it far enough, and it flies off that way. Let go early and it springs back. The cards behind move up as the deck shrinks, and Start over brings them all back.

Level 3 · Guides: [06 Gestures](../../docs/guides/06-gestures.md), [07 Loops](../../docs/guides/07-loops.md)

## What you'll learn

- Building a whole deck from one layer: a loop makes three copies, and every patch fed by it runs once per card.
- Per-copy state: each card has its own switch, spring and badges without copying any patches.
- Deciding "was that a throw?" with Swipe, and handing velocity to Spring Animation.
- Making only the top copy touchable by wiring Receives Touches from a comparison.
- Stack depth: the cards behind sit lower and smaller, and spring up into place.

## Build it step by step

1. **One card.** Add a Group named Card (`card`), 330 × 440, anchored at its center at `[201, 440]`, with Clip Contents and a corner radius of 32. Inside go two Ovals for the plate and food, a title and details text, and two badge groups at Opacity 0: `card_like` (SAVE) and `card_nope` (SKIP).
2. **Three copies.** Add a Loop (`cards`) with Count 3, and Loop Builders for the names (`card_titles`), details (`card_metas`), card colors (`card_colors`) and food colors (`card_accents`). Connect them to the title, the details, the card's Color and the food oval's Color. Card now repeats three times. Copy 2 draws last, so it's on top.
3. **Remember thrown cards.** Add a Swipe (`card_swipe`) on Card with Axis Horizontal, Min Distance 120 and Min Velocity 800. Add a Switch (`card_gone`) with Turn On from `card_swipe.swiped`, and Turn Off from Tap Start Over (`tap_start_over`).
4. **Find the top card.** Add a Loop Sum (`cards_gone`) of `card_gone.on`, a Subtract (`top_index`) of 2 minus that sum, and Equals (`is_top`) comparing `cards.index` with `top_index.output`. Connect `is_top.output` to the Card's Receives Touches, so only the top copy can be grabbed.
5. **Where it rests.** Add an Option Switch (`card_side`) that remembers left (Set to 0 from swipedLeft) or right (Set to 1 from swipedRight), an Option Picker (`fly_out_x`: −600, 600), and an If / Else (`resting_x`): the fly-out x once the card is gone, otherwise 0.
6. **Follow and throw.** Add a Gesture (`card_gesture`) on Card, Point Unpacks for its translation (`finger_offset`) and velocity (`finger_speed`), an If / Else (`card_target`) that picks `finger_offset.x` while down and `resting_x.output` otherwise, and a Spring Animation (`card_spring`, Tension 180, Friction 20) with Gesture Active from Down and Gesture Velocity from `finger_speed.x`.
7. **Place and tilt.** Add an Add (`card_x`, 201 + spring), a Multiply (`card_rotation`, spring × 0.05 degrees), and Progress patches for the badges (`like_opacity` from 20 to 120, `nope_opacity` from −20 to −120, both clamped).
8. **The deck.** Add a Subtract (`card_depth`, top index minus index) clamped to 0…2 (`depth_in_deck`), a Pop Animation (`depth_spring`), and Transitions for scale (`card_scale`, 1 → 0.95 per level) and y (`card_y`, 440 → 458 per level). A Point (`card_position`) packs x and y into the Card's Position.

## The patch chain

```text
Cards (loop ×3) ─ index ─▶ Is Top Card ◀── Top Card ◀── Cards Gone (sum) ◀── Card Gone ◀── Swipe Card · swiped
                                  └──▶ Card · Receives Touches                    ▲
                                                                  Tap Start Over ─┘ (turn off)

Swipe Card ─left/right─▶ Swiped Which Way ─▶ Fly-Out X (−600, 600) ─▶ Resting X ◀── Card Gone
Drag Card ─translation─▶ Finger Offset ─x─┐
          ─velocity────▶ Finger Speed ──x─┼─▶ Finger or Resting X ──▶ Card Spring ──┬─▶ Card X ─┐
          ─down─────────────────────────────────────▲ (gesture active) ▲             ├─▶ Card Tilt ─▶ Card · Rotation
                                                                                     └─▶ Save / Skip Badge Opacity
Top Card − index ─▶ Depth in Deck (0…2) ─▶ Depth Spring ─▶ Card Scale · Card Y ──────────────┴─▶ Card Position ─▶ Card · Position
```

| Patch | Type | Its one job |
|---|---|---|
| `cards` | Loop | Indices 0, 1, 2. Every patch downstream runs once per card with its own state. |
| `card_titles`, `card_metas`, `card_colors`, `card_accents` | Loop Builder | Each card's content. |
| `card_swipe` | Swipe | On release, judges whether the drag counts as a throw left or right. |
| `card_gone` | Switch | Per card: thrown or not. |
| `cards_gone`, `top_index`, `is_top` | Loop Sum, Subtract, Equals | Count thrown cards, then work out which copy is on top. |
| `card_side`, `fly_out_x`, `resting_x` | Option Switch, Option Picker, If / Else | Where a card rests: center, or off the side it was thrown. |
| `card_gesture`, `finger_offset`, `finger_speed` | Gesture, Point Unpack | The finger's offset and speed, per card. |
| `card_target`, `card_spring` | If / Else, Spring Animation | Follow the finger exactly, then spring to the resting x starting at the finger's speed. |
| `card_x`, `card_rotation`, `like_opacity`, `nope_opacity` | Add, Multiply, Progress | Position, tilt and badges from the same spring. |
| `card_depth`, `depth_in_deck`, `depth_spring`, `card_scale`, `card_y`, `card_position` | Subtract, Clamp, Pop Animation, Transition, Point | Stack the cards behind and move them up. |
| `tap_start_over` | Interaction | Turns every Card Gone off at once. A plain pulse into a loop reaches every copy. |

## Check it

`test.json` checks the stack at rest (card 1 is 18 points lower at 0.95 scale, and only the top card takes touches). A fast flick left throws card 2 past −350 with a tilt, and card 1 moves up. A slow long drag right saves card 2 at x 801, and a short drag springs back. Finally it throws all three cards, taps Start over, and checks the deck is restored.

```sh
npx vitest run examples/run.test.ts -t 10-swipe-cards
```

To poke at one copy, use a `#n` target in the simulator: `@card#2`, or read `card_gone.on#2`.

## Variations

- **Buttons.** Add ✕ and ♥ buttons that throw the top card. Feed their taps into Card Gone's Turn On through If / Else patches gated by `is_top.output`, and into Swiped Which Way.
- **Up to super like.** Set Swipe's Axis to Any and add a third fly-out direction with a y component.
- **Undo.** Keep a Counter of throws. On undo, turn off the Card Gone whose index equals `top_index.output` + 1.
- **More cards.** Raise the Loop count and add items to each Loop Builder. The graph doesn't change.

## Common mistakes

- **Copying the chain three times.** With loops, one chain handles any number of cards and each copy keeps its own state.
- **Every copy grabbable.** The cards behind peek out below the top card. Without `is_top` into Receives Touches you'd drag the wrong card.
- **Turning Enabled off on the gesture patches to pick the top card.** Enabled depends on Card Gone, which depends on Swipe Card, so the graph becomes a loop. Receives Touches is read at hit testing and adds no cable back.
- **Depth without Clamp.** Thrown cards have a negative depth and would scale up past 1 as they fly off.
