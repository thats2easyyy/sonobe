/**
 * Services the media patches read. The contract has `resolveAssetUrl`, `layerInfo`, and a minimal
 * `platform.audio` (play, stop, currentTime); everything else is the catalog's proposal
 * (CONVENTIONS.md §19.6–§19.7). Patches duck-type each member, so a host that adds one lights the
 * patch up, and a host without it gets idle outputs and one log.
 */

import type { AssetRef, LayerRef, Value } from "@sonobe/core";
import type { LayerInfoSnapshot, PatchContext, PlatformServices, RuntimeServices } from "@sonobe/engine";

/** What a host knows about an image, video, or sound reference (proposed `services.mediaInfo`). */
export interface MediaInfo {
  status: "loading" | "ready" | "error";
  width: number;
  height: number;
  duration: number;
  name: string;
}

export interface VoiceOptions {
  loop: boolean;
  volume: number;
  rate: number;
  pitch: number;
  pan: number;
}

export type VoiceStatus = "loading" | "blocked" | "playing" | "paused" | "ended" | "error";

/** A platform voice's clock (proposed `audio.state`). */
export interface VoiceState {
  status: VoiceStatus;
  currentTime: number;
  duration: number;
  ended: boolean;
  loops: number;
}

/** The contract's audio service. */
export type LegacyAudioService = NonNullable<PlatformServices["audio"]>;

/** The proposed audio service: AssetRef sources, pause, seek, live updates, and voice state. */
export interface ExtendedAudioService {
  play(key: string, source: AssetRef, options: VoiceOptions & { from: number }): void;
  pause(key: string): void;
  seek(key: string, seconds: number): void;
  update(key: string, options: VoiceOptions): void;
  stop(key: string): void;
  state(key: string): VoiceState | undefined;
  meter?(source: MeterSource, bands: number): AudioMeterReading | undefined;
}

export type MeterSource = { live: string } | { layer: LayerRef };

export interface AudioMeterReading {
  rms: number;
  peak: number;
  bands: readonly number[];
}

export interface PixelReading {
  width: number;
  height: number;
  data: ArrayLike<number>;
  frameId: number;
  /** The picture's own pixel size. */
  contentSize: [number, number];
  /** Where the picture sits inside the layer, in local points: [x, y, w, h]. */
  contentRect: [number, number, number, number];
}

/** Media capture and pixel access (proposed `platform.media`). */
export interface MediaCaptureService {
  openCamera?(key: string, options: { facing: "front" | "back"; quality: "low" | "medium" | "high" }): Promise<AssetRef>;
  openMicrophone?(key: string): Promise<AssetRef>;
  close(key: string): void;
  captureFrame?(key: string): Promise<AssetRef>;
  startRecording(key: string, options: { audio: boolean }): void;
  stopRecording(key: string): Promise<AssetRef | null>;
  frameId?(layer: LayerRef): number | undefined;
  readPixels?(layer: LayerRef, maxSize: number): PixelReading | undefined;
}

export interface PickedMedia {
  kind: "image" | "video";
  image: AssetRef | null;
  video: AssetRef | null;
  width: number;
  height: number;
  name: string;
}

export interface FaceResult {
  box: [number, number, number, number];
  angle?: number;
  leftEye?: [number, number];
  rightEye?: [number, number];
  mouth?: [number, number];
}

export interface HandResult {
  box?: [number, number, number, number];
  handedness?: "left" | "right";
  confidence?: number;
  landmarks: [number, number][];
}

export interface QrCodeResult {
  message: string;
  corners: [number, number][];
}

export type Positioning = "relative" | "absolute";

/** Detectors (proposed `platform.detect`). */
export interface DetectService {
  faces?(layer: LayerRef, options: { maxDimension: number; positioning: Positioning }): Promise<readonly FaceResult[]>;
  hands?(layer: LayerRef, options: { maxHands: number; maxDimension: number; positioning: Positioning }): Promise<readonly HandResult[]>;
  qrCodes?(layer: LayerRef, options: { maxDimension: number }): Promise<readonly QrCodeResult[]>;
}

/** The platform members media patches use: contract members plus proposed ones. */
export interface MediaPlatform {
  audio?: LegacyAudioService | ExtendedAudioService;
  pickMedia?(options: { accept: "all" | "photos" | "videos"; multiple: boolean }): Promise<readonly PickedMedia[]>;
  /** Release a blob URL or buffer the host created for a reference this patch no longer uses. */
  releaseMedia?(ref: AssetRef): void;
  media?: MediaCaptureService;
  snapshot?(layer: LayerRef | null, options: { scale: number }): Promise<AssetRef>;
  detect?: DetectService;
}

/** The runtime's platform services, typed with the proposed members. */
export function mediaPlatform(services: RuntimeServices): MediaPlatform {
  return (services.platform ?? {}) as unknown as MediaPlatform;
}

/** True when the audio service has the proposed members (pause, seek, update, state). */
export function isExtendedAudio(audio: MediaPlatform["audio"]): audio is ExtendedAudioService {
  const a = audio as Partial<ExtendedAudioService> | undefined;
  return !!a && typeof a.pause === "function" && typeof a.seek === "function" && typeof a.update === "function" && typeof a.state === "function";
}

/** The audio meter, when the host has one. */
export function audioMeter(audio: MediaPlatform["audio"]): ((source: MeterSource, bands: number) => AudioMeterReading | undefined) | undefined {
  const a = audio as { meter?: ExtendedAudioService["meter"] } | undefined;
  return a && typeof a.meter === "function" ? (source, bands) => a.meter!(source, bands) : undefined;
}

type MediaInfoReader = (ref: AssetRef) => MediaInfo | undefined;
type LayerOutputReader = (layer: LayerRef, key: string) => Value | undefined;

/** Proposed `services.mediaInfo`, also accepted on `platform` so hosts can pass it through RuntimeOptions today. */
export function mediaInfoReader(services: RuntimeServices): MediaInfoReader | undefined {
  const s = services as unknown as { mediaInfo?: MediaInfoReader };
  if (typeof s.mediaInfo === "function") return (ref) => s.mediaInfo!(ref);
  const p = services.platform as unknown as { mediaInfo?: MediaInfoReader } | undefined;
  return p && typeof p.mediaInfo === "function" ? (ref) => p.mediaInfo!(ref) : undefined;
}

/** Proposed `services.layerOutput`, also accepted on `platform`. */
export function layerOutputReader(services: RuntimeServices): LayerOutputReader | undefined {
  const s = services as unknown as { layerOutput?: LayerOutputReader };
  if (typeof s.layerOutput === "function") return (layer, key) => s.layerOutput!(layer, key);
  const p = services.platform as unknown as { layerOutput?: LayerOutputReader } | undefined;
  return p && typeof p.layerOutput === "function" ? (layer, key) => p.layerOutput!(layer, key) : undefined;
}

/** The layer's type from the proposed `LayerInfoSnapshot.type`, or undefined when unknown. */
export function layerTypeOf(ctx: Pick<PatchContext, "services">, layer: LayerRef): string | undefined {
  try {
    const info = ctx.services.layerInfo(layer) as (LayerInfoSnapshot & { type?: unknown }) | undefined;
    return typeof info?.type === "string" ? info.type : undefined;
  } catch {
    return undefined;
  }
}
