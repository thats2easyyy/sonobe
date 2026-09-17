# Onboarding

Three onboarding pages: Plan together, Share the moment, Stay in sync. Tap Next or swipe to move between them, or tap Skip to jump to the end. Page dots show where you are. On the last page Next becomes Get started, Skip fades away, and tapping it finishes onboarding with a welcome screen.

Level 1–2 · Guides: [02 ISAT](../../docs/guides/02-isat.md), [03 States and pulses](../../docs/guides/03-states-and-pulses.md)

## What you'll learn

- A Counter for steps in order: Increase, Decrease, and Jump.
- Keeping the count in bounds by enabling inputs instead of clamping afterwards.
- Reading "what was true last frame" with Delay One Frame, so one tap can't do two things.
- Relabeling a button with If Else, and hiding a button by fading it to 0.
- Two Interactions on the same button that do different things depending on the page.

## Build it step by step

1. **Pages.** Add a Group named Pages (`pages`), 1206 × 874 with Layout Row, holding three 402-wide pages. Each page has an illustration, a title and a body text.
2. **Controls.** Add a Hit Area (`swipe_area`) over the page content, a Skip button (`skip_button`) at the top right, a Page Dot (`dot`), a Next button (`next_button`) with a label (`next_label`), and a hidden Welcome group (`welcome`) at Opacity 0.
3. **The page.** Add a Counter (`page`).
4. **Look back one frame.** Add a Delay One Frame (`page_last_frame`) on `page.count`. Add Equals patches for "was on the last page" (`was_last_page`, = 2) and "was on the first page" (`was_first_page`, = 0), and Nots for `can_go_forward` and `can_go_back`.
5. **Inputs.**
   - `tap_next`: an Interaction on Next, enabled by `can_go_forward.output`.
   - `tap_get_started`: another Interaction on Next, enabled by `was_last_page.output`.
   - `tap_skip`: an Interaction on Skip.
   - Two Swipes on the swipe area (Axis Horizontal, Min Distance 60, Min Velocity 400): `swipe_forward`, enabled by `can_go_forward`, and `swipe_back`, enabled by `can_go_back`.
6. **Count.** Add an Or (`go_forward`) of `tap_next.tap` and `swipe_forward.swipedLeft` into the Counter's Increase. Connect `swipe_back.swipedRight` to Decrease, and `tap_skip.tap` to Jump with Jump to Number 2.
7. **Slide.** Add a Multiply (`pages_x`: count × −402), a Pop Animation (`pages_spring`, Bounciness 2, Speed 13), and a Point (`pages_position`) into the Pages' Position.
8. **The last page.** Add Equals (`on_last_page`) on the count. Add an If Else (`button_label`, text: "Get started" or "Next") into the label. Add a Not (`skip_visible`) and a Classic Animation (`skip_fade`, 0.2 s) into Skip's Opacity.
9. **Finish.** Add a Switch (`onboarding_done`) turned on by `tap_get_started.tap`, and a Classic Animation (`welcome_fade`, 0.35 s) into the Welcome's Opacity.
10. **Dots.** Add a Loop (`page_dots`, 3), a Math Expression (`dot_x`: `177 + index * 24`), a Point (`dot_position`), Equals (`dot_is_current`), a Pop Animation (`dot_spring`), and Transitions for size (`dot_size`) and color (`dot_color`).

## The patch chain

```text
Current Page ──count──▶ Page Last Frame ──▶ Was On Last Page ──┬─▶ Can Go Forward (Not) ──▶ Tap Next · Enabled, Swipe to Next · Enabled
                                        └─▶ Was On First Page ─┼─▶ Can Go Back (Not) ─────▶ Swipe to Previous · Enabled
                                                               └─▶ Tap Get Started · Enabled

Tap Next ──tap───────────┐
                         ├─ Next or Swipe Left (Or) ──▶ Current Page · Increase
Swipe to Next ─left──────┘
Swipe to Previous ─right──────────────────────────────▶ Current Page · Decrease
Tap Skip ──tap────────────────────────────────────────▶ Current Page · Jump (to 2)

Current Page ──count──┬─▶ Pages X (× −402) ──▶ Pages Spring ──▶ Pages Position ──▶ Pages · Position
                      ├─▶ On Last Page ──┬─▶ Button Label ("Get started" / "Next") ──▶ Next Label · Text
                      │                  └─▶ Skip Visible (Not) ──▶ Skip Fade ──▶ Skip · Opacity
                      └─▶ Dot Is Current Page (×3) ──▶ Dot Spring ──▶ Dot Size · Dot Color ──▶ Page Dot

Tap Get Started ──tap──▶ Onboarding Done ──▶ Welcome Fade ──▶ Welcome · Opacity
```

| Patch | Type | Its one job |
|---|---|---|
| `page` | Counter | The page number. Increase, Decrease, or Jump to 2. |
| `page_last_frame` | Delay One Frame | The page number on the previous frame. |
| `was_last_page`, `was_first_page`, `can_go_forward`, `can_go_back` | Equals, Not | Which inputs are live right now. |
| `tap_next`, `tap_get_started` | Interaction | Two listeners on one button, never enabled at the same time. |
| `swipe_forward`, `swipe_back` | Swipe | Horizontal swipes, each enabled only when it can move. |
| `go_forward` | Or | Next or a left swipe both move forward. |
| `tap_skip` | Interaction | Jumps to the last page. |
| `pages_x`, `pages_spring`, `pages_position` | Multiply, Pop Animation, Point | Turn the page number into a position and slide there. |
| `on_last_page`, `button_label`, `skip_visible`, `skip_fade` | Equals, If Else, Not, Classic Animation | Last-page looks: the label and Skip. |
| `onboarding_done`, `welcome_fade` | Switch, Classic Animation | Finish and show the welcome screen. |
| `page_dots`, `dot_x`, `dot_position`, `dot_is_current`, `dot_spring`, `dot_size`, `dot_color` | Loop and friends | The three page dots from one layer. |

### Why look back one frame?

Tap Next on the second page and the count becomes 2, the last page, on that same frame. If Tap Get Started read the new page number, the same tap would also count as Get started, and onboarding would end the moment you arrived. Enabling it from Page Last Frame means it only listens once you're already on the last page.

## Check it

`test.json` checks that two Next taps reach page 2 at x −804 with "Get started" and Skip hidden, and that the second tap doesn't finish onboarding. A third tap finishes it and shows the welcome screen. Swiping left then right returns to page 0, a right swipe on page 0 does nothing, and Skip jumps to the last page.

```sh
npx vitest run examples/run.test.ts -t 14-onboarding
```

## Variations

- **Back button.** Add an Interaction on a Back button, enabled by `can_go_back`, into Decrease. Decrease has one input, so Or it with the right swipe.
- **Parallax.** Move each page's illustration by a different amount from `pages_spring.output`, so the art lags behind the text.
- **Progress bar instead of dots.** Feed Pages Spring into a Progress from 0 to −804, and connect it to a bar's width.
- **Remember finished onboarding.** Skip the whole flow when a variable says it's done.

## Common mistakes

- **Letting the count go out of bounds and clamping later.** Swipe right on page 0 three times, and then it takes three left swipes to get anywhere. Disable the input instead.
- **Enabling Get started from `on_last_page`.** The tap that reaches the last page also finishes onboarding. Use the previous frame's page.
- **Two buttons stacked for Next and Get started.** It works, but the same button with two listeners is simpler, and the label has one home.
- **Hiding Skip with Enabled off.** Enabled hides it instantly. A fade reads better, and at Opacity 0 it can't be tapped anyway.
