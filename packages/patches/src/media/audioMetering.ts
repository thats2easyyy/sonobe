/**
 * Audio Metering: loudness, half-second peak, and per-band levels of a live sound (a Metering
 * handle) or a Video layer, from the host's analyser. Levels report as 0–1 or dBFS. Evaluates once
 * per frame because Waveform Data is a whole loop.
 */

import type { AudioMeterReading } from "@sonobe/engine";
import { clamp, definePatch, finiteOr, loopOf, toText, warnOnce } from "../infra/index.ts";
import { clampInt, isAssetRef, isLayerRef, isLiveHandle, layerTypeOf, liveHandleKey, warnLoopedInputs } from "./shared.ts";

/** Silence in dBFS. */
export const SILENCE_DB = -160;

/** Amplitude (0–1) as dBFS in [−160, 0]. */
export function toDb(amplitude: number): number {
  return amplitude > 1e-8 ? Math.min(0, 20 * Math.log10(amplitude)) : SILENCE_DB;
}

/** Volume and Peak Volume percent: −60 dBFS and quieter → 0, full scale → 1. */
export function levelPercent(db: number): number {
  return clamp((db + 60) / 60, 0, 1);
}

/** Band percent over the AnalyserNode byte range, −100 to −30 dB. */
export function bandPercent(db: number): number {
  return clamp((db + 100) / 70, 0, 1);
}

interface MeterState {
  peaks: { time: number; db: number }[];
}

export const audioMeteringPatch = definePatch<MeterState>("audioMetering", {
  mutedBehavior: "evaluate",
  state: () => ({ peaks: [] }),
  evaluate(ctx) {
    const s = ctx.state;
    warnLoopedInputs(ctx, ["source", "resolution", "format", "layer"], "audioMetering");
    const bands = clampInt(ctx.input("resolution"), 3, 1, 128);
    const percent = toText(ctx.input("format")) === "percent";
    let reading: AudioMeterReading | undefined;
    if (ctx.muted) {
      s.peaks = [];
    } else {
      const audio = ctx.services.platform.audio;
      const meter = audio && typeof audio.meter === "function" ? audio.meter.bind(audio) : undefined;
      const rawSource = ctx.input("source");
      const rawLayer = ctx.input("layer");
      const source = isAssetRef(rawSource) ? rawSource : null;
      const layer = isLayerRef(rawLayer) ? rawLayer : null;
      try {
        if (source !== null) {
          if (!isLiveHandle(source)) warnOnce(ctx, "plainAsset", "audioMetering: Source is a sound file, not a live sound; connect a Sound Player's or Microphone's Metering output.");
          else if (meter) reading = meter({ live: liveHandleKey(source) }, bands);
        } else if (layer !== null) {
          const type = layerTypeOf(ctx, layer);
          if (type !== undefined && type !== "video") warnOnce(ctx, "notVideo", "audioMetering: Layer isn't a Video layer, so there's nothing to measure.");
          else if (meter) reading = meter({ layer }, bands);
        }
      } catch {
        reading = undefined;
      }
    }
    let volumeDb = SILENCE_DB;
    let bandDb = new Array<number>(bands).fill(SILENCE_DB);
    if (reading) {
      volumeDb = toDb(finiteOr(reading.rms, 0));
      const levels = Array.isArray(reading.bands) ? reading.bands : [];
      bandDb = Array.from({ length: bands }, (_, i) => clamp(finiteOr(levels[i], SILENCE_DB), SILENCE_DB, 0));
      s.peaks.push({ time: ctx.time, db: toDb(finiteOr(reading.peak, 0)) });
      ctx.requestNextFrame();
    }
    s.peaks = s.peaks.filter((p) => ctx.time - p.time < 0.5);
    if (s.peaks.length > 0) ctx.requestNextFrame();
    const peakDb = s.peaks.reduce((max, p) => Math.max(max, p.db), SILENCE_DB);
    ctx.output("volume", percent ? levelPercent(volumeDb) : volumeDb);
    ctx.output("peakVolume", percent ? levelPercent(peakDb) : peakDb);
    ctx.output("waveformData", loopOf(bandDb.map((db) => (percent ? bandPercent(db) : db))));
  },
});
