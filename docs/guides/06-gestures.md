# Gestures

Level 2 · Next: [07 Loops](07-loops.md)

## What you'll be able to do

- Choose the right patch for a tap, press, long press, drag, scroll, swipe, hover or key press.
- Understand slop, velocity, momentum and rubber banding, with real numbers.
- Build a draggable picture-in-picture that snaps to the nearest side.
- Work through a checklist when a tap won't fire.

## The gesture menu

| Gesture | Patch | You get | Kind |
|---|---|---|---|
| Press | Interaction's Down | True while a finger is on the layer | State |
| Tap | Interaction's Tap | A pulse on release, if the finger moved less than 10 points | Pulse |
| Long press | Long Press | True once the finger has stayed still for the duration | State |
| Drag | Drag, or Gesture | Where the layer should be (Drag) or how far the finger has moved (Gesture), and how fast it's moving | Numbers |
| Scroll | Scroll | A content offset, with momentum and rubber banding | Numbers |
| Swipe | Swipe | A quick directional flick | Pulse |
| Hover | Hover | True while the pointer is over the layer (desktop only) | State |
| Keyboard | Keyboard | True while a key is held | State |

The fastest way in is the Touch button on a layer's row in the Layers panel. It inserts the patch already pointed at that layer.

## Slop: how still is still?

A tap only fires if the finger moved less than 10 points between touching down and lifting. A long press needs the finger to stay within 10 points for its whole duration. That tolerance is called slop.

Take a finger that lands at `120, 300`:

- It lifts at `126, 307`. It moved √(6² + 7²) ≈ 9.2 points, so that's a tap.
- It lifts at `120, 312`. It moved 12 points, so that was a tiny drag, and no tap fires.

Slop is what lets a scrolling list have tappable rows. Scroll the list, and the row you started on doesn't open.

## Press and long press

Press feedback is the simplest gesture there is. Down is already a state, so it can drive an animation directly:

```
Interaction . Down ─▶ Pop Animation (Snappy) ─▶ Transition 1 → 0.96 ─▶ Button . Scale
```

A long-press menu adds a Long Press patch and a Switch, so the menu stays open after the finger lifts:

```
Interaction . Down ─▶ Long Press (0.5 s) ─▶ Switch . Turn On
Backdrop . Tap ─────────────────────────────▶ Switch . Turn Off
Switch ─▶ Pop Animation ─┬─▶ Transition 0.8 → 1 ─▶ Menu . Scale
                         └─▶ Transition 0 → 1   ─▶ Menu . Opacity
```

```
time:        0.0 s            0.5 s                    1.2 s
finger:      down ─────────────────────────────────────up
Long Press:  0 ────────────────1───────────────────────0
Switch:      0 ────────────────1────────────────────────────── stays on
```

## Drag

Interaction's Position tells you where the finger is, in prototype coordinates measured from the top-left of the screen. On the frame Tap fires, Position still holds the spot where the finger lifted.

For speed, use Drag's or Gesture's Velocity, in points per second on each axis. Both keep the fling's speed on the frame the finger lifts, which is the frame a spring reads when it takes over.

The Drag patch does the bookkeeping for moving a layer with a finger. It remembers where you grabbed the layer, so the layer doesn't jump to put its anchor under your finger. Gesture is the lower-level version. It reports how far the finger has moved since it landed (Translation) and how fast it's going (Velocity), and leaves the rest to you.

### Example: a picture-in-picture that snaps to a side

A 120 × 180 floating video uses Anchor `0.5, 0.5`. When you let go, it springs to the left side (x 76) or the right side (x 326), 16 points from each edge.

Choosing a side from the position alone feels wrong. A quick flick to the right from the left half should still go right. So project where the throw would land, then pick the side:

```
projected x = x + velocity × 0.5
```

A PiP at x 150, flicked right at 600 points per second, projects to 150 + 300 = 450. That's past the middle of the screen at 201, so it goes right.

The 0.5 comes from momentum, which the next section explains.

