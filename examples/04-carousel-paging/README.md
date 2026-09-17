# Carousel Paging

Trip cards you swipe through one at a time. The current card sits in the middle and its neighbors peek in at the edges. However hard you fling, it moves one card. The page dots stretch to show where you are, the price below changes, and a Next button jumps ahead.

Level 2–3 · Guides: [06 Gestures](../../docs/guides/06-gestures.md), [07 Loops](../../docs/guides/07-loops.md)

## What you'll learn

- Paging scroll: Page Size, Page Padding, and a Start Position that centers the first page.
- Using the page number Scroll reports to drive dots, text and other state.
- Making page dots from a single layer and a loop.
- Jumping a scroll programmatically with Jump to X and a Math Expression.

## Build it step by step

1. **The cards.** Add a Group named Cards (`cards`) with Layout set to Row and Spacing 12, and four 320 × 480 trip cards inside it. Put it in a Carousel group (`carousel`), 402 wide, at y 176.
2. **Center the first card.** The screen is 402 wide and a card is 320, so the first card's left edge belongs at (402 − 320) ÷ 2 = 41. Set the Cards Position to `[41, 0]`.
3. **Page it.** Add a Scroll patch (`trips_scroll`) on Cards with Scroll X Paging and Scroll Y Off. Set Start Position to `[41, 0]`, Page Size to `[320, 480]` and Page Padding to `[12, 0]`. Connect `trips_scroll.position` to the Cards' Position. One page is 320 + 12 = 332 points, and page *n* puts the cards at x = 41 − 332*n*.
4. **One dot, repeated.** Add an Oval named Page Dot (`dot`) with Anchor `[0.5, 0.5]`. Add a Loop (`page_dots`) with Count 4, a Math Expression (`dot_x`) with `171 + index * 20`, and a Point (`dot_position`) with y 700 into the dot's Position. The dot now repeats four times, 20 points apart.
5. **Stretch the current dot.** Add Equals (`dot_is_current`) comparing `page_dots.index` with `trips_scroll.pageX`. Feed it into a Pop Animation (`dot_spring`, Bounciness 0, Speed 18), then a size Transition (`dot_size`, 8 × 8 → 22 × 8) and a color Transition (`dot_color`, 35% white → white) into the dot. Each copy runs its own Equals and its own spring.
6. **The price.** Add an Option Picker (`trip_price`, text, 4 options) with Option from `trips_scroll.pageX`, into the price text (`price`).
7. **Next.** Add an Interaction (`tap_next`) on the Next button (`next_button`). Add a Math Expression (`next_page_x`) with `41 - clamp(page + 1, 0, 3) * 332`, fed by `trips_scroll.pageX`, into Jump Position X. Connect `tap_next.tap` to Jump to X.

## The patch chain

```text
Scroll Trips ──position──▶ Cards · Position
     │
     └──pageX──┬──▶ Dot Is Current Page ◀── Page Dots (index 0…3)
               │         └──▶ Dot Spring ──▶ Dot Size · Dot Color ──▶ Page Dot (×4)
               │
               ├──▶ Trip Price ("$1,240", "$980", …) ──▶ Price · Text
               │
               └──▶ Next Page X (41 − (page + 1) × 332) ──▶ Scroll Trips · Jump Position X
Tap Next ──tap──▶ Scroll Trips · Jump to X
```

| Patch | Type | Its one job |
|---|---|---|
| `trips_scroll` | Scroll | Pages one card at a time and reports `pageX`, the page number. A fling moves at most one page. |
| `page_dots` | Loop | Makes the indices 0, 1, 2, 3, so everything fed by it runs four times. |
| `dot_x`, `dot_position` | Math Expression, Point | Space the dot copies 20 points apart. |
| `dot_is_current` | Equals | Per copy: is this dot the current page? |
| `dot_spring`, `dot_size`, `dot_color` | Pop Animation, Transition | Stretch and brighten the current dot, and shrink the others. |
| `trip_price` | Option Picker | Picks the price for the page number. |
| `tap_next`, `next_page_x` | Interaction, Math Expression | Work out the next page's x and jump there. |

`next_page_x` reads the page from Scroll Trips and feeds back into it, so the graph has a small loop. That's fine: Sonobe reads one cable of the loop from the previous frame, and the diagnostics panel notes it as information.

## Check it

`test.json` swipes left and checks page 1 at x −291 with the second dot stretched. It checks that a slow nudge snaps back to 41, that a huge fling still moves one page, that swiping right on the first card rubber-bands, and that two taps on Next reach page 2 and Lisbon's price.

```sh
npx vitest run examples/run.test.ts -t 04-carousel-paging
```

## Variations

- **Full-width pages.** Leave Page Size at `[0, 0]`, Page Padding at 0, and cards 402 wide. Each page is the window.
- **Let flings travel.** Paging always moves one page per fling. For free scrolling that snaps, use Scroll X Free and snap the release with Snap (Mode Step, Step 332), like the bottom sheet does.
- **Scale the side cards.** Feed `trips_scroll.x` and each card's index into a Math Expression that measures how far the card is from the center, then map that to a scale of 0.92…1.
- **Previous button.** Copy Next with `41 - clamp(page - 1, 0, 3) * 332`.
- **Loop around.** On the last page, Next could jump to 41 instead. Use an If Else on Equals(pageX, 3).

## Common mistakes

- **Start Position 0.** The first card hugs the left edge and every page is off by 41 points. Start Position is where the content sits at page 0.
- **Page Size equal to the card but no Page Padding.** Pages drift by 12 points per card, because a page is a card plus its gap.
- **Wiring `pageX` straight into a Transition for the dots.** A page number isn't 0…1. Compare it with each dot's index instead.
- **Dots sitting on top of each other.** A looped layer repeats in place. Every copy needs its own position from the loop.
