# Knobs and presets

Level 2–4 · Back to [the learning path](README.md)

## What you'll be able to do

- Turn the numbers that decide how an interaction feels into knobs, and tune them with sliders while the prototype runs.
- Keep a locked reference, like "Shipped app", next to the version you're working on, and flip between them in the middle of a swipe.
- Hand an engineer a table of exactly what changed.

## The idea

A spring's bounciness, how far a card travels before a swipe counts, how much it tilts: these numbers live on patch inputs, spread across the graph. When you're tuning the feel, you don't want to hunt for them. You want them in one place, with sliders.

A **knob** is a named value in the Inspector's **Knobs** tab (⌘5). Any patch input or layer property can read it. Wherever a knob drives an input, the patch editor shows a small chip with the knob's name and value (a color knob shows a swatch) instead of a cable.

A **preset** is a full set of knob values. A project can have several, like "Shipped app" and "Proposal", and one of them runs. Switching presets changes the prototype live: the card you're dragging stays under your finger and picks up the new values mid-gesture.

```
 Knobs tab                               the graph
 ┌────────────────────────────────────┐
 │ (● Proposal) (Shipped app, locked) │  Pop Animation
 │ THROW                              │  ├ Bounciness  ◉ Bounce 8
 │   Commit Distance ───●───── 95 pt  │  └ Speed       12
 │ ≠ Bounce  ─────●───────────── 8    │
 └────────────────────────────────────┘  Greater Than
                                         └ Value 2     ◉ Commit Distance 95
```

Knobs are saved in `knobs.json` next to `project.json`, so they go into git with the rest of the prototype, and tuning a value changes one line.

## Make a knob

1. Select the patch or layer, and right-click the field in **Properties**, for example a Pop Animation's **Bounciness**.
2. Choose **Make Knob…**. Sonobe suggests the field's name, the group you used last, and a slider range worked out from the value (95 gets 0 to 200 in steps of 1; 0.75 gets 0 to 2 in steps of 0.01). Change anything you like.
3. Press Return.

The field now shows the knob's chip and a slider. The knob holds the field's value, so nothing moves yet. Click **Show** on the confirmation, or press ⌘5, to open the Knobs tab.

Make Knob works on numbers, on/off switches, colors, choices, points and text. With several layers selected, one knob drives all of them.

To drive another field with a knob you already have, right-click it and choose **Use Knob ▸**. Only knobs whose type fits are listed. On a field a knob already drives, Use Knob ▸ switches it to another knob in one undo step.

## Tune in the Knobs tab

Drag a slider, or click its number and type one. Every change goes into the running preset right away, on the viewer and on a phone that's previewing. A whole drag is one undo step: "Tune Commit Distance to 110 pt (Proposal)".

A slider's range only guides the drag. You can type a value past it, and the slider shows a caret at that end.

Right-click a row (or use its ⋯ button) to:

- **Edit Knob…** to rename it, give it a group, a unit like `pt` or `s`, a range, or a description of what it changes in the feel.
- **Show Uses** to find every input it drives.
- **Remove Knob**. Each input it drove keeps the value it had, so the prototype behaves the same.

The Knobs tab stays open while you select other things, so you can keep tuning while you look around the graph. The line at the top leads back to Properties.

## A reference and a proposal

1. In the Knobs tab, click **Add Preset to Compare**. The new preset starts as a copy of the running one and runs from then on, so what you tune next goes into the copy.
2. Right-click each chip and **Rename** them: the one you started from "Shipped app", the new one "Proposal".
3. Right-click "Shipped app" and choose **Lock**.

A locked preset can't be tuned by accident. While it runs, the rows are read-only and a banner offers **Switch to Proposal** or **Unlock**.

Now tune Proposal. Each row that differs from the other preset gets a ≠ mark, and the slider shows a small tick where the other preset's value sits. Hover the tick to read it, or click it to copy that value into the running preset. **Only differences** hides the knobs that match.

When the reference behaves differently in kind rather than by amount (the shipped card never flies off the screen), make that a knob too: an on/off knob into an Option Picker that chooses between the two behaviors.

## Flip while you swipe

Press ⌘' to flip to the preset that ran before, and again to flip back. The viewer names the preset for a moment, so you can keep your eyes on the prototype. Flipping works everywhere except while you're typing in a field, including while you drag in the viewer.

A run of flips is one undo step, "Switch Presets", so undoing brings back the preset that ran before you started flipping, without undoing your tuning.

## Hand it off

Choose **Copy Differences** from the Knobs tab's ⋯ menu. You get a Markdown table of every knob whose value differs between the two presets, ready to paste into a ticket:

```
| Knob | Proposal | Shipped app |
| --- | --- | --- |
| Throw Lookahead | 0.2 s | 0 s |
| Grab Tilt | on | off |
```

## From Variable Broadcasters

Prototypes built the Origami way often share constants through Variable Broadcasters. When yours does, the Knobs tab offers **Convert Variables to Knobs…**. Each constant becomes a knob with the same value, every input its receivers fed reads the knob instead, and the broadcasters and receivers go, in one undo step. Broadcasters driven by a live value stay, and the dialog says why.

## With Claude

Ask Claude to "build the tunable numbers as knobs, with a locked Shipped app preset". It makes the knobs, the presets and the connections in one step, and you tune them in the Knobs tab. Claude can also run the same gesture under each preset in its own simulation to compare them, without switching what your viewer shows. [Guide 11](11-working-with-claude.md) covers connecting Claude.

## Try it

1. Start from the Photo Zoom demo Sonobe opens with. Make a knob from Zoom Spring's **Bounciness** and tap the photo while you drag the slider.
2. Add a preset, lock the one you started from, and make the new one bouncier. Flip with ⌘' while the photo zooms.
3. Make a knob from Photo Scale's **End**, then use it for Heart Scale's **End** too with **Use Knob ▸**. Watch both chips change as you tune.
4. Copy the differences and paste them somewhere.
5. Open the Placemark Deck example ([examples/16-placemark-deck](../../examples/16-placemark-deck/)). Throw a card, press ⌘' and throw another: Shipped app is its locked reference, and Card Flies Out is the difference in kind.

## Common mistakes

- Putting reference values in names, like "Commit Distance (app: 95)". Nothing can read or switch to a name. Make a locked preset instead.
- Tuning while the reference preset runs. That's what the lock is for: lock it once and the banner reminds you.
- A difference that isn't a knob. If the two versions differ in a patch you changed by hand, flipping presets won't show it. Every difference between presets must be a knob value.
- Ranges no finger would use. A 0 to 10,000 slider moves too much per pixel. Edit the knob and pick the range you'd actually try.
