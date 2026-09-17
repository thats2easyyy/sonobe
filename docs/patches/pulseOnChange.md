<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Pulse on Change

Sends a pulse whenever a watched value changes, such as a new page number or a different tab.

| | |
|---|---|
| Type key | `pulseOnChange` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | on change, value changed, change detector, watch value, trigger on change, did change, changed |

## How it works
Pulse on Change compares **Value** with what it was on the previous frame. On every frame they differ, **Changed** sends a pulse (a signal that lasts one frame).

- When the prototype starts, it only remembers the first value, so starting doesn't count as a change.
- Setting Value to what it already is doesn't fire.
- A value that keeps moving, like an animation's output, fires on every frame it moves.

Change the patch's type to watch text, colors, points, JSON, and more.

## Tips
- Restart a timer or an animation whenever a Counter or Option Switch moves to a new step.
- Watch the value a Switch or Counter sets, not an animation's output, to get one pulse per change.
- Numbers compare exactly, so 0.1 + 0.2 counts as different from 0.3. Round first if tiny differences shouldn't count.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to watch. Its type follows the patch's type, and any difference from the previous frame counts. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Changed**<br>`changed` | `pulse` | Pulses for one frame on every frame Value differs from the frame before. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`.

## Examples

### Restart a story timer when the page changes

```text
layer story rectangle "Story" @0,0 390x844
layer progress_bar rectangle "Progress" @16,60 size←bar_size.output
patch tap_story interaction layer=@story
patch page counter increase←tap_story.tap maximumCount=5
patch page_changed pulseOnChange<number> value←page.count
patch story_timer wait start←page_changed.changed duration=5
patch bar_size transition<size> progress←story_timer.progress start=[0,4] end=[358,4]
```

### Reload a feed when the tab changes

```text
layer tab_new rectangle "New Tab" @16,790 170x44
layer tab_top rectangle "Top Tab" @204,790 170x44
patch tap_new interaction layer=@tab_new
patch tap_top interaction layer=@tab_top
patch tab optionSwitch[2] setTo0←tap_new.tap setTo1←tap_top.tap
patch tab_changed pulseOnChange<index> value←tab.option
patch feed_url optionPicker<text>[2] option←tab.option option0="https://example.com/new.json" option1="https://example.com/top.json"
patch feed networkRequest request←tab_changed.changed url←feed_url.output
```

## Common mistakes

- It fires on every frame of an animation: the watched value is still moving. Watch the value that sets the target, such as a Switch or Counter, instead of the animation's output.
- Tapping the tab that's already selected doesn't fire: only differences count. Use the tap pulse itself when every tap should count.
- Nothing fires at launch: the first value is only remembered. Use When Prototype Starts to act at launch.

## Pairs well with

- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Pulse on Change (`builtin.pulseonchange`)
- **Also imports:** `builtin.pulseOnChange`

| Sonobe port | Origami label |
|---|---|
| `changed` | Output |
