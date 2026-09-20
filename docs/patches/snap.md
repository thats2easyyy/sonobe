<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Snap

Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels.

| | |
|---|---|
| Type key | `snap` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | snap to grid, snap to points, nearest, quantize, paging, detents, notches, magnet |

## How it works
Snap works like a magnet: it moves a value to the nearest allowed spot. Use it for grids, carousel pages, and places a card should settle.

- **Value** is the number or position to snap.
- **Mode** picks the spots. **Step** uses evenly spaced values: Offset, Offset + Step, Offset + 2 × Step, and so on. **Points** uses the closest value in the **Points** loop.
- **Velocity** (points per second) lets a flick carry the value further before it snaps, the way a flicked carousel lands on a later page. Leave it at 0 to snap to what's nearest right now.
- **Output** is the snapped value, and **Index** says which spot won: the step number, or the position in Points (−1 if Points is empty).
- With the type set to Point, Step snaps each axis separately (a step of 0 leaves that axis free), and Points picks the closest point in a straight line.

## Tips
- Snap only on release: use If / Else to pass the raw position while the finger is down and Snap's output after, then feed a Spring Animation.
- **Deceleration** (advanced) matches Scroll's momentum. Normal carries a flick about half a second of travel and Fast about a tenth, the same projection as Swipe's Lookahead at 0.5 and 0.1.
- Keep the result in bounds with Clamp, such as between the first and last page.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The number or position to snap. |
| **Velocity**<br>`velocity` | `variant` (velocity) | `0` | Flick speed in points per second, used to predict where Value lands before snapping. 0 snaps to the nearest spot now. |
| **Mode**<br>`mode` | `enum` | `step` | Whether to snap to evenly spaced steps or to a list of points. |
| **Step**<br>`step` | `variant` | `100` | Space between snap spots in Step mode, in points. 0 turns snapping off for that axis. At least 0. |
| **Offset**<br>`offset` | `variant` | `0` | Where the first step sits in Step mode; spots are Offset + n × Step. |
| **Points**<br>`points` | `variant` · whole loop | loop `[0,100,200]` | The allowed spots in Points mode, as a loop. |
| **Deceleration**<br>`deceleration` | `enum` · advanced | `normal` | How far Velocity carries the value before snapping, matching Scroll's momentum settings. |

**Mode options**

- **Step** (`step`): Snap to evenly spaced values: Offset plus whole multiples of Step.
- **Points** (`points`): Snap to the closest value in the Points loop.

**Deceleration options**

- **Normal** (`normal`): Slows like a standard scroll fling (0.998 per millisecond).
- **Fast** (`fast`): Stops sooner, like a fast-decelerating scroll view (0.99 per millisecond).

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The snapped value. |
| **Index**<br>`index` | `index` | Which spot was chosen: the step number from Offset (negative below it), or the position in Points, or −1 when Points is empty. |
| **Projected**<br>`projected` | `variant` · advanced | Where Value would land from its velocity, before snapping. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`.

For other types, a port starts at its zero value unless listed here:

| Type | Port | Default |
|---|---|---|
| `point` | `step` | `[100, 100]` |

## Examples

### Drag a sticker on an 8-point grid

```text
layer sticker rectangle "Sticker" @104,304 88x88 cornerRadius=16 position←on_grid.output
patch move drag layer=@sticker
patch on_grid snap<point> value←move.position step=[8,8]
```

### Show which card a carousel is on

Cards are 300 pt apart. The scroll position's x goes negative as you scroll, so take its absolute value; Index is the page number from 0.

```text
layer strip group "Card Strip" @0,240 1500x320
layer page_label text "Page Label" @16,600 text←page.index
patch strip_scroll scroll layer=@strip
patch travel absoluteValue value←strip_scroll.position
patch page snap value←travel.output step=300
```

## Common mistakes

- The layer jumps between spots while you drag: Snap works every frame, not only on release. Pass the raw position while the finger is down (If / Else on Down) and the snapped position after.
- A flick flies several pages past where you expect: Velocity is in points per second, so a per-frame difference or a scaled value projects too far. Wire the Velocity patch's output, or set Deceleration to Fast.
- Points mode never snaps: the Points loop is empty, so Output passes the value through and Index is −1. Build the loop with Loop Builder.

## Pairs well with

- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.
- [Velocity](velocity.md): Measures how fast a value is changing, in units per second, by comparing it with the previous frame.
- [Spring Animation](springAnimation.md): Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
