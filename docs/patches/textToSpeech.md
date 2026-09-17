<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text to Speech

Speaks text aloud with a system voice, for voice assistants, spoken directions, and accessibility demos.

| | |
|---|---|
| Type key | `textToSpeech` |
| Category | [Device](README.md#device) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | speak, say, read aloud, voice, speech synthesis, tts, narrate, voice assistant |

## How it works
Text to Speech reads **Text** aloud with a voice built into the system. Send a pulse (a signal that's on for one frame) into **Speak** to start.

- Speaking again cuts off whatever the prototype is saying and starts the new text. Changing Text mid-sentence doesn't change what you hear.
- **Stop** ends speech early.
- **Voice** picks a voice by name, like Samantha, or by language code, like en-GB. Leave it empty for the default voice.
- **Rate** is the speed: 1 is normal and 2 is twice as fast. **Pitch** runs from 0 (low) to 2 (high), and **Volume** from 0 (silent) to 1 (full).
- **Speaking** is true while the voice talks, and **Finished** pulses when it reaches the end.

## Tips
- Chain lines by wiring Finished into the next Text to Speech's Speak.
- Show captions from the same Text so people can follow without sound.
- Voices sound different on every device, so test on the one you'll demo.

## Coming from Origami
Origami doesn't document this patch's ports, so imported files map ports by label.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` (multiline) | `"Hello"` | What to say. |
| **Speak**<br>`speak` | `pulse` | — | Pulse to say Text, cutting off anything the prototype is already saying. |
| **Stop**<br>`stop` | `pulse` | — | Pulse to stop speaking right away; Finished doesn't fire. |
| **Voice**<br>`voice` | `text` | `""` | A voice name like Samantha or a language code like en-GB; empty uses the system's default voice. |
| **Rate**<br>`rate` | `number` | `1` | Speaking speed: 1 is normal, 0.5 is half speed, 2 is twice as fast. Range 0.1 to 10, step 0.1. |
| **Pitch**<br>`pitch` | `number` | `1` | Voice pitch from 0 (lowest) to 2 (highest); 1 is the voice's natural pitch. Range 0 to 2, step 0.1. |
| **Volume**<br>`volume` | `number` (progress) | `1` | Loudness from 0 (silent) to 1 (full volume). Range 0 to 1, step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Speaking**<br>`speaking` | `boolean` | True while the voice is talking. |
| **Finished**<br>`finished` | `pulse` | Pulses when the voice reaches the end of the text; not when stopped or cut off. |

## Examples

### Read a card aloud when it's tapped

```text
layer card rectangle "Card" @16,300 370x200 cornerRadius=20
patch tap_card interaction layer=@card
patch read_card textToSpeech text="Your table for two is booked for 7 PM." speak←tap_card.tap rate=1.1
```

### Speak turn-by-turn directions in order

Each tap advances the counter, and Option Picker chooses the line to say.

```text
layer next_button rectangle "Next Button" @16,780 370x56 cornerRadius=14
patch tap_next interaction layer=@next_button
patch step counter increase←tap_next.tap maximumCount=3
patch line optionPicker<text>[3] option←step.count option0="Head north on Market Street." option1="Turn right onto 3rd Street." option2="Your destination is on the left."
patch changed pulseOnChange<number> value←step.count
patch say_line textToSpeech text←line.output speak←changed.changed
```

## Common mistakes

- Nothing speaks on an iPhone at launch: iOS Safari only allows speech after the person taps the page. Start speech from a tap.
- Only the last line is heard: every Speak cuts off the previous speech. Wire each line's Finished into the next patch's Speak instead of pulsing them all at once.
- The voice sounds different on another computer: Voice picks from the voices installed on that device. Use a language code like en-US, or test on the device you'll present.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [When Prototype Starts](whenPrototypeStarts.md): Sends one pulse on the prototype's first frame, and again each time the prototype restarts.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.

## Availability

**Web-limited.** Uses the Web Speech API (speechSynthesis). Voices differ by system, Linux desktops need speech-dispatcher installed, and iOS Safari only speaks after the person has tapped the prototype.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text To Speech
