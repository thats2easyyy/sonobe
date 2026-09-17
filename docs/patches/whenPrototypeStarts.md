<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# When Prototype Starts

Sends one pulse on the prototype's first frame, and again each time the prototype restarts.

| | |
|---|---|
| Type key | `whenPrototypeStarts` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | on start, on launch, on load, startup, first frame, pulse on start, init, app launch |

## How it works
When Prototype Starts has no inputs. **Started** sends a pulse (a signal that lasts one frame) on the prototype's first frame.

- Restarting the viewer (⌘R), or a Restart Prototype patch, fires it again.
- Adding this patch while the prototype runs fires it once, right away.
- Inside a component, each instance fires when it first appears.

## Tips
- Start timed sequences here: wire Started into several Wait patches with different durations. Each duration counts from launch.
- Fetch data at launch by wiring Started into a Network Request's Request.
- Choose a starting option by wiring Started into one of an Option Switch's Set to inputs.

## Coming from Origami
The output is named Started.

## Inputs

This patch has no fixed inputs.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Started**<br>`started` | `pulse` | Pulses once on the first frame after the prototype starts or restarts, and when the patch is added. |

## Examples

### Fetch a feed at launch

```text
patch launch whenPrototypeStarts
patch feed networkRequest request←launch.started url="https://example.com/feed.json"
```

### Fade in a welcome card after launch

The short Wait lets the animation start from its hidden state instead of appearing already visible.

```text
layer welcome rectangle "Welcome Card" @16,300 358x200 opacity←fade_in.output
patch launch whenPrototypeStarts
patch intro_delay wait start←launch.started duration=0.2
patch intro_on switch turnOn←intro_delay.finished
patch fade_in popAnimation number←intro_on.on bounciness=0 speed=12
```

## Common mistakes

- Nothing happens after you wire it up: the pulse already went out when the prototype started. Restart the viewer (⌘R) to fire it again.
- An entrance animation doesn't play at launch: this pulse turns a Switch on during frame 0, and animations start at their first target without moving. Put a short Wait (0.2 s) between this patch and the Switch.

## Pairs well with

- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Option Switch](optionSwitch.md): Remembers which of several options is selected, counted from 0, and changes when an option's pulse arrives.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.
- [Repeating Pulse](repeatingPulse.md): Sends a pulse over and over at a steady interval, like a metronome.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** When Prototype Starts (`builtin.pulseonstart`)
- **Also imports:** `builtin.pulseOnStart`

| Sonobe port | Origami label |
|---|---|
| `started` | Output |
