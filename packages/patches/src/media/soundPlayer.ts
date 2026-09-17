/**
 * Sound Player: plays one sound with a Playing state, a Play pulse (one-shot from the start), Reset,
 * Loop, and live Volume, Rate, Pitch, and Pan. The playhead is simulated deterministically; once a
 * host voice has loaded, its clock is the truth. One voice per loop index, at most 32 at a time.
 */

import type { AssetRef } from "@sonobe/core";
import type { PatchContext, RuntimeServices } from "@sonobe/engine";
import { clamp, definePatch, finiteOr, logOnce, toBool, warnOnce } from "../infra/index.ts";
import { isExtendedAudio, mediaInfoReader, mediaPlatform } from "./platform.ts";
import type { ExtendedAudioService, LegacyAudioService, VoiceOptions, VoiceState } from "./platform.ts";
import { assetExists, isAssetRef, isLiveHandle, liveHandle, refKey, safely, withMutedBehavior } from "./shared.ts";

/** Most voices that sound at once. */
export const MAX_VOICES = 32;

interface SoundState {
  key: string;
  source: AssetRef | null;
  sourceKey: string;
  /** Source that failed to load; it behaves as empty. */
  failedKey: string;
  position: number;
  audible: boolean;
  oneShot: boolean;
  prevPlaying: boolean;
  /** A host voice exists for this index. */
  voice: boolean;
  /** The host voice was told to play (and holds a voice slot). */
  voicePlaying: boolean;
  options: string;
  loops: number;
  ended: boolean;
}

const voiceSlots = new WeakMap<RuntimeServices, Set<string>>();

function slots(services: RuntimeServices): Set<string> {
  let set = voiceSlots.get(services);
  if (!set) voiceSlots.set(services, (set = new Set()));
  return set;
}

function claimVoice(ctx: PatchContext, key: string): boolean {
  const set = slots(ctx.services);
  if (set.has(key)) return true;
  if (set.size >= MAX_VOICES) {
    warnOnce(ctx, "voices", `soundPlayer: at most ${MAX_VOICES} sounds play at once, so later ones stay silent.`);
    return false;
  }
  set.add(key);
  return true;
}

function stopVoice(s: SoundState, services: RuntimeServices): void {
  if (s.voice) {
    const audio = mediaPlatform(services).audio;
    safely(() => audio?.stop(s.key));
  }
  s.voice = false;
  s.voicePlaying = false;
  s.loops = 0;
  s.ended = false;
  slots(services).delete(s.key);
}

function readOption(ctx: PatchContext, key: string, label: string, fallback: number, lo: number, hi: number): number {
  const v = ctx.input(key);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    warnOnce(ctx, `nonFinite:${key}`, `soundPlayer: ${label} isn't a finite number, so it uses ${fallback}.`);
    return fallback;
  }
  return clamp(v, lo, hi);
}

function voiceOptions(ctx: PatchContext, loop: boolean): VoiceOptions {
  return {
    loop,
    volume: readOption(ctx, "volume", "Volume", 1, 0, 1),
    rate: readOption(ctx, "rate", "Rate", 1, 0.03, 32),
    pitch: readOption(ctx, "pitch", "Pitch", 0, -2400, 2400),
    pan: readOption(ctx, "pan", "Pan", 0, -1, 1),
  };
}

const optionsKey = (o: VoiceOptions) => `${o.loop}|${o.volume}|${o.rate}|${o.pitch}|${o.pan}`;

/** The input as a playable reference: null for empty, live handles (with a warning), and missing assets. */
function playableSound(ctx: PatchContext, raw: unknown): AssetRef | null {
  if (!isAssetRef(raw)) return null;
  if (isLiveHandle(raw)) {
    warnOnce(ctx, "liveHandle", "soundPlayer: a Metering output can't be played; connect a sound file or a Microphone's Sound output.");
    return null;
  }
  return assetExists(ctx, raw) ? raw : null;
}

