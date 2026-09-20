# Coming from Origami

Any level · for Origami Studio users · Next: [11 Working with Claude](11-working-with-claude.md)

## What you'll be able to do

- Bring your Origami Studio knowledge into Sonobe in an afternoon.
- Find the Sonobe name for a patch, panel or shortcut you already know.
- Know the few places where Sonobe behaves differently on purpose, so they don't catch you out.

Origami Studio is Meta's free, macOS-only prototyping tool. Many of the ideas Sonobe is built on were popularized by Origami and the Quartz Composer toolkit before it: patch graphs, the ISAT pattern, pulses, loops, and springs you tune with Bounciness and Speed. If you know Origami, you already know most of Sonobe.

Sonobe is a separate, open-source project with no affiliation to Meta. It doesn't use Origami's code, files or assets. Its behavior was reimplemented from public documentation and observed behavior, and where this guide describes Origami, it's based on Origami's public docs and release notes (through version 228).

## What stays the same

- Values flow left to right. An input takes one cable, and an output can feed many.
- ISAT is still the core pattern: Interaction, Switch, Animation, Transition.
- A pulse lasts one frame. A state wired into a pulse input fires on its rising edge. Pulses can fire on back-to-back frames, which matches Origami since version 187.
- Loops count from 0. Looped patches keep state per index, looped layers replicate, and a component input either loops the component or passes the loop in.
- Pop Animation's Bounciness and Speed use the same Rebound conversion math, so numbers from an Origami file give you the same curve.
- Layer Info reads layout one frame later.
- A layer needs to be enabled and have opacity above 0 to receive touches. Touches bubble to parent groups, and a tap requires a finger that didn't move.

## Concepts and panels

| Origami | Sonobe | Notes |
|---|---|---|
| Canvas, Layer List, Inspector, Viewer, Patch Editor | Canvas, Layers, Inspector, Viewer, Patch Editor | Plus side drawers for Learn and Assistant, and a bottom HUD with Console, Diagnostics, AI Activity and Performance tabs |
| Patch Library / patch picker | Patch picker | Double-click or ⌥⏎. Searches names, aliases and port names, with docs in the picker |
| Touch button on a layer row | Touch button on a layer row | Inserts a pre-wired interaction |
| Blue layer property patch | Drag a cable onto an inspector property or a layer row | Clicking an inspector property also makes it a link target |
| Layer component, patch component | Layer component, patch component | ⌃⌘G |
| Publish Port, purple and blue port patches | Published inputs and outputs | Published inputs appear in the inspector on each instance |
| Loop Behavior | Loop the component, or pass the loop in | Chosen per input |
| Connect a loop to a group's property to repeat it | The same, or the layer's Repeat property | Repeat takes a number or a loop, and it alone decides how many copies. Guide 07 |
| Variable Broadcaster and Receiver (formerly Wireless) | Variable Broadcaster and Receiver | |
| Comment | Comment frame | |
| Tidy Up | Tidy Up | ⌃T |
| Port flashing, value popovers | Orbs along cables, state glow, "×N" loop badges, live values on hover | |
| Origami Live on iOS | Web player on your local network, or the Sonobe Viewer iPhone app | Scan the QR code with any phone's camera. Works on iOS and Android. For haptics on an iPhone, scan it in Sonobe Viewer ([apps/ios](../../apps/ios/README.md)) |
| Masks | Clip Contents on a group, Corner Radius on images | Sonobe v1 has no alpha mask layer |
| JavaScript Patch (Hermes) | JavaScript patch, stored as a real `.js` file in the project | The script API is different, so scripts need porting |
| Shader Layer (SkSL) | Shader layer (GLSL ES 3.0, ShaderToy-style `mainImage`) | Shader code needs porting |
| `.origami` file | `.sonobe` project folder | See "File format" below |

## Patches

Sonobe keeps Origami's patch names wherever a patch does the same job, so search the picker for the name you know.

| Origami | Sonobe | Notes |
|---|---|---|
| Interaction | Interaction | Down, Tap, Position, Local Position and Force. For finger speed, use Gesture's or Drag's Velocity |
| Switch, Option Switch, Option Picker, Counter | Same names | Same-frame precedence is documented (see below) |
| Pulse, Pulse on Change, When Prototype Starts | Same names | |
| Delay, Wait | Same names | |
| Delay 1 | Delay One Frame | Search "delay 1" to find it. It's the documented way to close a feedback loop |
| Pop Animation, Classic Animation, Spring Animation | Same names | Spring Animation supports gesture velocity handoff |
| Spring Converter | Spring Converter | Converts response and damping fraction into Spring Animation's Tension and Friction and Pop Animation's Bounciness and Speed. A spring patch's inspector also has presets, a live curve and handoff code |
| Transition, Progress, Reverse Progress | Same names | Transition doesn't clamp, as in Origami |
| Scroll, Drag, Gesture, Hover, Keyboard, Long Press | Same names | Momentum uses the same decay model, with an end bound of 99999 by default |
| Pop Switch | Pop Switch | Swipes or pinches between two states, then springs to the nearer one. Guide 06 also builds a snapping drag from Gesture and Spring Animation |
| Hit Area | Hit Area layer, or Hit Slop on any layer | |
| Loop, Loop Builder, Loop Select, Loop Option Switch | Same names | Guide 07 |

## Shortcuts

