# Pull to Refresh

An activity feed you pull down to refresh. As you pull, a spinner arc draws in above the list. Let go past 64 points and the list holds a little lower while the spinner spins, a pretend request runs for 1.6 seconds, and then the list slides back up with "Updated just now". Let go before 64 points and it just springs back.

Level 1–2 · Guides: [03 States and pulses](../../docs/guides/03-states-and-pulses.md), [06 Gestures](../../docs/guides/06-gestures.md)

## What you'll learn

- Reading the rubber band: Scroll's `y` goes above 0 when you pull past the top.
- Detecting "let go while pulled far enough" with states, so nothing depends on a single frame.
- A Switch turned on by one thing and off by a Wait: a state that lasts a while.
- Holding the list down with a spacer added on top of the scroll position.
- A spinner from a circle shape, Stroke End and a Repeating Animation.

## Build it step by step

1. **Layers.** Add a clipped Window group (`window`) under a 130-point header. Inside the window, first a Shape named Spinner (`spinner`): 28 × 28, indigo stroke 3, clear fill, Stroke End 0, Opacity 0. Then the Feed (`content`) with 16 activity cards. The spinner is behind the feed, so pulling reveals it. The header's status line is `subtitle`.
2. **Scroll.** Add a Scroll patch (`feed_scroll`) on the feed, with Scroll Y Free.
3. **How far pulled.** Add a Progress (`pull_amount`) from `feed_scroll.y`, 0 → 64, clamped.
4. **Decide.** Add a Not (`not_dragging`) on `feed_scroll.dragging`, a Greater Than or Equal (`pulled_far`) comparing `feed_scroll.y` with 64, and an And (`start_refresh`) of the two. And turns on at the moment the finger lifts while the list is still pulled past 64.
5. **Refreshing.** Add a Switch (`refreshing`) with Turn On from `start_refresh.output`. Add a Wait (`refresh_timer`, 1.6 s) started by `refreshing.on`, and connect its Finished to the Switch's Turn Off.
6. **Hold the list down.** Add a Pop Animation (`spacer_spring`, Bounciness 0, Speed 14) on `refreshing.on` and a Transition (`spacer_height`, 0 → 64). Add `feed_scroll.y` and the spacer with an Add (`content_y`), pack it with a Point (`content_position`), and connect that to the feed's Position instead of the scroll's position.
7. **The spinner.** Add a Circle Shape (`spinner_shape`, center `[14, 14]`, radius 11) into the spinner's Shape. Add a Max (`spinner_reveal`) of `pull_amount.progress` and `spacer_spring.output` into its Opacity, and a Transition (`spinner_arc`, 0 → 0.8) into Stroke End. Add a Repeating Animation (`spin`, 0.9 s, Linear, Mirrored off) enabled by `refreshing.on`, and a Transition (`spinner_rotation`, 0 → 360) into Rotation.
8. **Status.** Add a Counter (`refresh_count`) increased by `refresh_timer.finished`, Greater Than (`has_refreshed`) comparing it with 0, and an If Else (`status_text`, text) into the status line.

## The patch chain

```text
Scroll Feed ──y──┬─▶ Pull Amount (0 → 64) ─────────────────────────▶ Spinner Reveal ─▶ Spinner · Opacity, Spinner Arc ─▶ Stroke End
                 ├─▶ Pulled Far Enough (y ≥ 64) ─┐
   dragging ─▶ Not Dragging ────────────────────┴─▶ Let Go Past Threshold (And) ──▶ Refreshing · Turn On
                 │
                 └─▶ Content Y (y + spacer) ─▶ Content Position ─▶ Feed · Position

Refreshing ──on──┬─▶ Pretend Network Request (Wait 1.6 s) ──finished──┬─▶ Refreshing · Turn Off
                 │                                                    └─▶ Refresh Count ─▶ Has Refreshed ─▶ Status Text
                 ├─▶ Spacer Spring ─▶ Spacer Height (0 → 64) ─▶ Content Y
                 └─▶ Spin (enabled) ─▶ Spinner Rotation (0 → 360) ─▶ Spinner · Rotation
```

| Patch | Type | Its one job |
|---|---|---|
| `feed_scroll` | Scroll | Scrolls the feed. Pulling past the top rubber-bands, so `y` goes above 0. |
| `pull_amount` | Progress | How close the pull is to the threshold, 0…1. |
| `not_dragging`, `pulled_far`, `start_refresh` | Not, Greater Than or Equal, And | On exactly when the finger is up and the list is still past 64 points. |
| `refreshing` | Switch | On while "loading". |
| `refresh_timer` | Wait | Turns Refreshing off 1.6 seconds after it turned on. In a real app this is the network request. |
| `spacer_spring`, `spacer_height`, `content_y`, `content_position` | Pop Animation, Transition, Add, Point | Keep the feed 64 points down while refreshing, on top of whatever the scroll is doing. |
| `spinner_shape`, `spinner_reveal`, `spinner_arc`, `spin`, `spinner_rotation` | Circle Shape, Max, Transition, Repeating Animation | Draw the arc in while pulling, keep it visible and spinning while refreshing. |
| `refresh_count`, `has_refreshed`, `status_text` | Counter, Greater Than, If Else | Change the status text after the first refresh. |

Refreshing and the Wait form a small loop (the Switch starts the Wait, and the Wait stops the Switch). Sonobe reads one of those cables from the previous frame, which is invisible at 60 frames a second, and the diagnostics panel lists it as information.

## Check it

`test.json` pulls 280 points and lets go, then checks that Refreshing turns on, the feed is held 64 points down, and the spinner is visible and spinning. At 3.6 seconds the feed is back at 0 and the status says "Updated just now". A small 80-point pull and a normal upward scroll never refresh.

```sh
npx vitest run examples/run.test.ts -t 07-pull-to-refresh
```

## Variations

- **Real loading.** Replace the Wait with a Network Request patch, and turn Refreshing off from its Done output.
- **Haptic tick at the threshold.** Feed `pulled_far.output` into a Haptic patch's play input, so the phone ticks when letting go would refresh.
- **Show new items.** Increase a counter on Finished and add a row whose height springs open from 0.
- **Bigger threshold for big screens.** Change 64 in `pulled_far`, `pull_amount` and `spacer_height` together.

## Common mistakes

- **Checking "let go" with the finger's pulse alone.** A pulse is true for a single frame. Combining states (not dragging and pulled far) is sturdier and reads as a sentence.
- **Connecting Scroll Feed's position straight to the feed.** Then nothing can hold the list down while refreshing. Add the spacer first.
- **A spinner in front of the feed.** It would catch the touches meant for the list. Put it behind, or turn Receives Touches off.
- **Opacity from a bouncy spring.** The spinner's opacity uses Max of two 0…1 values, so it never flickers past 1.