A spring moves the PiP once the finger lifts, so this graph follows the finger with Gesture. Drag remembers where it last put the layer and doesn't see the spring move it, so the next grab would jump. Translation X and Velocity X are the X parts of Gesture's point outputs, split with a Point Unpack.

```
Stage 1: follow the finger from where the PiP was when it was grabbed

  Spring Animation ─▶ Delay One Frame ─▶ Sample and Hold . Value      where the PiP was last frame
  Gesture . Down ─▶ Not ─▶ Sample and Hold . Sample                  copy until a finger lands, then hold
  Sample and Hold ────────┐
  Gesture . Translation X ┴─▶ Add ─▶ finger X

Stage 2: pick a side from where the throw would land

  Gesture . Velocity X ─▶ Multiply × 0.5 ─┐
  Delay One Frame ────────────────────────┴─▶ Add ─▶ Greater Than 201 ─▶ Option Picker (76, 326) ─▶ snap X

Stage 3: follow the finger while it's down, head for the side once it lifts

  Gesture . Down ───────▶ Option Picker (snap X, finger X) ─▶ Spring Animation . Number
  Gesture . Down ───────────────────────────────────────────▶ Spring Animation . Gesture Active
  Gesture . Velocity X ─────────────────────────────────────▶ Spring Animation . Gesture Velocity

  Spring Animation ─▶ PiP . Position X
```

A boolean picks an Option Picker value by index: false picks the first value and true picks the second. So Greater Than chooses between 76 and 326, and Down chooses between the snap target and the finger.

The projection starts from where the PiP was on the previous frame, not from finger X. On the frame the finger lifts, Sample and Hold starts copying again while Gesture still reports the drag, so finger X would count the drag twice.

While you drag, Gesture Active is on and the spring follows the finger. When you let go, the spring heads for the snap target, starting at the finger's speed. Guide 05 explains why that matters. The Drag and Snap recipe in `examples/09-drag-and-snap` builds the same graph in two dimensions.

## Scroll, momentum and rubber banding

Put the content in a group with Clip Contents on. That group is the window. Add a Scroll patch pointed at the content, choosing Free or Paging.

Momentum is why content keeps gliding after you lift your finger. Each millisecond, the speed is multiplied by a deceleration rate: 0.998 for Normal, or 0.99 for Fast. From that, the total glide distance is:

```
distance = velocity ÷ 1000 × rate ÷ (1 − rate)
```

| Flick speed | Normal (0.998) | Fast (0.99) |
|---|---|---|
| 1,000 points/s | about 499 points | about 99 points |
| 2,000 points/s | about 998 points | about 198 points |

With the Normal rate, the glide distance is almost exactly half the flick speed. That's where the 0.5 in the PiP projection comes from.

Rubber banding happens when you drag past the end of the content. The content moves less than your finger, and it springs back when you let go. It tells people "that's the end" without a single word.

### Example: a collapsing header

Scroll offsets make great Progress inputs. Here the header shrinks from 200 points tall to 64 over the first 120 points of scrolling:

```
Scroll offset ─▶ Progress (Start 0, End 120) ─▶ Transition 200 → 64 ─▶ Header . Height
                                              └▶ Transition 1 → 0   ─▶ Large Title . Opacity
```

Hover the Scroll output while you scroll to see which direction the numbers go, then set Start and End to match. If the offset counts down as content moves up, use Start `0` and End `−120`.

Past 120 points, Progress keeps climbing above 1, and Transition would keep shrinking the header. Clamp the progress with a math patch so the header stops at 64.

### Sketch: pull to refresh

Combine a threshold, a release and a timer:

