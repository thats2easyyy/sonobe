<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Repeating Pulse

Sends a pulse over and over at a steady interval, like a metronome.

| | |
|---|---|
| Type key | `repeatingPulse` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | metronome, interval, setinterval, ticker, heartbeat, repeat every, clock tick, loop timer |

## How it works
Repeating Pulse is a metronome. Every **Interval** seconds it sends a pulse (a signal that's on for one frame) out of **Tick**. The first tick comes one interval after the patch starts, not right away.

- **Enabled** pauses the ticking while off. When it's turned back on, ticking continues where it left off.
- **Interval** is the time between ticks, in seconds. Anything shorter than one frame, including 0, ticks every frame.
- **Reset** (an advanced port) restarts the countdown, so the next tick comes one full interval later.

## Tips
- Auto-advance a carousel: wire Tick into a Counter's Increase. Pulse Reset when the person swipes by hand so the next advance doesn't come too soon.
- Blink a text cursor: wire Tick into a Switch's Flip with an Interval of 0.5.
- Need a tick at startup too? Add When Prototype Starts.
- For smooth back-and-forth motion instead of events, use Repeating Animation.

## Coming from Origami
Origami calls the interval Frequency, but it has always meant seconds between pulses, so Sonobe names it Interval. Enabled and Reset are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, the patch ticks. When off, it pauses and keeps its place in the current interval. |
| **Interval**<br>`interval` | `number` (duration) | `1` | Seconds between ticks. Values shorter than one frame, including 0, tick every frame. At least 0, step 0.1. |
| **Reset**<br>`reset` | `pulse` · advanced | — | Pulse to restart the countdown so the next tick comes one full interval later. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Tick**<br>`tick` | `pulse` | Pulses once every Interval seconds, starting one interval after the patch begins. |

## Examples

### Blink a text cursor

```text
layer caret rectangle "Caret" @40,200 2x24 opacity←blink.on
patch ticker repeatingPulse interval=0.5
patch blink switch flip←ticker.tick
```

### Make a heart beat every 1.2 seconds

Each tick is stretched into a short on state, which pops the heart up and back.

```text
layer heart oval "Heart" @171,400 60x60 scale←beat_scale.output
patch beat repeatingPulse interval=1.2
patch beat_on delay<boolean> value←beat.tick duration=0.15 style=whenDecreasing
patch beat_pop popAnimation number←beat_on.output bounciness=12 speed=20
patch beat_scale transition<number> progress←beat_pop.output start=1 end=1.2
```

## Common mistakes

- Ticks start a beat late: the first tick comes one Interval after the patch starts. Add When Prototype Starts if you also need a tick right away.
- Setting Interval to 2 to get two pulses a second: Interval is seconds between ticks, so 2 means one tick every 2 seconds. Use 0.5 for two per second.
- The carousel advances right after a manual swipe: the countdown kept running. Pulse Reset when the person interacts so the next advance waits a full Interval.

## Pairs well with

- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [When Prototype Starts](whenPrototypeStarts.md): Sends one pulse on the prototype's first frame, and again each time the prototype restarts.
- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Repeating Pulse (`builtin.repeatingpulse`)
- **Also imports:** `builtin.repeatingPulse`

| Sonobe port | Origami label |
|---|---|
| `interval` | Frequency |
| `tick` | Output |
