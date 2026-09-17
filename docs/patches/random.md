<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Random

Picks a random number between Start and End, and picks a new one each time Randomize gets a pulse.

| | |
|---|---|
| Type key | `random` |
| Category | [Math](README.md#math) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | random number, randomize, dice, chance, rng, jitter, surprise, math random |

## How it works
Random holds one random number and swaps it for a new one when **Randomize** gets a pulse (a signal that's on for one frame). It picks its first number as soon as the prototype starts.

- **Start** and **End** set the range, and every value in between is equally likely. Either one can be the larger. Changing the range without a pulse stretches the current pick to fit instead of jumping to a new random spot.
- **Whole Numbers** picks whole numbers from Start to End, including both ends, each equally likely. Start 1 and End 6 rolls a die.
- **Value** is the current random number.

## Tips
- Send Value through Pop Animation so each new pick springs into place instead of jumping.
- Feed a loop into Start or End and every item in the loop gets its own random number.
- Simulations use a fixed random seed, so the same run picks the same numbers every time.

## Coming from Origami
Start Value and End Value are named Start and End. Whole Numbers is new, so you don't need a Round patch for whole numbers. Random picks its first number when the prototype starts instead of waiting for the first pulse.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Randomize**<br>`randomize` | `pulse` | — | Pulse to pick a new random number. |
| **Start**<br>`start` | `number` | `0` | One end of the range. Random picks between Start and End, and either one can be the larger. |
| **End**<br>`end` | `number` | `1` | The other end of the range. Without Whole Numbers, Value can get very close to End but never lands exactly on it. |
| **Whole Numbers**<br>`wholeNumbers` | `boolean` | `false` | When on, picks whole numbers from Start to End, including both ends, each equally likely. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Value**<br>`value` | `number` | The current random number. It changes when Randomize gets a pulse, and it rescales when Start or End change. |

## Examples

### Tap to roll a die

Each tap shows a whole number from 1 to 6; the Text layer displays the number as text.

```text
layer die_face text "Die Face" @171,380 fontSize=64 text←roll.value
patch tap_die interaction layer=@die_face
patch roll random randomize←tap_die.tap start=1 end=6 wholeNumbers=true
```

### Spring a bubble to a random size on each tap

Pop Animation springs each new pick into place instead of jumping.

```text
layer bubble oval "Bubble" @151,380 100x100 scale←grow.output
patch tap_bubble interaction layer=@bubble
patch pick random randomize←tap_bubble.tap start=0.6 end=1.4
patch grow popAnimation number←pick.value bounciness=8
```

## Common mistakes

- Value never changes after the first pick: Randomize isn't connected, or it's wired to a state that stays on, which only counts on the frame it turns on. Wire a pulse such as Interaction's Tap.
- The first and last whole numbers come up about half as often as the others: rounding a decimal pick squeezes the ends. Turn on Whole Numbers instead of adding a Round patch.
- Every copy of a looped layer gets the same number: Random runs once unless one of its inputs is a loop. Feed a loop into Start or End so each copy picks its own.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Sample and Hold](sampleAndHold.md): Captures a value when you tell it to and keeps it, like remembering where a drag started.
- [Repeating Pulse](repeatingPulse.md): Sends a pulse over and over at a steady interval, like a metronome.
- [Round](round.md): Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Random (`builtin.random`)

| Sonobe port | Origami label |
|---|---|
| `start` | Start Value |
| `end` | End Value |