1. And of "offset past the threshold" and "finger just lifted" (Pulse's Turned Off on Down) turns a Switch on.
2. The Switch drives a spinner's opacity and pushes the feed down with Pop Animation and Transition.
3. A Wait with Duration `2`, started by the Switch turning on, turns the Switch off.

## Swipe

Swipe recognizes a quick flick in a direction. It fits things that change all at once, like dismissing a notification or skipping to the next story.

If the thing should follow the finger and then decide, use Drag with a snap instead. Swipe decides on release, and nothing moves until then. Drag shows the movement as it happens. In my experience, most designs that start as "swipe" end up wanting drag with a snap, because people like to see the card move under their thumb.

The two combine well: let Gesture move a card, and let Swipe decide whether it leaves. A release moving at Min Velocity (500 points a second by default) or faster swipes on speed alone. A slower flick is judged by where the finger lifted, so one that stops short of Min Distance springs back. Set **Lookahead** to about 0.2 seconds and Swipe judges where that throw is heading instead, the same projection as the PiP's `x + velocity × 0.5` with 0.2 in place of 0.5. Swipe's **Projected** output (advanced) is that estimate, so you can fade in a "yes" badge as the throw nears Min Distance. To judge every release by the projection alone, raise Min Velocity out of reach, as the Noddit Deck example does with 10000.

## Hover and keyboard

Hover works with a mouse or trackpad. Phones have no hover, so a prototype running in a phone's browser never reports it. Always give hover effects a touch alternative.

```
Hover ─▶ Pop Animation (Snappy) ─▶ Transition 0 → 0.15 ─▶ Button . Shadow Opacity
```

Keyboard reports whether a key is held. Wire arrow keys into a Counter's Increase and Decrease to page through a carousel. Click the Viewer first so it has keyboard focus. For real typing, use a Text Field layer, which gives you its text, whether it's focused, and a pulse when Return is pressed.

**Tip: clear after send.** A Text Field's Text reaches the field only when it changes. That keeps typing from being overwritten, but it also means setting Text back to empty after Send does nothing: it was already empty. Use the field's **Set Text** pulse instead. Every pulse puts **Text to Set** in the field, and Text to Set is empty unless you fill it in. **Begin Editing** and **End Editing** do the same for focus: pulse Begin Editing from an Edit button to put the cursor in the field, or End Editing to dismiss the keyboard. To try one before wiring it, click **Fire** on its row in the Inspector: it fires in the viewer and leaves the document alone.

```
Send · Interaction . Tap ─▶ Composer . Set Text        (Text to Set left empty)
Composer . Submitted ─┘  (merge both with an Or to send on Return too)
```

## Why doesn't my tap fire?

Work down this list. Most problems turn up in the first five checks.

1. Is the Interaction pointed at the layer you think it is?
2. Is the layer Enabled?
3. Is its Opacity above 0? A layer at opacity 0 ignores touches, so use a Hit Area instead.
4. Is Receives Touches on?
5. Is something in front of it? Turn on "show hit targets" in the Viewer. A transparent group on top catches everything.
6. Did the finger move 10 points or more? Then it was a drag.
7. Is the layer tiny? Give it Hit Slop.
8. Is Tap wired into a state input? The tap fired, but you couldn't see it (guide 03).
9. Is the Interaction patch muted, or its Enabled input off?
10. Has the prototype been running since your last big change? Restart with ⌘R.

The Diagnostics panel flags layers that can't receive touches. Claude can help too: "Simulate a tap on the Save button and tell me why nothing happens." It can run the tap and read the hit test directly.

## Try it

1. Build a button that shrinks to 96% while pressed.
2. Build the long-press menu, with a backdrop that closes it.
3. Build the snapping PiP. Flick it toward each side and check the projection math.
4. Build the collapsing header, and make sure it stops at 64 points.
5. Find the edge of slop. Tap while moving your finger slightly, and notice where a tap turns into a drag.

## Common mistakes

- Wiring Down into Flip in a scrolling list. Every scroll that starts on a row flips it. Use Tap.
- Relying on hover for something important. Phone users never see it.
- Using opacity 0 for a touch target.
- Letting go of a dragged layer without velocity handoff. The layer stalls for a moment before it moves.
- Reaching for Swipe when the design really wants drag with a snap.
- Forgetting that touches bubble up. An Interaction on a card also hears taps on the buttons inside it.
