<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Restart Prototype

Restarts the whole prototype from its first frame when it gets a pulse, as if you pressed Restart in the viewer.

| | |
|---|---|
| Type key | `restartPrototype` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | reset prototype, restart, start over, reload, reset all, reset state, replay, kiosk reset |

## How it works
Restart Prototype undoes everything that happened while the prototype ran: switches turn back off, counters return to their starting numbers, animations jump to their first values, and typed text clears. Then the prototype starts again from its first frame.

- **Restart** takes a pulse (a signal that lasts one frame). The current frame finishes drawing, and the restart happens before the next one.

Your document doesn't change: layers, patches, the values you typed into ports, and assets stay as they are. When Prototype Starts fires again after every restart.

## Tips
- Put a Start Over button at the end of a flow so testers can run it again without reaching for the viewer.
- For a demo that loops on its own, wire a Wait's Finished into Restart.
- Restart ignores pulses on the very first frame, so wiring When Prototype Starts straight into it can't restart forever.

## Coming from Origami
Same patch and port. Sonobe finishes the current frame before restarting and ignores a restart pulse on the first frame.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Restart**<br>`restart` | `pulse` | — | Pulse to restart the prototype from its first frame; pulses on the first frame are ignored. |

## Outputs

This patch has no fixed outputs.

## Examples

### Start over from a button

```text
layer start_over rectangle "Start Over" @121,760 160x48 cornerRadius=24
patch tap_start_over interaction layer=@start_over
patch start_over_restart restartPrototype restart←tap_start_over.tap
```

### Loop a demo every 10 seconds

Useful for a kiosk: after each restart, When Prototype Starts starts the Wait again.

```text
patch launched whenPrototypeStarts
patch demo_timer wait start←launched.started duration=10
patch loop_demo restartPrototype restart←demo_timer.finished
```

## Common mistakes

- Nothing restarts when the prototype launches: the pulse arrives on the first frame, which Restart Prototype ignores so it can't loop forever. Delay the pulse with a Wait, or trigger it from a tap.
- Restarting also resets a choice you meant to keep, like a setting picked on an earlier screen: a restart clears all running state. To reset only part of the flow, pulse those patches' own Reset or Turn Off inputs.

## Pairs well with

- [When Prototype Starts](whenPrototypeStarts.md): Sends one pulse on the prototype's first frame, and again each time the prototype restarts.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Long Press](longPress.md): Turns on when a press is held still on a layer for a set time, and tells a quick tap apart from a hold.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Restart Prototype (`builtin.restart.prototype`)
