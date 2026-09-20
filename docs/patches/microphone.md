<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Microphone

Listens to the device microphone for live sound levels and records clips you can play back.

| | |
|---|---|
| Type key | `microphone` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | mic, record audio, voice recording, voice memo, audio input, listen, voice level, getusermedia |

## How it works
Microphone turns on the device's microphone. The browser or system asks for permission the first time.

- **Enabled** turns the microphone on. It starts off, so a prototype doesn't listen until you choose.
- **Recording** records sound while it's on and finishes the clip when it turns off.

The outputs:

- **Sound** is the latest recording. Connect it to a Sound Player to play it back.
- **Metering** is the live sound. Connect it to Audio Metering to make layers react to your voice.
- **Recorded** pulses when a new recording is ready.
- **Available** is on while the microphone is listening.

## Tips
- Metering works whenever the microphone is on; you don't need to record.
- Voices are noisy, so smooth Audio Metering's Volume with Pop Animation or Smooth Value before it drives a layer.
- On a phone, the web player needs an HTTPS address to use the microphone, and Preview on Phone's is plain http://, so test the microphone in the desktop app.

## Coming from Origami
Enable is Enabled and Record is Recording. Metering no longer needs Record on. Available and Recorded are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `false` | When on, the microphone listens; turning it off releases it. |
| **Recording**<br>`recording` | `boolean` | `false` | When on, records sound; turning it off finishes the clip. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Sound**<br>`sound` | `sound` | The most recent recording for a Sound Player; empty until a recording finishes. |
| **Metering**<br>`metering` | `sound` | The live sound for Audio Metering; empty while the microphone is off. |
| **Available**<br>`available` | `boolean` | True while the microphone is listening with permission granted. |
| **Recorded**<br>`recorded` | `pulse` | Pulses when a new recording is ready on Sound. |

## Examples

### Grow a circle with your voice

Pop Animation smooths the level before Transition maps it to a scale.

```text
layer blob oval "Blob" @151,367 100x100 scale←grow.output
patch mic microphone enabled=true
patch meter audioMetering source←mic.metering
patch smooth popAnimation number←meter.volume bounciness=0 speed=20
patch grow transition<number> progress←smooth.output start=1 end=3
```

### Hold to record a voice memo, tap to play it

```text
layer record_button oval "Record Button" @171,720 60x60
layer play_button rectangle "Play Button" @16,640 370x56
patch press_record interaction layer=@record_button
patch mic microphone enabled=true recording←press_record.down
patch tap_play interaction layer=@play_button
patch memo soundPlayer sound←mic.sound play←tap_play.tap
```

## Common mistakes

- Audio Metering reads 0: Enabled is still off, since the microphone starts off. Turn Enabled on and allow the permission prompt.
- The recording is always empty: a pulse is wired into Recording, so recording lasts one frame and is discarded. Wire a state that stays on while recording, such as an Interaction's Down.
- The microphone works on the computer but not on the phone: the web player was opened over plain http://, and browsers only allow the microphone on HTTPS or localhost. Sonobe has no HTTPS preview yet, so test it in the desktop viewer or the pop-out window.

## Pairs well with

- [Audio Metering](audioMetering.md): Measures how loud a sound is and how loud its low to high pitches are, so layers can react to music or your voice.
- [Sound Player](soundPlayer.md): Plays a sound file with play, pause, looping, volume, speed, pitch, and pan, and reports where playback is.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Smooth Value](smoothValue.md): Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.

## Availability

**Web-limited.** Uses getUserMedia, which needs microphone permission and a secure page (HTTPS or localhost), so the LAN web player over plain HTTP can't use it; headless simulation has no microphone.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Microphone (`builtin.microphone`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
| `recording` | Record |