function mediaDuration(ctx: PatchContext, ref: AssetRef | null): number {
  if (!ref) return 0;
  try {
    const info = mediaInfoReader(ctx.services)?.(ref);
    return info?.status === "ready" && Number.isFinite(info.duration) && info.duration > 0 ? info.duration : 0;
  } catch {
    return 0;
  }
}

/** Drive a proposed-API voice; returns whether sound is actually coming out this frame. */
function syncExtended(ctx: PatchContext, s: SoundState, audio: ExtendedAudioService, ref: AssetRef, wanted: boolean, seek: boolean, options: VoiceOptions, voiceState: VoiceState | undefined): boolean {
  const serialized = optionsKey(options);
  if (!wanted) {
    if (s.voicePlaying) {
      safely(() => audio.pause(s.key));
      s.voicePlaying = false;
      slots(ctx.services).delete(s.key);
    }
    if (s.voice && seek) safely(() => audio.seek(s.key, 0));
    if (s.voice && serialized !== s.options) {
      safely(() => audio.update(s.key, options));
      s.options = serialized;
    }
    return false;
  }
  if (!s.voicePlaying) {
    if (!claimVoice(ctx, s.key)) {
      // No free voice: run on the simulated clock until one frees up.
      if (s.voice) stopVoice(s, ctx.services);
      return true;
    }
    safely(() => audio.play(s.key, ref, { ...options, from: s.position }));
    s.voice = true;
    s.voicePlaying = true;
    s.options = serialized;
    return false;
  }
  if (seek) safely(() => audio.seek(s.key, 0));
  if (serialized !== s.options) {
    safely(() => audio.update(s.key, options));
    s.options = serialized;
  }
  return voiceState?.status === "playing";
}

/** Drive the contract's play/stop audio: start on audible edges, restart on seeks, stop when not wanted. */
function syncLegacy(ctx: PatchContext, s: SoundState, audio: LegacyAudioService, ref: AssetRef, wanted: boolean, seek: boolean, options: VoiceOptions): void {
  if (!wanted) {
    if (s.voice) stopVoice(s, ctx.services);
    return;
  }
  if (s.voice && seek) stopVoice(s, ctx.services);
  if (s.voice) return;
  if (typeof ref.assetId !== "string") {
    warnOnce(ctx, "urlSound", "soundPlayer: this host only plays sound assets, so a sound from a web address stays silent.");
    return;
  }
  if (!claimVoice(ctx, s.key)) return;
  const assetId = ref.assetId;
  safely(() => audio.play(s.key, assetId, { loop: options.loop, volume: options.volume, rate: options.rate }));
  s.voice = true;
  s.voicePlaying = true;
}

