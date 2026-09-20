# Your first prototype

Level 0 · about 5 minutes · Next: [02 ISAT](02-isat.md)

## What you'll be able to do

- Build a card that grows when you tap it and settles back when you tap again.
- Say in one sentence what each of the four patches in it does.
- Read a patch graph from left to right, like a sentence.

## The mental model

You can understand this part without installing anything.

A Sonobe prototype has two halves. Layers are what you see. Patches are what happens. The Viewer runs both at once, live, while you edit.

```
┌ Layers ──────┐   ┌ Patch Editor ─────────────────────────────────┐   ┌ Viewer ──────┐
│ Main         │   │                                                │   │  ┌────────┐  │
│ ├─ Background│   │  Interaction ─▶ Switch ─▶ Pop ─▶ Transition ───┼──▶│  │  Card  │  │
│ └─ Card      │   │                                                │   │  └────────┘  │
└──────────────┘   └────────────────────────────────────────────────┘   └──────────────┘
  what you see                  what happens                               try it
```

Layers work the way they do in Figma or Keynote: rectangles, text, images and groups, stacked on top of each other.

A patch is a small machine with one job. Its inputs are on the left and its outputs are on the right. You connect an output to an input with a cable, and values travel along cables from left to right. The prototype recalculates every patch 60 times a second, so when an input changes, everything downstream follows right away.

The easiest way to read a patch graph is as a chain of questions:

```
 "Was the card tapped?" ─▶ "So is it big now?" ─▶ "Head toward big, smoothly" ─▶ "Big means 108%"
       Interaction              Switch                 Pop Animation                 Transition
```

That chain is the whole prototype. Let's build it.

## Build it

### 1. Draw the card

Add a Color Fill layer, name it Background and set it to light gray. It fills the screen, so you'll be able to see the card's edges.

Add a Rectangle above it and name it Card. In the inspector, set:

- Position `16, 120`
- Size `358, 220`
- Corner Radius `24`
- Color white

### 2. Notice the tap

Hover the Card row in the Layers panel and click its Touch button. Choose Tap.

An Interaction patch appears, already pointed at Card. Tap the card in the Viewer, and a spark runs out of the patch's Tap output. That spark is a pulse: a signal that lasts one frame, at the moment your finger lifts.

### 3. Remember it

Double-click an empty spot in the patch editor (or press ⌥⏎), type "switch" and press Return. You can also hover the canvas and press S.

Drag a cable from Interaction's Tap output to Switch's Flip input.

Tap the card a few times. Switch's On output glows while it's on and goes dark while it's off. The Switch remembers.

### 4. Make it move

Hover the canvas and press A to add a Pop Animation. Connect Switch's On output to Pop Animation's Number input.

When a boolean travels into a number input, on becomes 1 and off becomes 0. So the Pop Animation's target flips between 0 and 1, and its output travels there on a spring instead of jumping.

### 5. Turn motion into scale

Press T to add a Transition. Connect Pop Animation's output to Transition's Progress. Set Start to `1` and End to `1.08`.

Now drag a cable from Transition's output onto Card's Scale property in the inspector. Dropping it on the Card row in the Layers panel works too.

Tap the card. It grows by 8%. Tap again, and it settles back. You built a prototype.

## What each piece does

### Interaction

Interaction watches one layer for touches. Its Down output is true for as long as a finger is pressing. Its Tap output fires one pulse when the finger lifts, but only if the finger moved less than 10 points. That's why dragging across the card doesn't count as a tap.

### Switch

Switch remembers on or off. Each pulse into Flip swaps it.

| Event | On |
|---|---|
| Start | 0 |
| Tap 1 | 1 |
| Tap 2 | 0 |
| Tap 3 | 1 |

A tap is gone after one frame. The Switch turns that moment into something that lasts.

### Pop Animation

Pop Animation chases its Number with a spring. With the default Bounciness 5 and Speed 10, a jump from 0 to 1 looks like this:

| Time since the spring started | Output |
|---|---|
| 0.0 s | 0.00 |
| 0.1 s | 0.59 |
| 0.2 s | 0.97 |
| 0.3 s | 1.02 |
| 0.4 s | 1.01 |
| 0.5 s | 1.00 |

See the 1.02? The spring runs a little past its target, then settles. That small overshoot is the "pop".

### Transition

Transition maps a progress between 0 and 1 onto whatever range you need, with one formula:

```
output = Start + Progress × (End − Start)
```

With Start 1 and End 1.08:

| Progress | Scale |
|---|---|
| 0 | 1.00 |
| 0.5 | 1.04 |
| 1 | 1.08 |
| 1.02 | 1.0816 |

Transition doesn't clamp. When the spring overshoots to 1.02, the card overshoots to 108.16%, and that's the bounce you feel.

### Scale

Scale grows a layer around its pivot, which is the layer's center unless you change it. So the card grows evenly in every direction.

## Read it like a sentence

When the card is tapped, flip the switch. Animate toward the switch's value. Map that onto a scale between 100% and 108%.

If you can say a graph out loud like that, you understand it. Sonobe and Claude describe graphs in a compact text outline that reads almost the same way. This one is illustrative:

```
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on bounciness=5 speed=10
patch grow transition<number> progress←pop.output start=1 end=1.08
```

## One animation, many properties

An output can feed as many inputs as you like. Add a second Transition with Start `0` and End `0.2`. Feed it from the same Pop Animation, and connect it to Card's Shadow Opacity. Set Shadow Radius to `24` so the shadow is soft.

```
                   ┌─▶ Transition  1 → 1.08 ─▶ Card . Scale
Pop Animation ─────┤
                   └─▶ Transition  0 → 0.2  ─▶ Card . Shadow Opacity
```

Now the card lifts off the page as it grows. Both properties ride the same spring, so they can't drift out of sync.

## Try it

1. Change End to `1.3`. Then try `0.95`, so a tap shrinks the card instead.
2. Set Bounciness to `0`, then to `15`. Describe each one in a single word.
3. Connect Down to Flip instead of Tap. Does the card change on press or on release now?
4. Add another Transition and set its type to Color. Feed it from the same Pop Animation and connect it to Background's Color, going from light gray to near black.
5. Make the card grow only while you hold it. Hint: Down is already on or off by itself, so you won't need the Switch.

Save it with ⌘S (Ctrl+S) to keep it as a project. Until you do, Sonobe keeps your unsaved work as a draft, so if the app quits or crashes, the welcome screen offers it back under **Recovered**.

## Common mistakes

- Wiring Tap straight into Pop Animation. A pulse is 1 for a single frame, so the spring sets off toward 1 and gets called back 16 milliseconds later. The card twitches, or seems to do nothing. Put a Switch in between.
- Wiring Pop Animation straight into Scale. At rest the output is 0, so the card shrinks to nothing. Transition is there to map 0 to 1 onto real values.
- Expecting Transition to stop at End. It extrapolates on purpose. If you need a hard limit, clamp the value with a math patch.
- Tapping and getting nothing at all. Something may be in front of the card catching the touch. Turn on "show hit targets" in the Viewer to see what's tappable.
- Swapping Start and End. Start is the value at progress 0, which is usually how the layer looks at rest.
