# Examples

Fifteen runnable prototypes, from a single tap to a deck of swipeable cards. Each folder is a Sonobe project you can open in the app (Learn → Examples) or read with the CLI, and Claude reads them through the MCP tools `list_examples` and `get_example`. Each one comes with a step-by-step README and a `test.json` that simulates the interaction and checks the numbers.

| # | Example | You'll learn | Key patches |
|---|---|---|---|
| 01 | [Tap to Grow](01-tap-to-grow/) | ISAT: Interaction → Switch → Animation → Transition | Interaction, Switch, Pop Animation, Transition |
| 02 | [Like Toggle](02-like-toggle/) | Flip vs Turn On, counts from states, SVG icons | Double Tap, Switch, Format Number, SVG Path Shape |
| 03 | [Scrolling List](03-scrolling-list/) | Clipped windows, momentum, scroll-linked effects | Scroll, Progress, Less Than |
| 04 | [Carousel Paging](04-carousel-paging/) | Paging scroll, page dots from a loop, jumping pages | Scroll (paging), Loop, Equals, Math Expression |
| 05 | [Tab Bar](05-tab-bar/) | More than two states | Option Switch, Option Picker, Pop Animation |
| 06 | [Collapsing Header](06-collapsing-header/) | One progress driving many properties | Scroll, Progress, Transition |
| 07 | [Pull to Refresh](07-pull-to-refresh/) | Logic with states, a state that lasts a while | Scroll, And, Switch, Wait, Repeating Animation |
| 08 | [Bottom Sheet](08-bottom-sheet/) | Following the finger, fling projection, velocity handoff | Gesture, Snap, Counter, Spring Animation, Delay One Frame |
| 09 | [Drag and Snap](09-drag-and-snap/) | The same chain in 2D | Gesture, Snap (points), Spring Animation (point) |
| 10 | [Swipe Cards](10-swipe-cards/) | Per-copy state with loops, throws, deck depth | Loop, Swipe, Gesture, Loop Sum, Spring Animation |
| 11 | [Long-Press Menu](11-long-press-menu/) | Hold feedback, Turn On and Turn Off | Long Press, Switch, Classic Animation |
| 12 | [Timed Sequence](12-timed-sequence/) | Scheduling stages, drawing strokes, replay | When Prototype Starts, Wait, Classic Animation, Restart Prototype |
| 13 | [Stories](13-stories/) | Timers that restart, merging pulses, fill bars from math | Counter, Or, Pulse on Change, Wait, Math Expression |
| 14 | [Onboarding](14-onboarding/) | Steps in order, keeping counts in bounds | Counter, Delay One Frame, Swipe, If / Else |
| 15 | [Grid with Loops](15-grid-with-loops/) | One layer, many copies | Loop, Grid Layout, HSL Color, Delay, Loop Option Switch |

Start at 01. Examples 01, 02, 05, 11 and 12 need nothing but taps, and 03, 06 and 07 add scrolling. Examples 08, 09 and 10 are the gesture-heavy ones, and 10, 13 and 15 lean on loops.

## Folder layout

```text
examples/
├── 01-tap-to-grow/        a project folder: project.json, components/, assets/, README.md, test.json
├── …
├── recipes/               the ops that build each project (the source of truth)
├── lib/                   design kit, recipe builder, scenario runner
├── build.ts               regenerates the project folders from recipes/
└── run.test.ts            loads every example and runs its scenarios
```

The project files are generated. To change an example, edit its recipe in `recipes/` and rebuild. README.md and test.json are written by hand. A new example goes in `recipes/index.ts` and gets a row in the table above: `list_examples` shows its "You'll learn" and "Key patches" columns (patch names as the patch library spells them).

```sh
node examples/build.ts                    # regenerate every project
node examples/build.ts 08-bottom-sheet    # one project
node examples/build.ts --check            # exit 1 if a project on disk differs from its recipe
npx vitest run examples                   # load, validate and simulate every example
```

## Reading an example from the command line

```sh
node packages/cli/src/main.ts outline examples/08-bottom-sheet
node packages/cli/src/main.ts validate examples/08-bottom-sheet
```

## test.json

A test file lists scenarios. Each scenario starts a fresh deterministic simulation, plays its events (the same shapes `sim_dispatch` takes), traces every target frame by frame, and checks expectations against the trace.

```json
{
  "description": "What the scenarios cover.",
  "scenarios": [
    {
      "name": "A fast downward flick collapses the sheet",
      "events": [{ "kind": "drag", "from": "@grabber", "to": [201, 640], "durationMs": 100, "atMs": 100 }],
      "durationMs": 1500,
      "expect": [
        { "description": "The sheet settles collapsed", "target": "@sheet.position", "component": "y", "at": "end", "op": "==", "value": 760, "tolerance": 0.5 },
        { "description": "It comes to rest", "target": "@sheet.position", "component": "y", "settled": true }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `target` | A value address: `patchId.port` or `@layerId.prop`, with `#n` for one loop copy (`@card.position#2`). |
| `component` | One part of a vector or color: `x`, `y`, `width`, `height`, `r`, `g`, `b`, `a`, or an index. |
| `at` | Which sample: `end` (default), `start`, `min`, `max`, or milliseconds after the scenario starts. |
| `op`, `value`, `tolerance` | The comparison. `==` and `!=` on numbers allow ±0.001 unless you set a tolerance. Booleans read as 1 and 0 for `min` and `max`. |
| `settled`, `settlesWithinMs` | The value stopped moving before the end, or within a time. |

A scenario fails if any expectation fails, if a touch misses its target or lands on a layer nobody listens to, or if the runtime reports an issue. Events are replayed in segments that start when their input fires, so a tap on a button that only appears halfway through is judged against the scene at that moment.
