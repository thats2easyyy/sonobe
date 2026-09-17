<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Scroll

Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.

| | |
|---|---|
| Type key | `scroll` |
| Category | [Interaction](README.md#interaction) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | scroll view, scrolling list, carousel, paging, swipe pages, overscroll, rubber band, scroll settings, scroll y, scroll x |

## How it works
Scroll turns drags, flicks, and mouse-wheel scrolling on **Layer** into a **Position** for that layer. The layer's parent is the visible window: content bigger than the parent can scroll, and the parent's Clip Contents hides what's outside. Link Position into the content layer's Position.

- **Scroll X** and **Scroll Y** choose Off, Free (momentum and rubber banding), or Paging (snap page by page) for each direction.
- **Start Position** is where the content sits when it's scrolled all the way to the top-left.
- **X** and **Y** are the same position split into numbers, for scroll-linked effects like collapsing headers. They go negative as content moves up or left.
- **Page X** and **Page Y** count pages from 0.
- **Dragging** is true while a finger is scrolling; **Moving** stays true until the content settles.

Advanced inputs set the content size, page size and padding, direction locking, deceleration, rubber banding, and jumps (pulses that scroll to a position).

## Tips
- Put the content in a group sized to the visible area, with Clip Contents on.
- For cards narrower than the screen, set Page Size to the card size and Page Padding to the gap.

## Coming from Origami
Scroll Settings is built in as advanced inputs. Link Position instead of wiring X and Y into separate position fields. Sonobe adds Start Position, Rubber Band, Dragging, Moving, and mouse-wheel scrolling. Coordinates start at the parent's top-left with y down.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Layer**<br>`layer` | `layer` | none | The content layer to scroll; its parent layer is the visible window. |
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, drags and the mouse wheel scroll the content; when off, it holds still but jumps still work. |
| **Scroll X**<br>`scrollX` | `enum` | `off` | How the content scrolls horizontally. |
| **Scroll Y**<br>`scrollY` | `enum` | `free` | How the content scrolls vertically. |
| **Start Position**<br>`startPosition` | `point` (distance) | `[0, 0]` | The content layer's Position when it's scrolled to the very top-left, in its parent's points. |
| **Content Size**<br>`contentSize` | `size` (distance) · advanced | `[0, 0]` | Width and height of the scrollable content; 0 uses the content layer's measured size. |
| **Direction Locking**<br>`directionLocking` | `boolean` · advanced | `true` | When on, each touch scrolls only in the direction it started moving. |
| **Page Size**<br>`pageSize` | `size` (distance) · advanced | `[0, 0]` | Size of one page when paging, centered in the window; 0 uses the window's size. |
| **Page Padding**<br>`pagePadding` | `size` (distance) · advanced | `[0, 0]` | Gap between pages when paging, in points. At least 0. |
| **Deceleration Rate**<br>`decelerationRate` | `enum` · advanced | `normal` | How long a flick keeps gliding. |
| **Rubber Band**<br>`rubberBand` | `boolean` · advanced | `true` | When on, content stretches past its edges and springs back; when off, it stops hard at the edges. |
| **Jump Style X**<br>`jumpStyleX` | `enum` · advanced | `animated` | Whether Jump to X glides or moves instantly. |
| **Jump to X**<br>`jumpToX` | `pulse` · advanced | — | Pulse to scroll horizontally so X becomes Jump Position X. |
| **Jump Position X**<br>`jumpPositionX` | `number` (distance) · advanced | `0` | The X value to jump to, in the same units as the X output. |
| **Jump Style Y**<br>`jumpStyleY` | `enum` · advanced | `animated` | Whether Jump to Y glides or moves instantly. |
| **Jump to Y**<br>`jumpToY` | `pulse` · advanced | — | Pulse to scroll vertically so Y becomes Jump Position Y. |
| **Jump Position Y**<br>`jumpPositionY` | `number` (distance) · advanced | `0` | The Y value to jump to, in the same units as the Y output; use Start Position's y to scroll to the top. |

**Scroll X options**

- **Off** (`off`): No scrolling on this axis.
- **Free** (`free`): Scroll anywhere with momentum and rubber banding.
- **Paging** (`paging`): Snap to one page at a time, like a carousel.

**Scroll Y options**

- **Off** (`off`): No scrolling on this axis.
- **Free** (`free`): Scroll anywhere with momentum and rubber banding.
- **Paging** (`paging`): Snap to one page at a time, like a carousel.

**Deceleration Rate options**

- **Normal** (`normal`): Long, smooth glide (keeps 99.8% of velocity per millisecond).
- **Fast** (`fast`): Short glide (keeps 99% of velocity per millisecond).

**Jump Style X options**

- **Animated** (`animated`): Glide to the new position with a spring.
- **Instant** (`instant`): Move there immediately.

**Jump Style Y options**

- **Animated** (`animated`): Glide to the new position with a spring.
- **Instant** (`instant`): Move there immediately.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Position**<br>`position` | `point` (distance) | Where the content layer should be, in its parent's points; link it to the layer's Position. |
| **X**<br>`x` | `number` (distance) | The horizontal part of Position; decreases as content scrolls left. |
| **Y**<br>`y` | `number` (distance) | The vertical part of Position; decreases as content scrolls up and rises past Start Position when pulled down. |
| **Page X**<br>`pageX` | `index` | The current horizontal page, counted from 0. |
| **Page Y**<br>`pageY` | `index` | The current vertical page, counted from 0. |
| **Dragging**<br>`dragging` | `boolean` | True while a finger is scrolling the content. |
| **Moving**<br>`moving` | `boolean` | True while the content is dragged, gliding, springing back, or snapping to a page. |

## Examples

### Scroll a feed vertically

```text
layer feed_window group "Feed Window" @0,64 402x760 clip=true
  layer feed group "Feed" 402x2400 position←feed_scroll.position
patch feed_scroll scroll layer=@feed scrollY=free
```

### Page through cards with a page label

Five 275 pt cards with 10 pt gaps snap one at a time; Page X drives the label.

```text
layer carousel group "Carousel" @0,200 402x300 clip=true
  layer cards group "Cards" 1415x300 position←pager.position
layer page_label text "Page Label" @16,520 text←pager.pageX
patch pager scroll layer=@cards scrollX=paging scrollY=off pageSize=[275,300] pagePadding=[10,0]
```

## Common mistakes

- The content doesn't move: Scroll only computes a position. Link Position into the content layer's Position.
- It stretches but won't scroll: the content isn't bigger than its parent. Put the content inside a group sized to the visible area and turn on Clip Contents.
- Position has no effect inside a group with layout: relative children ignore Position. Set the content layer's Positioning to Absolute.

## Pairs well with

- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Scroll (`builtin.layer.scroll`)
- **Also imports:** `origami.scroll`, `builtin.layer.scroll.settings`, `origami.scroll.settings`

| Sonobe port | Origami label |
|---|---|
| `layer` | Content Layer |
| `enabled` | Enable |
| `contentSize` | Scroll Settings › Content Size |
| `directionLocking` | Scroll Settings › Direction Locking |
| `pageSize` | Scroll Settings › Page Size |
| `pagePadding` | Scroll Settings › Page Padding |
| `decelerationRate` | Scroll Settings › Deceleration Rate |
| `jumpStyleX` | Scroll Settings › Jump Style X |
| `jumpToX` | Scroll Settings › Jump to X |
| `jumpPositionX` | Scroll Settings › Jump Position X |
| `jumpStyleY` | Scroll Settings › Jump Style Y |
| `jumpToY` | Scroll Settings › Jump to Y |
| `jumpPositionY` | Scroll Settings › Jump Position Y |