| Action | Origami | Sonobe |
|---|---|---|
| Insert a patch | ⌥⏎ or double-click | ⌥⏎ or double-click |
| Insert Interaction, Switch, Pop, Classic, Transition, Delay | I, S, A, C, T, D | I, S, A, C, T, D, with the pointer over the canvas |
| Restart the prototype | ⌘R | ⌘R |
| Tidy Up | ⌃T | ⌃T |
| Create a component | ⌃⌘G | ⌃⌘G |
| Enter or exit a component | ⌥↓ / ⌥↑ | Double-click / ⌥↑ |
| Connect one output to many inputs | Shift-click the inputs | Shift-click the inputs |
| Duplicate with input connections | ⌥-drag | ⌥-drag |
| Splice a patch into a cable | ⌘-drag the patch onto the cable | Same. The cable glows while you hover, and a chooser opens when several ports fit |
| Cut cables | Drag a cable's end off its input | ⌃ right-drag across cables (knife) |
| Nudge a number | ↑↓, ⇧ for ±10, ⌥ for ±0.1 | Same, plus drag to scrub |
| Find any other command | Menus | ⌘K opens the command palette, which lists every command with its shortcut |

On Windows and Linux, the command palette shows the Ctrl and Alt versions of these shortcuts.

## Deliberate differences

### Coordinates

Origami measures from the center of the parent, and layers default to a center anchor. Sonobe measures Position from the parent's top-left corner, with Y going down. Anchor defaults to top-left, like Figma, and pivot defaults to the center.

To convert by hand, keep the anchor at the center and add half the parent's size. A layer at `0, 280` in Origami on a 402 × 874 screen becomes Position `201, 717` with Anchor `0.5, 0.5`. Importers do this conversion for you. Guide 04 has more examples.

### Where a tap landed

In Origami, Interaction's Position resets on the same frame Tap fires, so graphs that need the tap location use a Delay 1. In Sonobe, Position still holds where the finger lifted on the Tap frame. You can drop that delay.

### The first frame

Sonobe evaluates the graph with your authored values on the very first frame. Patches that compare with the previous frame, like Velocity, Delay One Frame, Pulse on Change and Smooth Value, start from that first value. There's no one-frame velocity spike at restart, so the workaround patches some Origami files use at frame 0 aren't needed.

### Same-frame precedence

When several pulses land on one frame, Sonobe documents the order. For Switch, Turn Off beats Turn On, and Turn On beats Flip. For Counter, Jump beats Increase and Decrease.

### Loop length mismatches

When loops of different lengths meet, the output takes the longest length and shorter loops wrap around. Diagnostics warns you when lengths differ, and only notes it when the longer one is a whole multiple of the shorter, as with stripes.

### File format

An Origami file is a zip archive containing a binary graph. Origami added Copy-Paste As JSON and a command-line converter to JSON in version 221.

A Sonobe project is a folder of plain, formatted JSON:

```
Checkout Flow.sonobe/
├── project.json          name, device, root component
├── components/
│   ├── main.json         the prototype
│   └── like_button.json  one file per component
├── scripts/              JavaScript patches as real .js files
└── assets/               media, named by content hash
```

Keys are written in a fixed order, and each connection sits on one line, stored on the input it drives. Ids are readable names like `tap_card`, and they never change, even when you rename things. A change to one connection shows up in version control as a change to one line.

### Importing Origami files

Sonobe doesn't read `.origami` files directly. Each Sonobe patch declares which Origami patch it corresponds to, so an importer can translate graphs, and Origami's own JSON export is the natural input for that. Check the release notes for importer status. Until then, rebuild by hand using the tables above, or describe the interaction to Claude and let it rebuild the graph.

### Platforms and license

Sonobe runs on macOS, Windows and Linux, and it's MIT licensed. Prototypes preview on any phone through the web player.

### AI

Origami's recent versions (221 and 223) can generate the code inside a JavaScript patch or a Shader layer with a language model. Sonobe opens the whole document to Claude through MCP, including layers, patches, simulation and history. Claude can build graphs, simulate taps and explain what a graph does. It runs through Claude Desktop or Claude Code on your own Claude plan, and every change lands in your undo history. Guide 11 covers setup.

## A first afternoon

1. Build the tap-to-grow card from guide 01. It takes ten minutes, and the muscle memory mostly carries over.
2. Read the coordinates section of guide 04.
3. Skim "How to see them in Sonobe" in guide 03. Orbs and glow replace squinting at port popovers.
4. Rebuild one of your own Origami prototypes, using the patch table.
5. Connect Claude (guide 11) and ask it to explain your rebuilt graph. Check whether its explanation matches your intent.

## Try it

1. Convert an Origami layer at `−100, −300` with a center anchor, on a 402 × 874 screen, to Sonobe coordinates. The answer is `101, 137` with Anchor `0.5, 0.5`.
2. Find an Origami graph of yours that uses Delay 1 to read where a tap landed, rebuild it in Sonobe, and leave the delay out.
3. Copy Pop Animation numbers from an Origami prototype into Sonobe, and compare the curves side by side.
4. Open `components/main.json` in a text editor and find the line that connects your Interaction to your Switch.
5. Press ⌘K and find three commands you used to dig through menus for.

## Common mistakes

- Typing center-origin coordinates into Sonobe's Position fields, and wondering why everything slides to the bottom right.
- Keeping Origami's frame-zero and tap-position workarounds. They're harmless, but confusing to the next person who reads the graph.
- Looking for a mask layer. Use Clip Contents on a group, or Corner Radius on an image.
- Pasting JavaScript patch or SkSL shader code without porting it to Sonobe's APIs.
- Expecting hover to work on a phone. Phones have no hover, in Origami Live or in Sonobe's web player.
