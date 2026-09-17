<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Watch

Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.

| | |
|---|---|
| Type key | `watch` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | debug, inspect, probe, log, print, console, readout, show value, monitor, trace |

## How it works
Connect any output to a Watch to see what it carries while the prototype runs. The patch shows the current value on its face and writes changes to the console.

- **Value** is the value to watch. Connecting a cable sets the patch's type to match; right-click to change it.
- **Label** names the readout, like "Card scale".
- **Log Changes** writes a console line when the value changes, at most 4 lines a second, so fast animations don't flood the console. The last line always shows where the value settled.
- **Display** is the readout as text. Wire it to a Text layer to see values on a phone.
- **Change Count** counts changes since the start or the last **Reset**. For on/off values it counts how many times the value turned on, so it's the quickest way to check that a tap or pulse fired.

For a loop, the patch face shows the first item and how many items there are; hover it to see every item.

## Tips
- A Watch never affects the prototype. Keep it while you work, then mute or delete it.
- Pulses (signals that last one frame) are too short to see. Set the Watch's type to on/off and watch Change Count.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to show. Its type follows the patch's type, which is number by default. |
| **Label**<br>`label` | `text` | `""` | Text shown before the value and in console lines; empty shows the value alone. |
| **Log Changes**<br>`logChanges` | `boolean` | `true` | When on, writes a console line when the value changes, at most 4 lines a second per item, ending with the latest value. |
| **Reset**<br>`reset` | `pulse` · advanced | — | Pulse to set Change Count back to 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Display**<br>`display` | `text` | The readout shown on the patch, such as "Scale: 0.94" or "Taps: false · on 3×". |
| **Change Count**<br>`changeCount` | `number` | How many times Value changed since the start or the last Reset; on/off values count only turning on, so each pulse counts once. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Check that a tap reaches a card

Change Count goes up by one on every tap, so you can tell whether touches reach the card.

```text
layer card rectangle "Card" @16,120 370x220 cornerRadius=24
patch tap_card interaction layer=@card
patch tap_watch watch<boolean> value←tap_card.tap label="Card taps"
```

### Read a spring's value on a phone

Display feeds a Text layer, so the number shows in the web player without a console.

```text
layer button rectangle "Button" @121,400 160x56 cornerRadius=28 scale←press_scale.output
layer readout text "Readout" @16,780 text←scale_watch.display
patch press interaction layer=@button
patch press_spring popAnimation number←press.down
patch press_scale transition<number> progress←press_spring.output start=1 end=0.94
patch scale_watch watch value←press_scale.output label="Scale" logChanges=false
```

## Common mistakes

- Change Count goes up by 2 for every tap: with the number type, a pulse changes the value to 1 and back to 0. Set the Watch's type to on/off (boolean) so each pulse counts once.
- The console fills with lines: Log Changes is on for values that animate across a big loop, and each item logs separately. Turn Log Changes off and read the patch face instead.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Splitter](splitter.md): Passes a value through unchanged, so you can name it, reuse it as a constant, tidy cables, or cast it to another type.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

Sonobe-native: Origami has no matching patch.
