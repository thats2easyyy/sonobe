<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Progress

Converts a number from any range into progress, where Start gives 0 and End gives 1.

| | |
|---|---|
| Type key | `progress` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>Shift</kbd>+<kbd>R</kbd> |
| Search terms | normalize, inverse lerp, convert range, map range, percent complete, range to progress, unlerp |

## How it works
Progress measures how far **Value** is between **Start** and **End**. At Start it outputs 0, at End it outputs 1, and halfway between it outputs 0.5. It's the opposite of Transition.

- **Value** is the number to measure, like a scroll offset, a drag distance, or a sound level.
- **Start** and **End** define the range. They can be reversed (End smaller than Start) to count the other way.
- **Clamp to Range** keeps the output between 0 and 1. It's off by default, so values past the range keep going (Value past End gives more than 1).

## Tips
- Progress into Transition remaps any range onto any other: scroll 0–200 points into header opacity 1–0.
- Turn on Clamp to Range for scroll- and drag-linked effects so nothing overshoots when people pull past the edge.
- When Start equals End, the output jumps from 0 to 1 as Value reaches Start, like a threshold.

## Coming from Origami
Start and End are Origami's Start Value and End Value. Clamp to Range is new and off by default, which matches Origami. When Start equals End, Origami divides by 0.0001 instead of acting as a threshold.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `number` | `0` | The number to measure against the range. |
| **Start**<br>`start` | `number` | `0` | The value that gives progress 0. |
| **End**<br>`end` | `number` | `1` | The value that gives progress 1. |
| **Clamp to Range**<br>`clampToRange` | `boolean` | `false` | When on, the output stays between 0 and 1 even if Value is outside the range. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | Where Value sits in the range: 0 at Start, 1 at End, and beyond 0–1 outside the range unless Clamp to Range is on. |

## Examples

### Drag along a track to fill a bar

The touch's x position becomes 0–1 progress, which a size Transition turns into the bar width.

```text
layer track rectangle "Track" @16,400 370x8
layer fill rectangle "Fill" @16,400 0x8 size←bar.output
patch touch_track interaction layer=@track
patch amount progress value←touch_track.position start=16 end=386 clampToRange=true
patch bar transition<size> progress←amount.progress start=[0,8] end=[370,8]
```

## Common mistakes

- The header fades past fully transparent and reappears, or scales the wrong way, when you pull past the edge: Progress keeps going below 0 and above 1. Turn on Clamp to Range, or add a Clamp patch.
- The output is always 0 or 1: Start and End are equal, so the range has no width and acts as a threshold. Give End a different value.

## Pairs well with

- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.
- [Reverse Progress](reverseProgress.md): Flips a progress value so 0 becomes 1 and 1 becomes 0, for animations that run the opposite way.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Progress (`builtin.progress`)

| Sonobe port | Origami label |
|---|---|
| `start` | Start Value |
| `end` | End Value |
