# Debugging

Level 4 · Next: [10 Coming from Origami](10-coming-from-origami.md) or [11 Working with Claude](11-working-with-claude.md)

## What you'll be able to do

- Read what any patch is doing right now.
- Catch pulses that are over in a single frame.
- Use Diagnostics to fix problems before you ever tap the Viewer.
- Trace a wrong value back to where it went wrong.
- Find what's slowing a prototype down.

## The debugging loop

Every bug gets the same five steps:

1. Say what you expected and what happened, one sentence each. "I expected the card to grow when tapped. It stays the same size."
2. Find the layer property that's wrong. Here, Card's Scale.
3. Walk upstream from that property, reading live values, until one surprises you.
4. The bug lives between the last value that made sense and the first one that didn't.
5. Change one thing, restart with ⌘R, and check again.

```
Tap ✓ spark ──▶ Switch ✓ on ──▶ Pop Animation ✗ stuck at 0 ──▶ Transition ──▶ Card . Scale
                                        ▲
                                        first surprise: look at its inputs
```

In this example the Switch turned on, but the Pop Animation never moved. So the problem is in the Pop Animation's inputs, or in the cable between the two.

## Reading live values

- Hover any port to see its current value. Looped ports show each index.
- Watch the cables. Pulses send sparks, true booleans glow, loops carry a "×N" badge, and a small glyph marks where a value gets converted, like a boolean becoming a pulse.
- A property driven by a cable shows that it's linked in the inspector.
- Turn on "show hit targets" in the Viewer to see what can be tapped.
- Press ⌘R to restart the prototype from its first frame. Plenty of "bugs" are leftover state from ten edits ago.

## Catching pulses

A pulse lasts one frame, so there's no value to read by the time your eyes get to the port. Here are three ways to catch one:

- Watch for the spark along its cable.
- Build a pulse counter. Wire the pulse into a Counter's Increase and read the count. If it goes up by 2 per tap, something is double-firing.
- Ask for a trace. Claude, or the `sonobe` command line, can record chosen values on every frame of a scripted interaction.

## The Diagnostics panel

Diagnostics lives in the bottom HUD, next to the Console, AI Activity and FPS. It checks the document continuously and sorts findings into errors, warnings and info. Many findings come with a suggested fix you can apply.

| Finding | What it usually means | Fix |
|---|---|---|
| Unknown patch type or port | A typo, or a file from a newer version | Accept the did-you-mean suggestion |
| Invalid link or type mismatch | Two ports that can't talk directly | Add the converter patch it suggests |
| Zero-latency self-cycle | A patch feeding its own input | Put a Delay 1 in the loop |
| Pulse into a state input | A tap wired where a lasting value is expected | Add a Switch (guide 03) |
| Loop length mismatch | Lists of different lengths meeting | Check whether the wrap was intended (guide 07) |
| Unused patches | Leftovers that don't affect anything | Delete them, or connect them |
| Missing asset | A media file that moved or was deleted | Relink the file |
| Layer can't receive touches | Opacity 0, or disabled | Use a Hit Area, or enable the layer |

Info-level findings are easy to ignore. Clear them anyway. A graph with forty "unused patch" notes hides the one warning that matters.

## Tracing why a value changed

### Walk upstream

This is the loop above. It solves most bugs.

### Mute to split the problem

Muting a patch bypasses it, so its inputs pass straight through to its outputs. If the card's scale is wrong, mute the Pop Animation. If the scale now jumps to the right values, the target is fine and the problem is the spring. If it still jumps to the wrong values, the problem is upstream of the spring.

### Pin an input

Disconnect a cable and type a value into the input. Now everything downstream sees a known value. If the problem goes away, it came from upstream.

### Check for one-frame effects

Two things in Sonobe arrive a frame late, by design:

- A cable that loops backward, feeding a patch earlier in the chain, carries the previous frame's value.
- Values Sonobe measures during layout, like Layer Info, a text layer's Text Size, or a scroll view's content size, are readable on the next frame.

If something is off by exactly one frame, one of these is almost always why.

### Ask for a trace

A trace records values on every frame while a scripted interaction plays. It also summarizes each value's start, end, min, max, overshoot and settle time. This one follows the tap-to-grow card for half a second after a tap (illustrative):

```
time after tap   toggle.on   pop.output   @card.scale
0.0 s            true        0.000        1.0000
0.1 s            true        0.593        1.0474
0.2 s            true        0.968        1.0774
0.3 s            true        1.019        1.0815
0.5 s            true        1.000        1.0800

@card.scale   start 1.000   end 1.080   max 1.0816   overshoot 2%   settles in 0.48 s
```

Ask Claude: "Tap @card, trace @card.scale for one second, and tell me the overshoot and settle time." Traces are also how you check a fix. Run the same trace before and after, and compare the summaries.

## The Console

The Console shows logs from JavaScript patches, plus runtime issues like script errors or a loop that hit its size limit. When a JavaScript patch misbehaves, log its inputs at the top of the script, then read them here.

## Performance

Keep an eye on the FPS meter in the bottom HUD. The goal is a steady 60, or 120 on displays that support it.

When a prototype can't keep up, frames stretch. Sonobe caps each step at 64 ms, so a badly overloaded prototype (below about 15 frames per second) runs in slow motion instead of teleporting. If the animations look slow and FPS is low, you have a performance problem, not a spring problem.

Common costs, and what to do about them:

| Cost | Why | What to do |
|---|---|---|
| Huge loops of layers | Every item is a full layer. Three layers × 500 items is 1,500 layers | Show fewer items, or recycle what's on screen |
| Blur, Background Blur, big shadows | Expensive to draw, especially on many layers at once | Apply them to a few large layers, not many small ones |
| Oversized images | A 4,000-pixel photo shown at 402 points | Resize to about display size. On a 3× phone, a 402-point-wide image needs about 1,206 pixels |
| Shader layers | They redraw every frame | Keep them small, or turn them off when they're off screen |
| Heavy JavaScript patches | Their code runs every frame | Do the work once, or only when an input changes |

To find the culprit, bisect. Mute half the suspect patches or disable half the heavy layers, and watch FPS. Keep halving until you find it. Then test on the device people will actually use, by scanning the Viewer's QR code.

## Try it

1. Break the tap-to-grow card three ways: wire Tap into Pop Animation's Number, set the card's opacity to 0, and swap Transition's Start and End. Find each problem using Diagnostics, the tap checklist in guide 06, or a trace.
2. Build a pulse counter and use it to prove a Tap fires once per tap.
3. Mute the card's Pop Animation, describe what changes, and explain why.
4. Ask Claude to trace `@card.scale` after a tap and read the settle time back to you.
5. Make a loop of 2,000 blurred cards and watch FPS. Then get it back to 60.

## Common mistakes

- Changing several things at once. When it starts working, you won't know which change fixed it.
- Staring at a pulse port and concluding it never fires.
- Letting info-level diagnostics pile up until warnings drown in them.
- Debugging on top of leftover state. Restart with ⌘R before you trust what you see.
- Blaming the spring when the target is wrong. Mute the animation and look.
- Forgetting that layout values arrive a frame late.
