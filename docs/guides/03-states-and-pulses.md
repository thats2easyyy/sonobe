# States and pulses

Level 1 · Next: [04 Layers and layout](04-layers-and-layout.md)

## What you'll be able to do

- Tell a pulse from a state, both by how it looks in Sonobe and by how it behaves.
- Predict what happens when you wire one into the other.
- Fix the handful of bugs that come from mixing them up.
- Convert between them on purpose with Switch, Pulse, Delay, Wait and Pulse on Change.

If you only read one guide twice, make it this one. Mixing up pulses and states is behind more "but it should work" moments than anything else in a patch editor.

## Two kinds of true

A state is a value that stays until something changes it. "The sheet is open." "The finger is down." Switch's On/Off and Interaction's Down are states.

A pulse is true for exactly one frame, then false again. A frame is 1/60 of a second, or 1/120 on fast displays. "The card was just tapped." "The prototype just started." Interaction's Tap and When Prototype Starts are pulses.

Think of a state as a light switch and a pulse as a doorbell. Pulses tell patches to do something. States tell patches how things are.

Here's one tap, frame by frame:

```
frame:    1    2    3    4    5    6    7    8    9
finger:   ·    down ──────────────────── up   ·    ·
Down:     0    1    1    1    1    1    0    0    0      state
Tap:      0    0    0    0    0    0    1    0    0      pulse (one frame)
Switch:   0    0    0    0    0    0    1    1    1      state, flipped by Tap
```

The tap existed for one frame. The Switch turned that moment into something that lasts.

## How to see them in Sonobe

Pulses are too short to read as numbers, so Sonobe draws them for you:

- Pulse ports have their own glyph, so you can tell a pulse input from a boolean input before you connect anything.
- When a pulse fires, a spark travels along its cable. You'd miss a one-frame value, but you won't miss the spark.
- A boolean cable glows while its value is true. A steady glow means a state is on.
- Hovering any port shows its live value.
- The Diagnostics panel warns you when a pulse is wired into an input that expects a state.

## State into a pulse input: rising edges

A pulse input fires when an upstream pulse arrives. It also fires when a connected state changes from false to true, a moment called a rising edge. Sonobe marks this conversion with a small glyph on the cable.

Wire Down into Switch's Flip:

```
frame:        1    2    3    4    5    6    7    8
Down:         0    1    1    1    1    0    0    0
Flip fires:        ↑                                   rising edge on frame 2
Switch:       0    1    1    1    1    1    1    1
```

The Switch flips once per press, the instant the finger lands. Holding doesn't flip it again, and neither does letting go, because a false-to-true change happens only once per press.

To make something happen when a state turns off, use a Pulse patch. Feed it the state, and its Turned Off output fires on the falling edge. Its Turned On output fires on the rising edge.

## Pulse into a state input: the invisible blip

This is the bug almost everyone hits. You wire Tap into something that expects a lasting value, like Pop Animation's Number, a layer's Enabled, or a Transition's Progress:

```
frame:     6    7    8    9    10   11
Tap:       0    1    0    0    0    0
Number:    0    1    0    0    0    0      the target is 1 for 16 ms
```

With Pop Animation's default settings, that one-frame target nudges the output up to about 0.13, and it drifts back to 0 within a third of a second. On a card that grows from 1 to 1.08, that's a 1% twitch. The pulse really did fire. It just didn't last long enough to matter.

Sonobe's diagnostics flag this and ask "did you mean a Switch?" There are two fixes:

- To remember the tap, put a Switch in between, using Flip or Turn On.
- To hold it for a while, stretch it with a Delay (see the table below).

## The converters

| You have | You want | Use |
|---|---|---|
| A state | A pulse when it turns on | Wire it into any pulse input, or Pulse's Turned On |
| A state | A pulse when it turns off | Pulse's Turned Off |
| A pulse | A state that lasts | Switch (Turn On, Turn Off or Flip) |
| A pulse | A state that lasts N seconds | Delay with Duration N and Style "When Decreasing" |
| A pulse | A state that turns true N seconds later | Wait with Duration N |
| Any value | A pulse whenever it changes | Pulse on Change |
| Nothing | A pulse when the prototype starts | When Prototype Starts |

Two of these deserve a closer look.

