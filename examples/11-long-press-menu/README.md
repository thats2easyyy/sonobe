# Long-Press Menu

A chat thread. Press and hold the message "Dinner at 8?" and the bubble squeezes under your finger. After 0.45 seconds the chat dims and a menu springs out below the message: Reply, Copy, Pin, Delete. A quick tap does nothing. Tap the backdrop or any action and the menu closes.

Level 1–2 · Guides: [03 States and pulses](../../docs/guides/03-states-and-pulses.md), [06 Gestures](../../docs/guides/06-gestures.md)

## What you'll learn

- Long Press: a state that turns on after holding still, plus a progress value while you hold.
- Feedback during the hold, so people can tell something is about to happen.
- Opening with Turn On and closing with Turn Off, from different gestures.
- Listening on a parent group so many layers close the same thing.
- Springs for scale, Classic Animation for fades.

## Build it step by step

1. **The chat.** A header, a few message bubbles with Receives Touches off, and a composer at the bottom.
2. **The overlay.** Add a full-screen Group named Overlay (`overlay`) at Opacity 0. Inside it, a dim Backdrop (`backdrop`, 35% dark with Background Blur 14) and a white Menu group (`menu`, 230 × 184, Pivot `[0, 0]`) with four rows (`menu_row_1` to `menu_row_4`). While the overlay is at Opacity 0 it can't receive touches, so it never gets in the way.
3. **The held message.** Add the message as its own group (`message`) *after* the overlay, so it stays sharp above the dimmed chat. Set its Pivot to `[0, 0.5]` so it squeezes toward its left edge.
4. **Hold.** Add a Long Press (`hold_message`) on the message with Duration 0.45.
5. **Squeeze while holding.** Add a Pop Animation (`squeeze_spring`, Bounciness 8, Speed 16) from `hold_message.progress`, and a Transition (`message_squeeze`, 1 → 0.94) into the message's Scale. The squeeze follows the hold, and bounces back on release.
6. **Open and close.** Add an Interaction on the overlay (`tap_overlay`). Add a Switch (`menu_open`) with Turn On from `hold_message.longPress` and Turn Off from `tap_overlay.tap`.
7. **Show the menu.** Add a Pop Animation (`menu_spring`, Bounciness 6, Speed 18) on `menu_open.on` and a Transition (`menu_scale`, 0.7 → 1) into the menu's Scale. Add a Classic Animation (`menu_fade`, 0.18 s, Cubic Out) on the same switch, into the overlay's Opacity.

## The patch chain

```text
Hold Message ──progress──▶ Squeeze Spring ──▶ Message Squeeze (1 → 0.94) ──▶ Held Message · Scale
     │
     └──longPress──▶ Turn On ─┐
                              ├─ Menu Open ──on──┬─▶ Menu Spring ──▶ Menu Scale (0.7 → 1) ──▶ Menu · Scale
Tap Outside or an Action ─▶ Turn Off ┘  (Switch) └─▶ Menu Fade (0.18 s) ─────────────────▶ Overlay · Opacity
```

| Patch | Type | Its one job |
|---|---|---|
| `hold_message` | Long Press | Progress 0 → 1 while held still, then Long Press turns on. A press that moves more than 10 points or lifts early never turns it on. |
| `squeeze_spring`, `message_squeeze` | Pop Animation, Transition | Squeeze the bubble as the hold progresses. |
| `menu_open` | Switch | Turn On from the long press, Turn Off from any tap on the overlay. |
| `tap_overlay` | Interaction | Listens on the overlay group. Taps on the backdrop and on every menu row bubble up to it. |
| `menu_spring`, `menu_scale` | Pop Animation, Transition | Spring the menu out from its top-left corner. |
| `menu_fade` | Classic Animation | Fade the overlay in and out in exactly 0.18 seconds, with no overshoot. |

Why Turn On and Turn Off instead of Flip? Holding again while the menu is open would flip it closed, and tapping outside while it's closed would open it. Turn On only opens and Turn Off only closes.

## Check it

`test.json` long-presses for 0.7 seconds and checks the menu is open at full scale, and that the bubble squeezed below 0.95 and returned to 1. A quick tap and a 0.25-second press never open it. After opening, a tap on the backdrop, or on Copy, closes it.

```sh
npx vitest run examples/run.test.ts -t 11-long-press-menu
```

## Variations

- **Haptics at the moment it opens.** Feed `hold_message.longPress` into a Haptic patch.
- **Different actions.** Add an Interaction per row and route each to its own behavior, for example Delete turning on a confirmation. Keep `tap_overlay` so any tap still closes the menu.
- **A reactions bar.** Add a row of emoji chips above the message, using the same spring and fade.
- **Hold to preview.** Skip the switch and wire `hold_message.longPress` straight into the spring, so the menu shows only while held.

## Common mistakes

- **Opening on `hold_message.progress`.** Progress rises during every press, including quick taps. Open on Long Press, which only turns on after the full duration.
- **An overlay with Opacity 0.001 "to keep it touchable".** Then it catches every tap on the chat. At Opacity 0 it can't receive touches, which is exactly what you want here.
- **Fading opacity with a bouncy spring.** Opacity past 1 flickers. Use Classic Animation for fades.
- **The held message under the overlay.** It would dim along with the rest. Put it after the overlay in the layer list.
