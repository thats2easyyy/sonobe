<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Delay

Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.

| | |
|---|---|
| Type key | `delay` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>D</kbd> |
| Search terms | wait then change, debounce, lag, hold for, extend pulse, postpone, latency, settimeout |

## How it works
Delay passes a value through, but late: when the input changes, the output makes the same change **Duration** seconds later. Changes replay in order, so a quick on, off, on plays back the same way.

- **Value** is what you want to delay. Right-click the patch to change its type (number, boolean, color, position, and more).
- **Duration** is how long each change waits, in seconds. 0 passes changes straight through.
- **Style** picks which changes wait:
  - **Always** delays every change.
  - **When Increasing** delays rises (off to on, or a bigger number) and lets falls through at once. A fall also cancels a rise that's still waiting, so the output turns on only if the input stays on for the whole Duration.
  - **When Decreasing** lets rises through at once and delays falls. Wire in a pulse (a signal that's on for one frame) to stretch it into an "on" state that lasts Duration.
- Increasing and decreasing only mean something for numbers and booleans. Other types always behave like Always.

## Tips
- Stagger a list: feed a loop of durations (0, 0.05, 0.1, and so on) so each item starts a little later.
- Need a timer that starts on a pulse and reports progress? Use Wait.

## Coming from Origami
Duration uses the prototype clock instead of counting frames, so delays match at 60 and 120 fps. The output starts at the input's first value, and its port is Output instead of Value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to delay. Its type follows the patch's type, which is number by default. |
| **Duration**<br>`duration` | `number` (duration) | `0.5` | How long each change waits before it reaches the output, in seconds. 0 passes changes through right away. At least 0, step 0.1. |
| **Style**<br>`style` | `enum` | `always` | Which changes wait: all of them, only rises, or only falls. Types other than numbers and booleans treat every option as Always. |

**Style options**

- **Always** (`always`): Every change waits Duration.
- **When Increasing** (`whenIncreasing`): Rises wait; falls pass through at once and cancel waiting rises. Numbers and booleans only.
- **When Decreasing** (`whenDecreasing`): Falls wait; rises pass through at once and cancel waiting falls. Numbers and booleans only.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The value as it was Duration seconds ago, following the chosen Style. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Show a toast for 2 seconds after a tap

When Decreasing stretches the one-frame Tap pulse into a 2-second on state.

```text
layer button rectangle "Button" @16,640 370x56
layer toast rectangle "Toast" @16,740 370x56 opacity←fade.output
patch tap_button interaction layer=@button
patch hold delay<boolean> value←tap_button.tap duration=2 style=whenDecreasing
patch fade popAnimation number←hold.output bounciness=0 speed=12
```

### Show a tooltip after hovering for half a second

When Increasing waits before showing the tooltip, and moving away hides it at once.

```text
layer info_icon oval "Info Icon" @300,120 24x24
layer tooltip rectangle "Tooltip" @180,152 200x44 opacity←show.output
patch hover_icon hover layer=@info_icon
patch intent delay<boolean> value←hover_icon.hovering duration=0.5 style=whenIncreasing
patch show popAnimation number←intent.output bounciness=0 speed=14
```

## Common mistakes

- The delayed layer still flashes on after a quick press: with Style set to Always, the release replays later too. Use When Increasing so a release passes straight through and cancels the waiting press.
- A tap through Delay shows only a one-frame blip: a pulse is on for a single frame, and Always replays it as-is. Use When Decreasing to stretch the pulse into a state that lasts Duration.
- List items all animate at once: every item shares one Duration. Feed a loop of durations so later items wait longer.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Hover](hover.md): Reports whether the mouse pointer is over a layer and where it is, for hover highlights and tooltips on desktop.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Delay (`builtin.delay`)

| Sonobe port | Origami label |
|---|---|
| `output` | Value |
