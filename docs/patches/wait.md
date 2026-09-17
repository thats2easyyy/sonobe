<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Wait

Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.

| | |
|---|---|
| Type key | `wait` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | timer, countdown, wait timer, timeout, after seconds, one shot timer, sleep, settimeout |

## How it works
Wait is a timer. A pulse (a signal that's on for one frame) on **Start** begins counting; once **Duration** seconds pass, **Done** turns on and stays on.

- **Start** begins the timer from zero. Pulsing it again while the timer runs starts over.
- **Reset** stops the timer and turns Done off without starting anything.
- **Duration** is how long to wait, in seconds.
- **Done** is off while counting and turns on when time's up. It stays on until the next Start or Reset.
- **Progress** runs from 0 to 1 while the timer counts, then holds at 1.
- **Finished** sends a pulse at the moment the timer completes.

## Tips
- Build a timed sequence from one Start: several Waits wired to the same pulse run side by side, each counting from that pulse.
- Wire Progress into a Transition to draw a story bar or countdown ring.
- Use Finished when you need an event, and Done when you need a state.
- When you want an existing state change to happen later, Delay is the better fit.

## Coming from Origami
Origami's Wait has a single unnamed output; here it's Done, and it behaves the same way. Progress, Finished, and Reset are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Start**<br>`start` | `pulse` | — | Pulse to start the timer from zero. Pulsing while it runs starts over. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to stop the timer and turn Done off without starting it again. |
| **Duration**<br>`duration` | `number` (duration) | `1` | How long to wait after Start, in seconds. 0 finishes on the same frame. At least 0, step 0.1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Done**<br>`done` | `boolean` | Off while the timer counts; turns on when Duration has passed and stays on until the next Start or Reset. |
| **Progress**<br>`progress` | `number` (progress) | 0 when the timer starts, rising to 1 when it finishes, then holding at 1. 0 while idle. |
| **Finished**<br>`finished` | `pulse` | Pulses once, on the frame the timer completes. |

## Examples

### Hide a toast 3 seconds after it appears

The same tap shows the toast and starts the timer; Finished turns it off.

```text
layer button rectangle "Button" @16,640 370x56
layer toast rectangle "Toast" @16,740 370x56 opacity←fade.output
patch tap_button interaction layer=@button
patch visible switch turnOn←tap_button.tap turnOff←timer.finished
patch timer wait start←tap_button.tap duration=3
patch fade popAnimation number←visible.on bounciness=0 speed=12
```

### Hold to confirm

Pressing starts the timer and releasing resets it. The glow fills in with Progress, and a check pops in once the hold completes.

```text
layer confirm_button rectangle "Confirm Button" @16,700 370x64
layer confirm_glow rectangle "Confirm Glow" @16,700 370x64 opacity←hold_timer.progress
layer done_check oval "Done Check" @171,600 60x60 scale←check_pop.output
patch press interaction layer=@confirm_button
patch release pulse on←press.down
patch hold_timer wait start←press.down reset←release.turnedOff duration=1.5
patch check_pop popAnimation number←hold_timer.done
```

## Common mistakes

- The toast never hides again: Done stays on after the timer finishes, until the next Start or Reset. Wire Finished into the Switch's Turn Off, or pulse Reset.
- Later steps come too late: each Wait counts from its own Start. When several Waits share one Start pulse, set each Duration to the total time from that pulse (1, 3, 6 seconds), not the gap between steps.
- Wait never finishes: Start receives a pulse every frame, for example from Pulse on Change on a moving value, and every Start restarts the timer. Send Start from a one-time event.

## Pairs well with

- [When Prototype Starts](whenPrototypeStarts.md): Sends one pulse on the prototype's first frame, and again each time the prototype restarts.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Wait (`builtin.waittimer`)

| Sonobe port | Origami label |
|---|---|
| `done` | Output |