A Delay with Style "When Decreasing" lets a rise straight through and holds off the fall. Feed it a pulse, and its output turns true right away and stays true for Duration. A one-frame tap becomes a two-second glow.

Wait starts counting when a pulse arrives at its Start input. Its output is false while it counts, turns true when Duration is up, and stays true until the next Start. Wire that output into a pulse input and you get a pulse the moment the wait finishes.

## Logic with pulses

And, Or and Not work on pulses, but not always the way you'd guess:

| Wiring | What happens | Good for |
|---|---|---|
| And of a pulse and a state | Fires on the frames where the pulse fires and the state is true | "Tap, but only while the menu is open" |
| Or of two pulses | Fires when either one fires | "Close button or backdrop tapped" |
| And of two pulses | Fires only if both land on the same frame, which two separate taps almost never do | Rarely what you want |
| Not of a pulse | True on every frame except the one where the pulse fires | Rarely what you want |

## Same-frame rules

When several things happen on one frame, Sonobe follows fixed rules:

- Pulses can fire on back-to-back frames, and each one counts.
- Switch: Turn Off beats Turn On, and Turn On beats Flip.
- Counter: Jump beats Increase and Decrease. An Increase and a Decrease on the same frame cancel out.
- On the very first frame, patches that compare against the previous frame start from their first value, so nothing fires by accident at startup. When Prototype Starts is the one pulse you get at launch.

## A worked example: a toast that hides itself

Tap Save, a toast slides up, and two seconds later it slides away.

```
Save . Tap ─────────────────────▶ Turn On ┐
                                          ├─ Switch ── On/Off ──┬─▶ Pop Animation ─▶ Transition 900 → 760 ─▶ Toast . Position Y
            ┌───────────────────▶ Turn Off┘                     │
            │                                                   │
  Delay (2 s, When Increasing) ◀────────────────────────────────┘
```

A Delay with Style "When Increasing" holds off a rise and lets a fall straight through. So its output turns true only after the Switch has been on for two full seconds. That rising edge pulses Turn Off. The Switch goes off, the Delay's output falls immediately, and everything is ready for the next tap.

```
time:        0.0 s                     2.0 s
Save tap:    ↑
Switch:      1 ─────────────────────────┐ 0
Delay:       0 ─────────────────────────↑ 0      fires Turn Off, then falls
Toast:       slides up                  slides down
```

This cable loops back into the patch that feeds it, and that's allowed. A backward cable carries the previous frame's value, so it adds one frame of delay. Nobody notices 16 milliseconds on a two-second timer.

## Four bugs and how to fix them

### "Nothing happens"

A pulse is wired into a state input. It fired for one frame and vanished. Look for the diagnostic, then add a Switch.

### "It flips twice"

Two pulses reach the Switch during one gesture. The usual causes:

- Down is wired to Flip, which flips on press, and Tap is also wired to Flip, which flips again on release.
- A button and the card containing it both have an Interaction. Touches bubble up to parent layers, so one tap reaches both.

### "It only works once"

Something turns on and nothing ever turns it off. Look for a Turn On with no matching Turn Off, or a Wait that never gets a new Start.

### "It fires when I scroll"

Down is wired into Flip inside a scrolling list. Down turns true the instant a finger lands, even if the finger goes on to scroll. Use Tap, which only fires if the finger moved less than 10 points.

## Try it

1. Wire Down into Flip. Before testing, predict whether the Switch changes on press or on release, then check.
2. Build the self-hiding toast.
3. Wire Tap into a Transition's Progress on purpose. Watch for the spark, then read what Diagnostics says.
4. Count taps only while a menu is open. Feed an And of Tap and the menu's Switch into a Counter's Increase.
5. Use Pulse's Turned Off output to play a small bounce when a finger lifts off a button.

## Common mistakes

- Treating a pulse as a short state. It's an event. It tells something to happen, and then it's over.
- Using Not on a pulse to mean "not tapped". It's true nearly all the time.
- Expecting a pulse input to fire when a state turns off. Pulse inputs only see rising edges, so use Pulse's Turned Off.
- Forgetting that touches bubble up, so a tap on a child layer is also a tap on its parent.
- Trying to catch a pulse by hovering its port. Watch for the spark, or ask Claude for a frame-by-frame trace.
