<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Audio Metering

Measures how loud a sound is and how loud its low to high pitches are, so layers can react to music or your voice.

| | |
|---|---|
| Type key | `audioMetering` |
| Category | [Media](README.md#media) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | audio level, volume meter, level meter, visualizer, equalizer, waveform, spectrum, decibels, audio analyzer |

## How it works
Audio Metering listens to live sound and turns it into numbers. Connect the **Metering** output of a Sound Player or a Microphone to **Source**.

- **Volume** is how loud the sound is right now.
- **Peak Volume** is the loudest moment over about the last half second, so it moves more calmly.
- **Waveform Data** is a loop (a list that makes a layer repeat once per item) of levels from low pitches to high pitches. **Resolution** sets how many levels it has.
- **Format** chooses Percent, from 0 (quiet) to 1 (loud), or Decibels, from -160 (silence) to 0 (loudest).

To measure a Video layer's sound, leave Source empty and pick the layer in **Layer**.

## Tips
- Levels jump around. Send them through Pop Animation or Smooth Value before they drive a layer.
- Use Transition to map Volume onto a useful range, such as a scale from 1 to 2.
- Repeat a bar or dot layer with Waveform Data to build an equalizer.

## Coming from Origami
Input is Source, and the Layer input for videos is new. Percent levels use a fixed 60 dB range, so they may read differently than in Origami.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Source**<br>`source` | `sound` | none | The live sound to measure: the Metering output of a Sound Player or a Microphone. |
| **Resolution**<br>`resolution` | `number` | `3` | How many levels Waveform Data returns, from low pitches to high pitches. Range 1 to 128, step 1. |
| **Format**<br>`format` | `enum` | `percent` | How levels are reported. |
| **Layer**<br>`layer` | `layer` · advanced | none | A Video layer to measure instead; used when Source is empty. |

**Format options**

- **Percent** (`percent`): 0 (quiet) to 1 (loud).
- **Decibels** (`decibels`): -160 (silence) to 0 (loudest).

## Outputs

| Output | Type | Description |
|---|---|---|
| **Volume**<br>`volume` | `number` | How loud the sound is right now, as a percent or in decibels. |
| **Peak Volume**<br>`peakVolume` | `number` | The loudest level over the last half second, as a percent or in decibels. |
| **Waveform Data**<br>`waveformData` | `number` · whole loop | A loop of levels from low pitches to high pitches, with Resolution items. |

## Examples

### Pulse a ring to the music

```text
layer ring oval "Ring" @151,367 100x100 scale←ring_scale.output
patch song soundPlayer sound=asset:song playing=true loop=true
patch meter audioMetering source←song.metering
patch smooth popAnimation number←meter.volume bounciness=0 speed=20
patch ring_scale transition<number> progress←smooth.output start=1 end=1.6
```

### Light up a row of dots like an equalizer

Waveform Data is a loop, so the dot repeats once per level inside a row layout.

```text
layer dots group "Dots" @16,600 370x40 layout=row spacing=10
  layer dot oval "Dot" 40x40 scale←dot_scale.output
patch song soundPlayer sound=asset:song playing=true loop=true
patch meter audioMetering source←song.metering resolution=7
patch dot_scale transition<number> progress←meter.waveformData start=0.3 end=1
```

## Common mistakes

- Every level stays at 0: Source is a sound file rather than live sound. Connect the Metering output of a Sound Player that's playing, or of a Microphone that's on.
- The layer shakes: raw levels change every frame. Put Pop Animation or Smooth Value between Volume and the layer.
- Levels look like large negative numbers: Format is Decibels, which runs from -160 to 0. Switch Format to Percent for values you can wire straight into a Transition.

## Pairs well with

- [Microphone](microphone.md): Listens to the device microphone for live sound levels and records clips you can play back.
- [Sound Player](soundPlayer.md): Plays a sound file with play, pause, looping, volume, speed, pitch, and pan, and reports where playback is.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Smooth Value](smoothValue.md): Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.

## Availability

**Web-limited.** Measures sound with the Web Audio AnalyserNode, so it hears only sources that can play: Sound Player after the first tap, Microphone with permission, and cross-site videos only with CORS headers.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Audio Metering (`builtin.audiometering`)

| Sonobe port | Origami label |
|---|---|
| `source` | Input |
