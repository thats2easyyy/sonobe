# Stories

Three travel stories that play on their own, five seconds each. Bars at the top fill as each story plays: full for stories you've seen, filling for the current one, empty for the rest. Tap the right side to skip ahead, the left side to go back. After the last story it wraps to the first.

Level 3 · Guides: [03 States and pulses](../../docs/guides/03-states-and-pulses.md), [07 Loops](../../docs/guides/07-loops.md)

## What you'll learn

- Using a Counter with Maximum Count for "which story", wrapping in both directions.
- Merging two pulses (a tap and a timer) with Or.
- Restarting a timer whenever a state changes, with Pulse on Change.
- A loop of layers for the progress bars, with one Math Expression deciding every bar's fill.
- Invisible tap zones with Hit Area layers.

## Build it step by step

1. **One story layer.** Add a full-screen Group named Story (`story`) with a sun Oval, a hill, a title and a caption inside. Add a Loop (`stories`, Count 3) and Loop Builders for the colors (`story_colors`), sun colors (`story_accents`), titles (`story_titles`) and captions (`story_captions`), into those layers. Story now repeats three times, stacked.
2. **Bars.** Add two Rectangles: Bar Track (`segment_track`, 35% white) and Bar Fill (`segment_fill`, white). Add a Grid Layout (`segment_grid`) with Index from `stories.index`, Columns 3, Origin `[12, 64]`, Width 378, Item Height 3 and Spacing 6, into both bars' Position and the track's Size. Each bar is 122 points wide.
3. **Tap zones.** Add two Hit Areas on top: `tap_zone_back` covering the left third, and `tap_zone_forward` covering the rest. Add an Interaction on each (`tap_back`, `tap_forward`).
4. **The timer.** Add a Wait (`story_timer`, 5 s).
5. **Which story.** Add an Or (`next_story`) of `tap_forward.tap` and `story_timer.finished`. Add a Counter (`current_story`, Maximum Count 3) with Increase from the Or and Decrease from `tap_back.tap`.
6. **Restart the timer.** Add a Pulse on Change (`story_changed`) watching `current_story.count`, and When Prototype Starts (`started`). Or them together (`start_timer`) into the Wait's Start.
7. **Show the current story.** Add Equals (`story_is_current`) comparing `stories.index` with the count, a Classic Animation (`story_fade`, 0.25 s), and connect it to the Story's Opacity.
8. **Fill the bars.** Add a Math Expression (`segment_fill_amount`) with `clamp(story + progress - index, 0, 1)`. Connect the count to `story`, `story_timer.progress` to `progress`, and `stories.index` to `index`. Multiply (`fill_width`) by 122, pack it with a Size (`fill_size`, height 3), and connect that to the Bar Fill's Size.

## The patch chain

```text
Tap Right Side ──tap──────┐
                          ├─ Tap or Time Up (Or) ──▶ Increase ┐
Story Timer ──finished────┘                                   ├─ Current Story (Counter, max 3) ──count──┬─▶ Story Changed ─┐
Tap Left Side ──tap──────────────────────────────▶ Decrease ──┘                                          │                  ├─ Start or Story Changed (Or) ──▶ Story Timer · Start
                                                                  Prototype Starts ────────────────────────────────────────┘
                                                                                                          │
Stories (loop ×3) ─index─┬─▶ Is Current Story ◀────────────────────────────────────────────────────────────┤
                         │        └─▶ Story Fade ──▶ Story · Opacity (×3)                                  │
                         ├─▶ Bar Positions (Grid Layout) ──▶ Bar Track · Bar Fill · Position               │
                         └─▶ Bar Fill Amount: clamp(story + progress − index, 0, 1) ◀── count, Story Timer · progress
                                  └─▶ Fill Width (× 122) ──▶ Fill Size ──▶ Bar Fill · Size (×3)
```

| Patch | Type | Its one job |
|---|---|---|
| `stories` | Loop | Indices 0, 1, 2 for the story copies and the bars. |
| `tap_back`, `tap_forward` | Interaction | Listen on the two invisible Hit Areas. |
| `story_timer` | Wait | Five seconds per story. Progress runs 0 → 1, and Finished pulses at the end. |
| `next_story` | Or | Either a tap on the right or time running out moves forward. |
| `current_story` | Counter | The story number, wrapping 2 → 0 forward and 0 → 2 back. |
| `story_changed`, `started`, `start_timer` | Pulse on Change, When Prototype Starts, Or | Restart the timer at launch and whenever the story changes. |
| `story_is_current`, `story_fade` | Equals, Classic Animation | Per copy: fade in if current, out otherwise. |
| `segment_grid` | Grid Layout | Three bars across the top. |
| `segment_fill_amount`, `fill_width`, `fill_size` | Math Expression, Multiply, Size | Per bar: full, filling, or empty. |

How the fill works. With story 1 showing and its timer at 0.3:

| Bar index | story + progress − index | Clamped |
|---|---|---|
| 0 | 1 + 0.3 − 0 = 1.3 | 1 (full) |
| 1 | 1 + 0.3 − 1 = 0.3 | 0.3 (filling) |
| 2 | 1 + 0.3 − 2 = −0.7 | 0 (empty) |

The timer and the counter feed each other: the timer finishing changes the count, and the count changing restarts the timer. Sonobe reads one cable of that loop from the previous frame, and the diagnostics panel notes it as information. The Or patches show a pulse-into-state warning even though merging pulses is what Or is for.

## Check it

`test.json` checks that the first bar is half full at 2.5 seconds and that story 1 takes over after five. It also checks that a right-side tap fills bar 0 and restarts the timer, that a left-side tap goes back and empties bar 1, and that three taps wrap to story 0.

```sh
npx vitest run examples/run.test.ts -t 13-stories
```

## Variations

- **Hold to pause.** Add an Interaction on a full-screen Hit Area and turn the Wait off while Down is on. A Stopwatch with Stop and Start works better, because Wait always restarts from zero.
- **Stop at the end.** Remove Maximum Count, and turn a "done" Switch on when the count reaches 3.
- **Different durations.** Feed Duration from an Option Picker on the count, for example 3, 5 and 8 seconds.
- **Swipe down to close.** Add a Swipe patch on the story (Axis Vertical) and spring a scale and y when it pulses Swiped Down.

## Common mistakes

- **Restarting the timer from the tap only.** Then auto-advance doesn't restart it, and the second story skips instantly. Restart on any change of the count.
- **Bar fills from Transitions.** A Transition per bar needs different logic for seen, current and upcoming bars. The clamp expression handles all three.
- **Tap zones under the story.** The Hit Areas have to be in front, and the story's decorative layers have Receives Touches off.
- **Maximum Count 2 for three stories.** Maximum Count is how many values the count cycles through (0, 1, 2), not the highest value.