export const soundPlayerPatch = withMutedBehavior(
  definePatch<SoundState>("soundPlayer", {
    state: () => ({
      key: "",
      source: null,
      sourceKey: "",
      failedKey: "",
      position: 0,
      audible: false,
      oneShot: false,
      prevPlaying: false,
      voice: false,
      voicePlaying: false,
      options: "",
      loops: 0,
      ended: false,
    }),
    evaluate(ctx) {
      const s = ctx.state;
      s.key = `${ctx.componentPath}/${ctx.id}#${ctx.loopIndex}`;
      if (ctx.node.muted) {
        stopVoice(s, ctx.services);
        s.audible = false;
        s.oneShot = false;
        s.prevPlaying = false;
        ctx.output("currentTime", 0);
        ctx.output("duration", 0);
        ctx.output("progress", 0);
        ctx.output("isPlaying", false);
        ctx.output("metering", null);
        return;
      }
      const audio = mediaPlatform(ctx.services).audio;
      const extended = isExtendedAudio(audio) ? audio : undefined;
      let ref = playableSound(ctx, ctx.input("sound"));
      let key = refKey(ref);
      if (key !== "" && key === s.failedKey) {
        ref = null;
        key = "";
      }
      if (key !== s.sourceKey) {
        stopVoice(s, ctx.services);
        Object.assign(s, { source: ref, sourceKey: key, position: 0, audible: false, oneShot: false });
      }
      const loop = toBool(ctx.input("loop"));
      const options = voiceOptions(ctx, loop);

      let voiceState: VoiceState | undefined;
      if (extended && s.voice) {
        try {
          voiceState = extended.state(s.key);
        } catch {
          voiceState = undefined;
        }
        if (voiceState?.status === "error") {
          warnOnce(ctx, `load:${key}`, "soundPlayer: couldn't load the sound, so it stays silent.");
          stopVoice(s, ctx.services);
          Object.assign(s, { failedKey: key, source: null, sourceKey: "", position: 0, audible: false, oneShot: false });
          ref = null;
          key = "";
          voiceState = undefined;
        }
      }
      const loaded = voiceState !== undefined && (voiceState.status === "playing" || voiceState.status === "paused" || voiceState.status === "ended");
      const platformDuration = loaded ? finiteOr(voiceState!.duration, 0) : 0;
      const d = platformDuration > 0 ? platformDuration : mediaDuration(ctx, ref);
      let finished = false;

      // 1. Advance: the host voice's clock once it has loaded, else the simulated playhead.
      if (loaded) {
        const vs = voiceState!;
        const loops = Math.max(0, Math.floor(finiteOr(vs.loops, 0)));
        if (loops > s.loops || (vs.ended === true && !s.ended)) finished = true;
        s.loops = loops;
        s.ended = vs.ended === true;
        s.position = Math.max(0, finiteOr(vs.currentTime, s.position));
        if (s.ended && !loop) {
          if (d > 0) s.position = d;
          s.oneShot = false;
        }
      } else if (s.audible) {
        s.position += (ctx.dt > 0 ? ctx.dt : 0) * options.rate;
        if (d > 0 && s.position >= d) {
          finished = true;
          if (loop) s.position %= d;
          else {
            s.position = d;
            s.oneShot = false;
          }
        }
      }

      // 2. Commands: Reset > Play; a Playing rising edge at the end replays.
      const playing = toBool(ctx.input("playing"));
      const rose = playing && !s.prevPlaying;
      if (!playing && s.prevPlaying) s.oneShot = false;
      s.prevPlaying = playing;
      let seek = false;
      if (ctx.pulsed("reset")) {
        s.position = 0;
        s.oneShot = false;
        seek = true;
      } else if (ctx.pulsed("play") && ref !== null) {
        s.position = 0;
        s.oneShot = true;
        seek = true;
      } else if (rose && d > 0 && s.position >= d) {
        s.position = 0;
        seek = true;
      }
      if (seek) s.ended = false;

      // 3. Whether sound comes out on this frame.
      const atEnd = d > 0 && !loop && s.position >= d;
      const wanted = ref !== null && (playing || s.oneShot) && !atEnd;
      let platformPlaying = true;
      if (ref !== null && audio) {
        if (extended) platformPlaying = syncExtended(ctx, s, extended, ref, wanted, seek, options, voiceState);
        else syncLegacy(ctx, s, audio as LegacyAudioService, ref, wanted, seek, options);
      } else if (wanted) {
        logOnce(ctx, "log", "silent", "soundPlayer: audio is silent in simulation");
      }
      s.audible = wanted && platformPlaying;
      if (wanted) ctx.requestNextFrame();

      ctx.output("currentTime", s.position);
      ctx.output("duration", d);
      ctx.output("progress", d > 0 ? Math.min(s.position / d, 1) : 0);
      ctx.output("isPlaying", s.audible);
      ctx.output("metering", ref === null ? null : liveHandle("audio", s.key));
      if (finished) ctx.pulse("finished");
    },
    dispose(state, services) {
      if (state) stopVoice(state, services);
    },
  }),
  "evaluate",
);
