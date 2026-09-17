<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Sound Player

Plays a sound file with play, pause, looping, volume, speed, pitch, and pan, and reports where playback is.

| | |
|---|---|
| Type key | `soundPlayer` |
| Category | [Media](README.md#media) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | audio, play sound, sound effect, sfx, music, audio player, mp3, sound player settings, volume, pan |

## How it works
Sound Player plays one sound, like a small music player. Connect a sound file to **Sound**, then choose how to start it:

- **Playing** is a state: the sound plays while it's on and pauses where it is when it turns off.
- **Play** is a pulse (a signal that's on for one frame): it starts the sound from the beginning and plays it to the end, even while Playing is off. Use it for tap sounds.
- **Reset** jumps back to the start and stops a sound started by Play.
- **Loop** starts the sound over each time it reaches the end.
- **Volume**, **Rate** (speed), **Pitch**, and **Pan** (left to right) change the sound while it plays, without restarting it.

**Current Time**, **Duration**, and **Progress** tell you where playback is. **Is Playing** is on while sound comes out, **Finished** pulses when the sound ends, and **Metering** feeds Audio Metering for visualizers.

## Tips
- In the web player, sound starts only after the person first taps or clicks the prototype. Automated test runs are always silent.
- After a sound finishes, turning Playing off and on again plays it from the start.
- Wire Progress into a Transition to move a playhead along a bar.

## Coming from Origami
Sound Player Settings is built in: Volume, Rate, Pitch, and Pan are advanced inputs. Origami's Play boolean is Playing here. The Play pulse, Progress, Is Playing, and Finished are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Sound**<br>`sound` | `sound` | none | The sound to play: a sound asset, a Microphone recording, or a sound from another patch. |
| **Playing**<br>`playing` | `boolean` | `false` | When on, the sound plays; turning it off pauses and keeps the playback position. |
| **Play**<br>`play` | `pulse` | — | Pulse to play the sound once from the beginning, even while Playing is off. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to jump back to the start and stop a sound started by Play; while Playing is on, playback continues from the start. |
| **Loop**<br>`loop` | `boolean` | `false` | When on, the sound starts over each time it reaches the end. |
| **Volume**<br>`volume` | `number` (progress) · advanced | `1` | Loudness from 0 (silent) to 1 (full volume). Range 0 to 1, step 0.01. |
| **Rate**<br>`rate` | `number` · advanced | `1` | Playback speed: 1 is normal, 0.5 is half speed, and 2 is double speed, with pitch unchanged. Range 0.03 to 32, step 0.1. |
| **Pitch**<br>`pitch` | `number` · advanced | `0` | Pitch shift in cents: 1200 is one octave up and -1200 one octave down, with speed unchanged. Range -2400 to 2400, step 100. |
| **Pan**<br>`pan` | `number` · advanced | `0` | Where the sound sits in stereo: -1 is left, 0 is center, and 1 is right. Range -1 to 1, step 0.1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Current Time**<br>`currentTime` | `number` (duration) | How far into the sound playback is, in seconds. |
| **Duration**<br>`duration` | `number` (duration) | The sound's length in seconds; 0 until it has loaded. |
| **Progress**<br>`progress` | `number` (progress) | Playback position from 0 (start) to 1 (end); 0 while Duration is unknown. |
| **Is Playing**<br>`isPlaying` | `boolean` | True while sound is coming out, from Playing or from a Play pulse that hasn't finished. |
| **Finished**<br>`finished` | `pulse` | Pulses when playback reaches the end; with Loop on, pulses each time it starts over. |
| **Metering**<br>`metering` | `sound` | A live handle to this player's sound; connect it to Audio Metering to visualize it. |

## Examples

### Play a pop sound on tap

Play starts the sound from the beginning on every tap.

```text
layer like_button oval "Like Button" @171,700 60x60
patch tap_like interaction layer=@like_button
patch pop_sound soundPlayer sound=asset:pop play←tap_like.tap
```

### Play and pause a song with a progress bar

A Switch holds Playing, and Progress moves a playhead along the track.

```text
layer play_button oval "Play Button" @171,720 60x60
layer track rectangle "Track" @16,660 370x4
layer playhead oval "Playhead" 14x14 anchor=0.5,0.5 position←head_move.output
patch tap_play interaction layer=@play_button
patch play_toggle switch flip←tap_play.tap
patch song soundPlayer sound=asset:song playing←play_toggle.on
patch head_move transition<point> progress←song.progress start=16,662 end=386,662
```

## Common mistakes

- Nothing plays in the web player: browsers keep a page silent until the person first taps or clicks it. Start the sound from a tap, or tap the prototype once before it should play.
- A tap sound plays only the first time: Playing stays on after the sound ends, so there's nothing left to play. Wire the tap into Play, which starts from the beginning every time.
- The sound stutters and never gets going: Play receives a pulse on many frames in a row, for example from Pulse on Change on a moving value, and each pulse restarts it. Send Play from a single event, or use Playing.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Audio Metering](audioMetering.md): Measures how loud a sound is and how loud its low to high pitches are, so layers can react to music or your voice.
- [Microphone](microphone.md): Listens to the device microphone for live sound levels and records clips you can play back.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Web-limited.** Browsers keep a page silent until the person first taps, clicks, or presses a key, so the web player can't start sound before that; headless simulation never makes sound.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Sound Player (`builtin.soundplayer`)
- **Also imports:** `origami.soundplayer.settings`, `builtin.soundplayer.settings`

| Sonobe port | Origami label |
|---|---|
| `playing` | Play |
| `volume` | Sound Player Settings › Volume |
| `rate` | Sound Player Settings › Rate |
| `pitch` | Sound Player Settings › Pitch |
| `pan` | Sound Player Settings › Pan |
