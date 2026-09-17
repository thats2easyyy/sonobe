<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Pulse

Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.

| | |
|---|---|
| Type key | `pulse` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>U</kbd> |
| Search terms | edge detector, rising edge, falling edge, turned on, turned off, state to pulse, trigger, on release |

## How it works
A Pulse watches a state (a value that stays on or off over time) and fires a pulse (a signal that lasts one frame) each time that state changes.

- **On** is the state to watch.
- **Turned On** fires on the frame On goes from off to on.
- **Turned Off** fires on the frame On goes from on to off.

It only reacts to changes, so nothing fires on the first frame, even if On starts on.

## Tips
- Pulse inputs, such as a Switch's Flip, already fire when a wired state turns on. Reach for Pulse when you need the moment something turns **off**, like a finger lifting or loading finishing.
- A number wired into On counts as on while it's above 0.
- To act at launch, use When Prototype Starts.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **On**<br>`on` | `boolean` | `false` | The on/off state to watch, such as Down from an Interaction or the result of a comparison. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Turned On**<br>`turnedOn` | `pulse` | Pulses for one frame when On changes from off to on. |
| **Turned Off**<br>`turnedOff` | `pulse` | Pulses for one frame when On changes from on to off. |

## Examples

### Show a banner when loading finishes

Loading turns off when the response arrives, and Turned Off catches that moment.

```text
layer banner rectangle "Loaded Banner" @16,60 358x56 opacity←show.output
patch launch whenPrototypeStarts
patch feed networkRequest request←launch.started url="https://example.com/feed.json"
patch load_state pulse on←feed.loading
patch loaded switch turnOn←load_state.turnedOff
patch show popAnimation number←loaded.on bounciness=0 speed=14
```

### Hide a hint one second after release

```text
layer hold_button rectangle "Hold Me" @120,400 150x56
layer hint text "Hint" @120,470 opacity←fade.output
patch hold interaction layer=@hold_button
patch press pulse on←hold.down
patch hide_timer wait start←press.turnedOff reset←press.turnedOn duration=1
patch hint_visible switch turnOn←press.turnedOn turnOff←hide_timer.finished
patch fade popAnimation number←hint_visible.on bounciness=0 speed=14
```

## Common mistakes

- The action happens when the finger goes down instead of when it lifts: Turned On fires on press. Use Turned Off, or Interaction's Tap, for release.
- Nothing fires when the prototype starts, even though On is already on: Pulse only reacts to changes. Use When Prototype Starts to act at launch.

## Pairs well with

- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Sample and Hold](sampleAndHold.md): Captures a value when you tell it to and keeps it, like remembering where a drag started.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Pulse (`builtin.pulse`)

| Sonobe port | Origami label |
|---|---|
| `on` | On / Off |
