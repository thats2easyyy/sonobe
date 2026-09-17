# ISAT: Interaction, Switch, Animation, Transition

Level 0 to 1 · Next: [03 States and pulses](03-states-and-pulses.md)

## What you'll be able to do

- Spot the ISAT pattern in any graph, including ones someone else built.
- Build prototypes with more than two states, like tabs and multi-step flows.
- Choose between Pop Animation and Classic Animation for a job.
- Know when it's safe to skip a step.

## The pattern

Almost every interaction you'll build contains four jobs:

```
 Interaction ───▶ Switch ─────────▶ Animation ──────────▶ Transition ──────────▶ layer property
 something        remember          get there             what "there"
 happened         what's true       smoothly              looks like
 (a pulse)        (a state)         (0 to 1, moving)      (points, degrees, colors)
```

Each job is its own patch, so you can change one without touching the rest. Want a different feel? Change the Animation. Want the card to grow more? Change the Transition. Want a second button that opens the same thing? Add a cable into the Switch. Nothing else has to move.

It's also how designers already talk about UI. "The menu has two states, open and closed. Tapping the button toggles it. It springs open. Open means 280 points tall." That's ISAT, with one sentence per patch.

## Why the middle is 0 to 1

The Switch outputs 0 or 1, and the Animation moves smoothly between the two. Only at the very end does a Transition turn 0 to 1 into real units.

Keeping the animated value between 0 and 1 means one spring can drive a whole screen:

```
                                       ┌─▶ Transition  200 → 64 ─▶ Header . Height
                                       ├─▶ Transition    1 → 0  ─▶ Large Title . Opacity
Tap ─▶ Switch ─▶ Pop Animation (0..1) ─┼─▶ Transition    0 → 1  ─▶ Small Title . Opacity
                                       └─▶ Transition   24 → 0  ─▶ Card . Corner Radius
```

You tune the feel in one place, and every property arrives at the same moment.

## Variation: Turn On and Turn Off

Flip is perfect when one thing toggles back and forth. When different things open and close the same element, use Turn On and Turn Off instead.

A modal is the classic case. An input accepts only one cable, so the two ways of closing meet in an Or first:

```
Open Button . Tap ──────────────────▶ Switch . Turn On

Backdrop . Tap ──────┐
                     ├─▶ Or ────────▶ Switch . Turn Off
Close Button . Tap ──┘
```

With Flip, a stray tap on the backdrop while the modal is closed would open it. Turn On only ever turns on, and pulsing it while the Switch is already on does nothing. Turn Off works the same way in reverse.

If two pulses land on the same frame, Sonobe follows a fixed order: Turn Off beats Turn On, and Turn On beats Flip.

## Variation: more than two states

A Switch has two states. A tab bar has three or more. For that, swap the Switch for an Option Switch, and add an Option Picker to turn the index into values.

Here's a three-tab bar on a 402-point-wide screen. The three screens sit side by side inside a group called Screens.

```
Home . Tap ─────▶ Set to 0 ┐
Search . Tap ───▶ Set to 1 ├─ Option Switch ─▶ Option Picker ─────▶ Pop Animation ─▶ Screens . Position X
Profile . Tap ──▶ Set to 2 ┘   (0, 1 or 2)     (0, −402, −804)
```

| Tapped | Option Switch | Option Picker | Screens X |
|---|---|---|---|
| Home | 0 | 0 | 0 |
| Search | 1 | −402 | −402 |
| Profile | 2 | −804 | −804 |

Notice there's no Transition here. Option Picker already produced real units, so Pop Animation animates those directly. That gives you two common orders:

- Two states: state, then animate from 0 to 1, then Transition to real units.
- Many states: index, then Option Picker to real units, then animate.

Both are ISAT in spirit. Something happens, you remember it, you animate, and you end up in real units.

For a sliding underline, add a second Option Picker fed by the same Option Switch, holding the underline's X position for each tab, with its own Pop Animation.

## Variation: steps in order with Counter

