<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Swipe

Pulses when a press on a layer ends in a swipe, with separate pulses for left, right, up, and down.

| | |
|---|---|
| Type key | `swipe` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | flick, fling, throw, swipe left, swipe right, swipe up, swipe down, swipe gesture, card swipe, predicted end |

## How it works
Swipe judges each press when the finger lifts. If the pointer traveled far enough, or was moving fast enough at release, the press counts as a swipe. **Swiped** fires along with one direction pulse.

- **Axis** chooses which directions count. Any Direction uses the direction the pointer is heading most. Horizontal and Vertical ignore the other axis.
- **Min Distance** is how far the press must travel, in points.
- **Min Velocity** is how fast a short flick must be moving at release, in points per second. A fast throw decides the direction, even if the finger first dragged the other way.
- **Lookahead** adds that many seconds of release speed to the travel. At 0.2, a 60-point flick at 600 points per second counts as 180 points.
- **Projected** is that estimate, Translation + Velocity × Lookahead, live while the finger is down.
- A press that moves less than 10 points is a tap, never a swipe.

The press has to start on the layer, but it can end anywhere.

## Tips
- Pair Swipe with Gesture: Gesture moves the card with the finger, and Swipe decides whether it leaves.
- Wire Swiped Left into a Counter's Increase and Swiped Right into Decrease to page through items.
- Lookahead 0.1–0.3 suits cards; Snap's Normal and Fast decelerations match 0.5 and 0.1. To judge by the projection alone, raise Min Velocity to 10000.

## Coming from Origami
Origami has no Swipe patch. Two-state swipes there use Pop Switch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The layer a swipe must start on. Leave empty to accept swipes that start anywhere on the screen. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When off, releases are ignored and no swipe pulses fire. |
| **Axis**<br>`axis` | `enum` | `any` | Which directions count as swipes. |
| **Min Distance**<br>`minDistance` | `number` (distance) | `100` | How far the press must travel along the axis to count, in points, including Lookahead's projection. At least 0, step 1. |
| **Min Velocity**<br>`minVelocity` | `number` (velocity) | `500` | How fast a short flick must be moving along the axis at release to count, in points per second. At least 0, step 10. |
| **Lookahead**<br>`lookahead` | `number` (duration) | `0` | Seconds of release velocity added to the travel before it's compared with Min Distance, so a quick short flick can count. 0 uses only where the finger lifted. At least 0, step 0.05. |

**Axis options**

- **Any Direction** (`any`): Judges along whichever axis the press is heading most: its travel, plus Lookahead's projection.
- **Horizontal** (`horizontal`): Only left and right count; vertical movement is ignored.
- **Vertical** (`vertical`): Only up and down count; horizontal movement is ignored.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Swiped**<br>`swiped` | `pulse` | Pulses when a press ends as a swipe in any direction that counts. |
| **Swiped Left**<br>`swipedLeft` | `pulse` | Pulses when a press ends as a swipe to the left. |
| **Swiped Right**<br>`swipedRight` | `pulse` | Pulses when a press ends as a swipe to the right. |
| **Swiped Up**<br>`swipedUp` | `pulse` | Pulses when a press ends as a swipe upward. |
| **Swiped Down**<br>`swipedDown` | `pulse` | Pulses when a press ends as a swipe downward. |
| **Projected**<br>`projected` | `point` (distance) · advanced | Where the press is heading, Translation + Velocity × Lookahead, in points from where it began; kept on the release frame, then 0,0. |

## Examples

### Swipe a card away

```text
layer card rectangle "Card" @37,250 328x420 cornerRadius=24 opacity←fade_out.output
patch swipe_card swipe layer=@card axis=horizontal
patch gone switch turnOn←swipe_card.swiped
patch fade classicAnimation number←gone.on duration=0.25
patch fade_out transition<number> progress←fade.output start=1 end=0
```

### Swipe up to open a sheet, down to close it

```text
layer sheet rectangle "Sheet" @0,560 402x600 cornerRadius=24 scale←grow.output
patch swipe_sheet swipe layer=@sheet axis=vertical minDistance=60
patch open switch turnOn←swipe_sheet.swipedUp turnOff←swipe_sheet.swipedDown
patch pop popAnimation number←open.on bounciness=4 speed=14
patch grow transition<number> progress←pop.output start=1 end=1.04
```

### Throw a card with a quick flick

Lookahead 0.2 adds a fifth of a second of the release speed, so a short, quick flick throws the card as well as a long drag. The badge fades in as the projected throw nears Min Distance.

```text
layer card group "Card" @37,250 328x420 cornerRadius=24 opacity←fade_out.output
  layer badge rectangle "Throw Badge" @24,24 96x40 cornerRadius=12 opacity←badge_in.progress
patch throw swipe layer=@card axis=horizontal minDistance=95 lookahead=0.2
patch heading absoluteValue value←throw.projected
patch badge_in progress value←heading.output start=40 end=95 clampToRange=true
patch gone switch turnOn←throw.swiped
patch fade classicAnimation number←gone.on duration=0.25
patch fade_out transition<number> progress←fade.output start=1 end=0
```

## Common mistakes

- Swiping the card does nothing: a text layer in front of the card catches the press. Group the card with its text and set Layer to the group, or turn off Receives Touches on the text.
- A short drag counts as a swipe: the finger was still moving fast when it lifted. Raise Min Velocity, or raise Min Distance if slow drags count too early.
- Diagonal swipes on a horizontal card are ignored: Axis is Any Direction, so mostly vertical movement becomes Swiped Up or Down. Set Axis to Horizontal.
- A quick flick springs back although it looked like a throw: it lifted short of Min Distance and slower than Min Velocity. Set Lookahead to about 0.2 so the release speed counts toward the distance.

## Pairs well with

- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Snap](snap.md): Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
