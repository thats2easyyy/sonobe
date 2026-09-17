<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Stopwatch

Measures elapsed seconds that you can start, pause, and reset with pulses.

| | |
|---|---|
| Type key | `stopwatch` |
| Category | [State & Time](README.md#state--time) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | timer, elapsed time, stop watch, pause and resume, chronometer, lap timer, count up |

## How it works
Stopwatch counts seconds while it runs. It begins stopped, at 0.

- **Start** begins counting, or resumes after a pause. It does nothing while already running.
- **Stop** pauses. Time stays where it is until you start again or reset.
- **Reset** sets Time back to 0 without changing whether the stopwatch is running.
- **Time** is the running time in seconds, with fractions. Paused time doesn't count.
- **Running** is on while the stopwatch counts.

If Start and Stop arrive in the same frame, Stop wins. Reset can arrive together with either one: Reset plus Start begins again from 0.

## Tips
- Wire the same press into Start and Reset to time each press from 0.
- Wire Time into Progress (Start 0, End your length) and then into Transition for a timeline you can pause.
- Wire Time into Format Date & Time to show it as minutes and seconds.
- Need a countdown that tells you when it's over? Use Wait.

## Coming from Origami
Running is new, and Sonobe defines what happens when Start, Stop, and Reset arrive in the same frame.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Start**<br>`start` | `pulse` | — | Pulse to start counting, or to resume after a Stop. Does nothing while running. |
| **Stop**<br>`stop` | `pulse` | — | Pulse to pause. Time holds its value until the next Start or Reset. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to set Time back to 0. It doesn't start or stop the stopwatch. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Time**<br>`time` | `number` (duration) | Running time in seconds, not counting paused time. |
| **Running**<br>`running` | `boolean` | True while the stopwatch is counting. |

## Examples

### Hold to record, up to 15 seconds

Each press restarts the stopwatch from 0 and releasing pauses it. The meter fills over 15 seconds.

```text
layer record_button oval "Record Button" @161,720 80x80
layer record_meter rectangle "Record Meter" @16,80 370x8 opacity←meter.progress
patch press interaction layer=@record_button
patch release pulse on←press.down
patch recording stopwatch start←press.down stop←release.turnedOff reset←press.down
patch meter progress value←recording.time start=0 end=15
```

### Play and pause a timer with one button

```text
layer play_button oval "Play Button" @171,720 60x60
layer timer_label text "Timer Label" @16,120 text←watch_clock.time
patch tap_play interaction layer=@play_button
patch playing switch flip←tap_play.tap
patch edges pulse on←playing.on
patch watch_clock stopwatch start←edges.turnedOn stop←edges.turnedOff
```

## Common mistakes

- One tap wired into both Start and Stop never starts the stopwatch: Stop wins when both arrive in the same frame. Wire the tap into a Switch's Flip, then use a Pulse patch's Turned On and Turned Off for Start and Stop.
- Time picks up where it left off instead of starting over: Stop pauses and Start resumes. Pulse Reset together with Start to begin again from 0.

## Pairs well with

- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Format Date & Time](formatDateTime.md): Turns seconds into readable text: a clock time, a date, a media timestamp like 2:05, or your own % pattern.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Stopwatch (`builtin.stopwatch`)
- **Also imports:** `origami.stopwatch`