When states come in a fixed order, like onboarding pages, a Counter is simpler than an Option Switch. Each pulse into Increase adds 1, each pulse into Decrease subtracts 1, and Jump sets the count to Jump to Number.

```
Next . Tap ─▶ Counter . Increase ─▶ Multiply by −402 ─▶ Pop Animation ─▶ Pages . Position X
```

| Taps on Next | Counter | Pages X |
|---|---|---|
| 0 | 0 | 0 |
| 1 | 1 | −402 |
| 2 | 2 | −804 |

Set Maximum Count to the number of pages and the counter wraps back to 0 after the last page. That's great for a carousel that loops. Onboarding usually shouldn't wrap, so hide the Next button on the last page instead.

If Jump fires on the same frame as Increase or Decrease, Jump wins.

## Variation: Pop or Classic

Sonobe has two everyday animation patches. They reach the same place in different ways.

| | Pop Animation | Classic Animation |
|---|---|---|
| Controls | Bounciness, Speed | Duration, Curve |
| How long it takes | Until the spring settles | Exactly Duration |
| When interrupted mid-flight | Keeps its current speed and turns around smoothly | Starts over from wherever it is, taking the full Duration again |
| Feels like | A physical object | A timed effect |
| Best for | Things people touch, like toggles, sheets, cards and anything dragged | Fades, progress bars, loaders, timed sequences, or matching a spec like "250 ms ease out" |

Here's a test worth doing once. Build the tap-to-grow card from guide 01, then tap it five times as fast as you can.

With Pop Animation, the card wobbles back and forth like something with weight. With Classic Animation at 0.4 seconds, every tap starts a fresh 0.4-second trip from wherever the card happens to be. Fast tapping feels sluggish, and a little robotic.

Neither patch is wrong. They're for different jobs. Guide 05 goes deep on springs.

## Variation: skipping steps

ISAT is a pattern, not a law. Skip a step when its job is already done:

- Hold to shrink. Interaction's Down output is already a state that stays true while pressed. Wire Down into Pop Animation and skip the Switch.
- Scroll-linked effects. The finger already moves continuously, so you don't need an Animation. Feed the scroll offset into a Progress patch, which is Transition in reverse: it turns a range like 0 to 120 points into 0 to 1. Then add a Transition.
- Automatic flows. There's no Interaction at all. When Prototype Starts fires a pulse on the first frame, a Wait patch counts two seconds, and its output turns the Switch on.

## Reading someone else's graph

Find the memory first: the Switch, Option Switch or Counter. Everything to its left answers "why does this change?" Everything to its right answers "how does it look?" Once you've found the memory, most graphs make sense within a minute.

## Try it

1. Build a like button. Tapping the heart flips a Switch, which feeds a Pop Animation with Bounciness `12` and two Transitions: scale from `0.9` to `1`, and color from gray to red.
2. Build the three-tab bar with a sliding underline.
3. Swap the card's Pop Animation for a Classic Animation (0.3 seconds, Cubic Out). Tap rapidly and compare.
4. Build a modal with a backdrop. Use Turn On and Turn Off, one Pop Animation, and two Transitions: the sheet's Y from `874` to `400`, and the backdrop's opacity from `0` to `0.4`.
5. Build a three-page onboarding with a Counter and a Next button that disappears on the last page. Hint: an Equals comparison outputs a boolean, and a Not in front of Enabled hides the button when the count is 2.

## Common mistakes

- Putting the Switch after the Animation. A spring fed a pulse twitches and goes back. The memory has to come first.
- Using Flip when different buttons open and close the same thing. One extra tap and the states swap. Use Turn On and Turn Off.
- Mismatched counts. An Option Switch with three inputs and an Option Picker with two values leaves one tab with nothing. Keep the counts equal.
- Feeding an index straight into a Transition. Transition expects 0 to 1, so index 2 extrapolates far past End. Use an Option Picker or a math patch.
- Using Classic Animation for things people drag or tap quickly. Every interruption restarts the clock.
