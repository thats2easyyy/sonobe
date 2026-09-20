# Learn Sonobe

These guides take you from "I've never built a prototype" to "I can build, tune, debug and hand off anything I can sketch." They're short on purpose. Each one is built from small examples you can make in a few minutes, a set of exercises, and the mistakes nearly everyone makes the first time.

## What you'll be able to do

- Pick a starting point that matches what you already know.
- See how the guides build on each other, from your first tap to expert debugging.
- Learn alongside Claude without handing the learning over to it.

## How to use these guides

Read with Sonobe open. When a guide says "tap the card", tap the card. The ideas stick when your own hands have wired the cables.

Every guide has the same shape:

1. What you'll be able to do.
2. The idea, with small worked examples and a diagram or two.
3. Try it, with exercises that start easy.
4. Common mistakes, and how to spot them.

You don't need to know any code. A few guides end with code for engineers, and you can skip those parts.

## The learning path

```
 Level 0            Level 1              Level 2              Level 3               Level 4
 Never prototyped   Can make one thing   Makes interactions   Builds whole flows    Expert
                    move                 feel right

 ┌──────────────┐   ┌────────────────┐   ┌────────────────┐   ┌─────────────────┐   ┌───────────────┐
 │ 01 First     │   │ 03 States and  │   │ 05 Springs and │   │ 07 Loops        │   │ 09 Debugging  │
 │    prototype │──▶│    pulses      │──▶│    feel        │──▶│                 │──▶│               │
 │ 02 ISAT      │   │ 04 Layers and  │   │ 06 Gestures    │   │ 08 Components   │   │ Handoff (05)  │
 │              │   │    layout      │   │                │   │    and variables│   │               │
 └──────────────┘   └────────────────┘   └────────────────┘   └─────────────────┘   └───────────────┘

 Any level:   10 Coming from Origami   ·   11 Working with Claude   ·   12 Importing designs
```

| Level | You are | Read | Afterwards you can build |
|---|---|---|---|
| 0 | New to prototyping, or new to patch editors | [01 Your first prototype](01-first-prototype.md), [02 ISAT](02-isat.md) | Tap to zoom, a like button, a card that expands |
| 1 | You can make something move, but it breaks in surprising ways | [03 States and pulses](03-states-and-pulses.md), [04 Layers and layout](04-layers-and-layout.md) | Tab bars, a modal with a backdrop, a toast that hides itself, screens that lay themselves out |
| 2 | Your prototypes work but don't feel right yet | [05 Springs and feel](05-springs-and-feel.md), [06 Gestures](06-gestures.md), then [13 Knobs and presets](13-knobs-and-presets.md) | Bottom sheets, drag and snap, long-press menus, pull to refresh, collapsing headers, and a tuned version to compare with the shipped one |
| 3 | You want whole flows, not single interactions | [07 Loops](07-loops.md), [08 Components and variables](08-components-and-variables.md) | Feeds, carousels with page dots, photo grids, stories, onboarding |
| 4 | You build for other people and it has to hold up | [09 Debugging](09-debugging.md), plus [handoff to engineers](05-springs-and-feel.md#handoff-to-engineers) in 05 | Anything, backed by traces, performance checks and exact numbers for engineers |

Three guides fit at any level:

- [10 Coming from Origami](10-coming-from-origami.md) maps Origami Studio's names, patches and shortcuts to Sonobe, and lists the few places where Sonobe behaves differently on purpose.
- [11 Working with Claude](11-working-with-claude.md) shows how to connect Claude Desktop or Claude Code to Sonobe with your own Claude plan, and has prompt recipes for every level.
- [12 Importing designs](12-importing-designs.md) brings screens from your running app, from HTML, or through Claude onto the canvas as real layers, so you prototype with your actual design.

Not sure where to start? Start at 01. It takes five minutes, and if it all feels familiar you've only spent five minutes.

## Words you'll see everywhere

| Word | What it means |
|---|---|
| Layer | Something you can see, like a rectangle, some text, an image or a group. |
| Patch | A small machine with one job, like "remember on or off" or "animate toward a number". |
| Port | A patch's inputs (left side) and outputs (right side). |
| Cable | A connection from an output to an input. Values flow along it from left to right. |
| State | A value that stays put until something changes it. "The sheet is open." |
| Pulse | A signal that's true for exactly one frame. "The card was just tapped." |
| Frame | One tick of the prototype. There are 60 a second, or 120 on fast displays. |
| Loop | A list of values moving along one cable, like six card positions at once. |
| Component | A reusable piece made of layers, patches or both. |
| Viewer | The live prototype. It keeps running while you edit. |

## A note on names

Patch names in these guides match the patch picker, like Pop Animation or Option Switch. The picker also searches aliases and port names, so typing "spring" finds Pop Animation too.

Some guides show a prototype as text, in the outline format Sonobe and Claude use to describe a graph. Those snippets are illustrative. You never have to type them.

## Learning with Claude

Claude can build a prototype for you in seconds. That's useful, and it can also skip the part where you learn. A few habits keep you driving:

- Ask Claude to explain before it builds. "Which patches would you use for this, and why?"
- Use teach mode. "Tell me the next single step. Wait for me to do it, then check my work."
- Ask it to prove things work. Claude can simulate taps and drags and read values frame by frame, so "it should work" turns into "here's the trace."
- Undo freely. Each change Claude makes lands in your history as one labeled entry, and a single undo removes it.

[Guide 11](11-working-with-claude.md) covers setup and has prompts for each level.

## Try it

1. Find your row in the level table. Be honest, then open that level's first guide.
2. Skim the "Common mistakes" at the end of the guides one level below yours. If any of them surprise you, go back a level.
3. Once you've built the card in guide 01, connect Claude (guide 11) and ask it to explain your graph back to you.

## Common mistakes

- Reading without building. You'll recognize the ideas, but you won't be able to use them.
- Skipping guide 03. Mixing up pulses and states causes more confusing bugs early on than anything else.
- Copying graphs you can't explain. If you can't read a graph out loud as a sentence, changing it will be painful.
- Tuning the feel before the flow works. Get the behavior right first, then make it feel good.
