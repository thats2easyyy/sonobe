# Scrolling List

A message inbox that scrolls. Drag it and it follows your finger. Flick it and it glides, slows down, and stops at the last message. Pull past the top and it stretches, then springs back. The header gains a shadow as messages slide under it, and after you've scrolled far a Back to Top button slides up.

Level 1 · Guides: [04 Layers and layout](../../docs/guides/04-layers-and-layout.md), [06 Gestures](../../docs/guides/06-gestures.md)

## What you'll learn

- The two-layer scroll setup: a clipped window, and content that moves inside it.
- What Scroll gives you for free: momentum, rubber banding, and bounds from the content's size.
- Scroll-linked effects with Progress and Transition, and why they don't need an animation patch.
- Jumping the scroll position from a button with Jump to Y.

## Build it step by step

1. **The window.** Add a Group named Window (`window`) at `[0, 150]`, 402 × 724, with Clip Contents on. That's the part of the screen the list shows through.
2. **The content.** Inside the window, add a Group named Content (`content`), 402 × 1264, and put 16 message rows in it, 76 points apart. The content's height is what tells Scroll how far it can go.
3. **Scroll it.** Add a Scroll patch (`inbox_scroll`) with Layer set to Content and Scroll Y set to Free. Connect `inbox_scroll.position` to the Content's Position. That's a working scroll view.
4. **The header.** Add a Header group (`header`) above the window: 402 × 150, canvas colored, with a shadow at Opacity 0 and Receives Touches off.
5. **Lift the header.** Add a Progress (`header_lift`) from `inbox_scroll.y`, Start 0, End −24, Clamp to Range on. Then a Transition (`header_shadow`) from 0 to 0.14 into the header's Shadow Opacity. The shadow grows over the first 24 points of scrolling and stays put after that.
6. **Back to Top.** Add a dark pill (`top_button`) off screen at y 940. Add Less Than (`scrolled_far`) comparing `inbox_scroll.y` with −400, a Pop Animation (`top_button_spring`), and a point Transition (`top_button_position`) from `[201, 940]` to `[201, 800]` into its Position.
7. **Jump home.** Add an Interaction (`tap_top`) on the pill and connect `tap_top.tap` to `inbox_scroll.jumpToY`. Jump Position Y is already 0, the top, and Jump Style Y is Animated.

## The patch chain

```text
Scroll Inbox ──position──▶ Content · Position
     │
     ├──y──▶ Header Lift (0 → −24, clamped) ──▶ Header Shadow (0 → 0.14) ──▶ Header · Shadow Opacity
     │
     └──y──▶ Scrolled Far (y < −400) ──▶ Back to Top Spring ──▶ Back to Top Position ──▶ Back to Top · Position

Tap Back to Top ──tap──▶ Scroll Inbox · Jump to Y   (glides to y = 0)
```

| Patch | Type | Its one job |
|---|---|---|
| `inbox_scroll` | Scroll | Turns drags, flicks and the mouse wheel on Content into a position, with momentum and rubber banding. The visible window is Content's parent. |
| `header_lift` | Progress | Turns "scrolled 0 to 24 points" into 0…1. Clamp to Range keeps it at 1 once you're past. |
| `header_shadow` | Transition | Turns that progress into a shadow opacity. |
| `scrolled_far` | Less Than | On while the list is scrolled more than 400 points. |
| `top_button_spring`, `top_button_position` | Pop Animation, Transition | Slide the button in and out. |
| `tap_top` | Interaction | Pulses Jump to Y, which glides the scroll back to the top. |

Why no animation patch on the header? The finger already moves the value smoothly, frame by frame. Adding a spring would only make the shadow lag behind the content.

## Check it

`test.json` drags slowly and checks the content moved with the finger. It flicks and checks the list glides to exactly −540 (724 visible points minus 1264 of content) and settles. It pulls down at the top and checks the rubber band returns to 0, and it taps Back to Top after a flick.

```sh
npx vitest run examples/run.test.ts -t 03-scrolling-list
```

## Variations

- **Shorter glides.** Set Deceleration Rate to Fast on `inbox_scroll`.
- **Hard stops.** Turn Rubber Band off. The list stops dead at the edges.
- **Hide the header while scrolling down.** Feed `inbox_scroll.y` into a Velocity patch, and turn a Switch on when it's below −300 and off when it's above 300. Spring the header's y from that Switch.
- **Horizontal list.** Set Scroll X to Free and Scroll Y to Off, and lay the rows out in a row.
- **Real rows.** Put the row in a layer component and repeat it with a loop (see `examples/15-grid-with-loops`).

## Common mistakes

- **Pointing Scroll at the window instead of the content.** Scroll moves its Layer inside that layer's parent. Point it at the thing that moves.
- **Forgetting Clip Contents on the window.** The list scrolls, but rows draw over the header and past the bottom.
- **Content that hugs its rows but has no height.** Scroll measures the content layer's size. If it's too short, there's nothing to scroll.
- **A header that catches touches.** Here the header has Receives Touches off. Otherwise drags that start on it wouldn't reach the list underneath.
