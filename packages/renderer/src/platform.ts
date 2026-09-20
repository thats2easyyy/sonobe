/**
 * Platform services for live prototypes in a browser: the editor's viewer (browser and Electron
 * renderer) and the web player (Preview on Phone, the pop-out viewer). Network requests, links,
 * speech, vibration, keyed audio voices, WebSockets, location, gamepads, device motion, the soft
 * keyboard, picking photos and videos, reading media bytes, and camera and microphone capture.
 *
 * A global mute switch (SONOBE_MUTE, `?mute=1`, the desktop host's muted flag, or an automated
 * browser) silences speech and audio while keeping their clocks running, so muted QA runs behave
 * like real ones. Deterministic simulations never get these services (they pass `platform: {}`).
 */

import type { AssetRef, Id, LayerRef } from "@sonobe/core";
import type {
  AudioMeterReading,
  AudioMeterSource,
  AudioServices,
  AudioVoiceOptions,
  AudioVoiceState,
  AudioVoiceStatus,
  DeviceMotionSample,
  FetchFormField,
  FetchInit,
  FetchResponse,
  GamepadSnapshot,
  GeolocationServices,
  MediaCaptureServices,
  PickedMedia,
  PixelReading,
  PlatformServices,
  PlatformWebSocket,
  SoftKeyboardSnapshot,
  SpeechOptions,
} from "@sonobe/engine";

// ---------------------------------------------------------------------------
// Mute switch
// ---------------------------------------------------------------------------

export interface MuteState {
  muted: boolean;
  /** Why: "env", "query", "host", "automation", "user", or null when not muted. */
  reason: string | null;
}

/** The mute switch's store. A zustand StoreApi<MuteState> fits it too, so the editor can pass its own. */
export interface MuteStore {
  getState(): MuteState;
  setState(state: MuteState): void;
  subscribe(listener: (state: MuteState, previous: MuteState) => void): () => void;
}

type MuteWindow = {
  location?: { search?: string };
  navigator?: { webdriver?: boolean };
  sonobeHost?: { muted?: boolean };
};

const truthy = (value: unknown) => typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());

/** Mute requested by the environment (env var, query string, desktop host, or automation). */
export function detectMuted(win: MuteWindow | undefined = typeof window === "undefined" ? undefined : (window as unknown as MuteWindow)): MuteState {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (truthy(env?.SONOBE_MUTE)) return { muted: true, reason: "env" };
  try {
    const params = new URLSearchParams(win?.location?.search ?? "");
    if (params.has("mute") && !/^(0|false|no|off)$/i.test(params.get("mute") ?? "")) return { muted: true, reason: "query" };
  } catch {
    // No usable location.
  }
  if (win?.sonobeHost?.muted === true) return { muted: true, reason: "host" };
  if (win?.navigator?.webdriver === true) return { muted: true, reason: "automation" };
  return { muted: false, reason: null };
}

/** A mute switch of its own (tests, or a page with several prototypes). */
export function createMuteStore(initial: MuteState = { muted: false, reason: null }): MuteStore {
  let state = { ...initial };
  const listeners = new Set<(state: MuteState, previous: MuteState) => void>();
  return {
    getState: () => state,
    setState(next) {
      const previous = state;
      state = { muted: next.muted, reason: next.reason };
      for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let muteStore: MuteStore | null = null;

/** The page-wide mute switch (seeded from detectMuted on first use). */
export function getMuteStore(): MuteStore {
  muteStore ??= createMuteStore(detectMuted());
  return muteStore;
}

export const isMuted = (): boolean => getMuteStore().getState().muted;

export function setMuted(muted: boolean, reason = "user"): void {
  getMuteStore().setState({ muted, reason: muted ? reason : null });
}

// ---------------------------------------------------------------------------
// Options and helpers
// ---------------------------------------------------------------------------

export type PlatformWindow = Partial<Window & typeof globalThis> & {
  webkitAudioContext?: typeof AudioContext;
  sonobeHost?: { muted?: boolean };
};

export interface BrowserPlatformOptions {
  /** Default: globalThis.window. */
  window?: PlatformWindow;
  resolveAssetUrl?: (assetId: Id) => string | undefined;
  /** Asset bytes the host holds (faster than fetching the object URL). */
  readAssetBytes?: (assetId: Id) => Promise<ArrayBuffer | undefined>;
  /** Open links outside the app (desktop shell). Default: window.open. */
  openExternal?: (url: string) => boolean | void | Promise<boolean | void>;
  /** Default: the global mute switch. */
  mute?: MuteStore;
  /** The element drawing a layer in the primary viewer (pixel reads, frame ids). */
  layerElement?: (layer: LayerRef) => HTMLElement | undefined;
  fetch?: typeof globalThis.fetch;
}

export interface BrowserPlatform extends PlatformServices {
  /** The MediaStream behind a live reference ("camera/<key>", "microphone/<key>"). */
  liveStream(live: string): MediaStream | undefined;
  /** Live references with an open stream. */
  liveSources(): string[];
  /** Stop voices, speech, sockets, location watches, and captures (prototype restart). */
  reset(): void;
  dispose(): void;
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Links a prototype may open. */
export const OPENABLE_URL_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

/** A live reference's stream key: {live} or the interim `sonobe-live:` URL encoding. */
export function liveKeyOf(ref: AssetRef | null | undefined): string | undefined {
  if (!ref) return undefined;
  if (typeof ref.live === "string" && ref.live) return ref.live;
  if (typeof ref.url === "string" && ref.url.startsWith("sonobe-live:")) return ref.url.slice("sonobe-live:".length);
  return undefined;
}

// ---------------------------------------------------------------------------
// Audio voices
// ---------------------------------------------------------------------------

interface Voice {
  key: string;
  url: string | null;
  el: HTMLAudioElement | null;
  status: AudioVoiceStatus;
  opts: AudioVoiceOptions;
  loops: number;
  lastTime: number;
  pendingSeek: number | null;
  nodes: { source: MediaElementAudioSourceNode; panner: StereoPannerNode | null; analyser: AnalyserNode } | null;
  cleanup: () => void;
}

function readMeter(analyser: AnalyserNode, bands: number): AudioMeterReading {
  const time = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(time);
  let sum = 0;
  let peak = 0;
  for (const v of time) {
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(sum / Math.max(1, time.length));
  const count = Math.max(0, Math.floor(bands));
  const out: number[] = [];
  if (count > 0) {
    const freq = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freq);
    // Log-spaced bands from the lowest bin to the highest.
    const n = freq.length;
    for (let b = 0; b < count; b++) {
      const lo = Math.floor(Math.pow(n, b / count));
      const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (b + 1) / count)));
      let total = 0;
      for (let i = lo; i < hi && i < n; i++) total += freq[i]!;
      out.push(clamp(total / Math.max(1, Math.min(hi, n) - lo) / 255, 0, 1));
    }
  }
  return { rms: clamp(rms * Math.SQRT2, 0, 1), peak: clamp(peak, 0, 1), bands: out };
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export function createBrowserPlatform(options: BrowserPlatformOptions = {}): BrowserPlatform {
  const win: PlatformWindow | undefined = options.window ?? (typeof window === "undefined" ? undefined : (window as unknown as PlatformWindow));
  const nav = win?.navigator;
  const doc = win?.document;
  const mute = options.mute ?? getMuteStore();
  const muted = () => mute.getState().muted;
  const fetchImpl = options.fetch ?? (typeof win?.fetch === "function" ? win.fetch.bind(win) : typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  const createdUrls = new Set<string>();
  const cleanups = new Set<() => void>();
  let disposed = false;

  const resolveUrl = (ref: AssetRef): string | undefined => {
    if (ref.url && !ref.url.startsWith("sonobe-live:")) return ref.url;
    if (ref.assetId) return options.resolveAssetUrl?.(ref.assetId);
    return undefined;
  };

  const objectUrl = (blob: Blob): string | undefined => {
    const URLs = win?.URL ?? globalThis.URL;
    if (typeof URLs?.createObjectURL !== "function") return undefined;
    const url = URLs.createObjectURL(blob);
    createdUrls.add(url);
    return url;
  };

  const revoke = (url: string) => {
    if (!createdUrls.delete(url)) return;
    try {
      (win?.URL ?? globalThis.URL).revokeObjectURL(url);
    } catch {
      // Already gone.
    }
  };

  let audioContext: AudioContext | null = null;
  const getAudioContext = (): AudioContext | null => {
    if (audioContext) return audioContext;
    const Ctor = win?.AudioContext ?? win?.webkitAudioContext;
    if (typeof Ctor !== "function") return null;
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
    return audioContext;
  };

  const platform: PlatformServices = {};

  // ---- fetch ----------------------------------------------------------------
  if (fetchImpl) {
    const buildForm = async (fields: readonly FetchFormField[]): Promise<FormData> => {
      const FormDataCtor = win?.FormData ?? globalThis.FormData;
      const form = new FormDataCtor();
      for (const field of fields) {
        if (typeof field.value === "string") {
          form.append(field.name, field.value);
          continue;
        }
        const value = field.value;
        const url = value.url ?? (value.assetId ? options.resolveAssetUrl?.(value.assetId) : undefined);
        if (!url) throw new Error(`The file for form field "${field.name}" isn't available.`);
        let blob = await (await fetchImpl(url)).blob();
        if (value.mime) blob = new Blob([blob], { type: value.mime });
        const filename = value.filename ?? (url.startsWith("blob:") ? field.name : url.split(/[?#]/)[0]!.split("/").at(-1) || field.name);
        form.append(field.name, blob, filename);
      }
      return form;
    };

    const streamText = async (body: ReadableStream<Uint8Array>, onChunk: (text: string) => void): Promise<string> => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let out = "";
      const emit = (chunk: string) => {
        if (!chunk) return;
        out += chunk;
        try {
          onChunk(chunk);
        } catch {
          // A patch callback failing doesn't stop the download.
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        emit(decoder.decode(value, { stream: true }));
      }
      emit(decoder.decode());
      return out;
    };

    platform.fetch = async (url: string, init: FetchInit = {}): Promise<FetchResponse> => {
      const method = (init.method ?? "GET").toUpperCase();
      const headers: Record<string, string> = { ...init.headers };
      let body: BodyInit | undefined;
      if (typeof init.body === "string") body = init.body;
      else if (init.body && "form" in init.body) {
        body = await buildForm(init.body.form);
        for (const name of Object.keys(headers)) if (name.toLowerCase() === "content-type") delete headers[name];
      }
      const request: RequestInit = { method, headers };
      if (body !== undefined && method !== "GET" && method !== "HEAD") request.body = body;
      if (init.signal) request.signal = init.signal;
      const res = await fetchImpl(url, request);
      const responseHeaders: Record<string, string> = {};
      res.headers?.forEach?.((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });
      let text: Promise<string> | null = null;
      const readText = () => (text ??= init.onChunk && res.body && typeof res.body.getReader === "function" ? streamText(res.body, init.onChunk) : res.text());
      // Streams start delivering chunks as soon as they arrive, before anyone awaits text().
      if (init.onChunk) readText().catch(() => undefined);
      return { ok: res.ok, status: res.status, url: res.url || url, headers: responseHeaders, text: readText };
    };
  }

  // ---- readBytes --------------------------------------------------------------
  if (fetchImpl || options.readAssetBytes) {
    platform.readBytes = async (ref) => {
      if (liveKeyOf(ref)) throw new Error("Live camera and microphone feeds can't be read as bytes. Capture a photo or a recording first.");
      if (ref.assetId && options.readAssetBytes) {
        const held = await options.readAssetBytes(ref.assetId);
        if (held) return held;
      }
      const url = resolveUrl(ref);
      if (!url) throw new Error(ref.assetId ? `The file for asset "${ref.assetId}" isn't available.` : "There's no media to read.");
      if (!fetchImpl) throw new Error("This viewer can't download media.");
      const res = await fetchImpl(url);
      if (!res.ok && res.status !== 0) throw new Error(`Couldn't read the media (HTTP ${res.status}).`);
      return res.arrayBuffer();
    };
  }

  // ---- links ------------------------------------------------------------------
  platform.openUrl = (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (!OPENABLE_URL_SCHEMES.has(parsed.protocol)) return false;
    if (options.openExternal) {
      try {
        return Promise.resolve(options.openExternal(parsed.href)).then(
          (opened) => opened !== false,
          () => false,
        );
      } catch {
        return false;
      }
    }
    if (typeof win?.open !== "function") return false;
    try {
      win.open(parsed.href, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  };

  // ---- speech -----------------------------------------------------------------
  const synth = win?.speechSynthesis;
  const Utterance = win?.SpeechSynthesisUtterance;
  const utterances = new Set<{ settle: (how: "ended" | "interrupted") => void }>();
  const stopSpeaking = () => {
    try {
      synth?.cancel();
    } catch {
      // Speech engine gone.
    }
    for (const u of [...utterances]) u.settle("interrupted");
  };
  const speakSilently = (text: string, rate: number) =>
    new Promise<"ended" | "interrupted">((resolve) => {
      // Muted runs keep the timing of real speech: about 15 characters a second at rate 1.
      const ms = Math.min(60_000, Math.max(250, (text.length * 66) / Math.max(0.1, rate)));
      const handle = {
        settle: (how: "ended" | "interrupted") => {
          clearTimeout(timer);
          utterances.delete(handle);
          resolve(how);
        },
      };
      const timer = setTimeout(() => handle.settle("ended"), ms);
      utterances.add(handle);
    });
  if ((synth && typeof Utterance === "function") || typeof win !== "undefined") {
    platform.speak = (text: string, opts: SpeechOptions = {}) => {
      const rate = clamp(opts.rate ?? 1, 0.1, 10);
      if (muted() || !synth || typeof Utterance !== "function") return speakSilently(text, rate);
      return new Promise<"ended" | "interrupted">((resolve) => {
        const utterance = new Utterance(text);
        utterance.rate = rate;
        utterance.pitch = clamp(opts.pitch ?? 1, 0, 2);
        utterance.volume = clamp(opts.volume ?? 1, 0, 1);
        if (opts.voice) {
          const wanted = opts.voice.toLowerCase();
          const voice = synth.getVoices?.().find((v) => v.name.toLowerCase() === wanted || v.voiceURI?.toLowerCase() === wanted) ?? synth.getVoices?.().find((v) => v.lang?.toLowerCase().startsWith(wanted));
          if (voice) utterance.voice = voice;
        }
        const handle = {
          settle: (how: "ended" | "interrupted") => {
            if (!utterances.delete(handle)) return;
            resolve(how);
          },
        };
        utterances.add(handle);
        utterance.onend = () => handle.settle("ended");
        utterance.onerror = () => handle.settle("interrupted");
        try {
          synth.speak(utterance);
        } catch {
          handle.settle("interrupted");
        }
      });
    };
    platform.stopSpeaking = stopSpeaking;
  }

  // ---- vibration --------------------------------------------------------------
  if (typeof nav?.vibrate === "function") {
    platform.vibrate = (pattern) => {
      try {
        nav.vibrate(pattern);
      } catch {
        // Blocked without a user gesture.
      }
    };
  }

  /**
   * Run `fn` inside the next user gesture (media and permission prompts need one). A mouse press
   * counts on pointerdown, a touch or pen only once it lifts (pointerup), as browsers decide.
   */
  const onNextGesture = (fn: () => void): boolean => {
    if (typeof win?.addEventListener !== "function") return false;
    const events = ["pointerdown", "pointerup", "keydown"];
    const capture = { capture: true };
    const remove = () => {
      for (const name of events) win.removeEventListener?.(name, handler, capture);
      cleanups.delete(remove);
    };
    const handler = (event: Event) => {
      const pointerType = (event as PointerEvent).pointerType;
      if (event.type === "pointerdown" && (pointerType === "touch" || pointerType === "pen")) return;
      remove();
      fn();
    };
    for (const name of events) win.addEventListener(name, handler, capture);
    cleanups.add(remove);
    return true;
  };

  // ---- audio voices -------------------------------------------------------------
  const voices = new Map<string, Voice>();
  const AudioCtor = win?.Audio;
  let gestureArmed = false;
  const retryBlocked = () => {
    gestureArmed = false;
    for (const voice of voices.values()) if (voice.status === "blocked") startVoice(voice);
  };
  const armGestureRetry = () => {
    if (gestureArmed) return;
    gestureArmed = onNextGesture(() => {
      void audioContext?.resume?.();
      retryBlocked();
    });
  };

  const ensureNodes = (voice: Voice) => {
    if (voice.nodes || !voice.el) return voice.nodes;
    const ctx = getAudioContext();
    if (!ctx) return null;
    try {
      const source = ctx.createMediaElementSource(voice.el);
      const panner = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      if (panner) {
        source.connect(panner);
        panner.connect(analyser);
      } else source.connect(analyser);
      analyser.connect(ctx.destination);
      voice.nodes = { source, panner, analyser };
    } catch {
      voice.nodes = null;
    }
    return voice.nodes;
  };

  const applyVoiceOptions = (voice: Voice, opts: AudioVoiceOptions) => {
    voice.opts = { ...opts };
    const el = voice.el;
    if (!el) return;
    el.loop = opts.loop;
    el.volume = clamp(opts.volume, 0, 1);
    el.muted = muted();
    const pitch = Number.isFinite(opts.pitch) ? opts.pitch : 0;
    // HTML media can't shift pitch alone: a pitch change also changes speed (like a record player).
    const rate = clamp((opts.rate > 0 ? opts.rate : 1) * Math.pow(2, pitch / 12), 0.0625, 16);
    if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = pitch === 0;
    if (Math.abs(opts.pan) > 1e-3 || voice.nodes) {
      const nodes = ensureNodes(voice);
      if (nodes?.panner) nodes.panner.pan.value = clamp(opts.pan, -1, 1);
    }
  };

  const startVoice = (voice: Voice) => {
    const el = voice.el;
    if (!el) return;
    if (voice.status !== "playing") voice.status = el.readyState >= 3 ? "playing" : "loading";
    let result: Promise<void> | undefined;
    try {
      result = el.play();
    } catch (err) {
      voice.status = "error";
      void err;
      return;
    }
    Promise.resolve(result).then(
      () => {
        if (voices.get(voice.key) === voice && voice.status !== "ended" && voice.status !== "paused") voice.status = "playing";
      },
      (err: unknown) => {
        if (voices.get(voice.key) !== voice) return;
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError") {
          voice.status = "blocked";
          armGestureRetry();
        } else if (name !== "AbortError") voice.status = "error";
      },
    );
  };

  const stopVoice = (key: string) => {
    const voice = voices.get(key);
    if (!voice) return;
    voices.delete(key);
    voice.cleanup();
    const el = voice.el;
    if (el) {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load?.();
      } catch {
        // Element already gone.
      }
    }
    try {
      voice.nodes?.source.disconnect();
      voice.nodes?.panner?.disconnect();
      voice.nodes?.analyser.disconnect();
    } catch {
      // Already disconnected.
    }
  };

  if (typeof AudioCtor === "function") {
    const audio: AudioServices = {
      play(key, source, opts) {
        const url = resolveUrl(source) ?? null;
        const existing = voices.get(key);
        const from = Number.isFinite(opts.from) ? Math.max(0, opts.from) : 0;
        if (existing && existing.url === url && existing.el) {
          applyVoiceOptions(existing, opts);
          if (Math.abs(existing.el.currentTime - from) > 0.05) audio.seek(key, from);
          if (existing.status === "ended") existing.loops = 0;
          if (existing.el.paused || existing.status !== "playing") {
            existing.status = "loading";
            startVoice(existing);
          }
          return;
        }
        stopVoice(key);
        const voice: Voice = { key, url, el: null, status: url ? "loading" : "error", opts: { ...opts }, loops: 0, lastTime: from, pendingSeek: from > 0 ? from : null, nodes: null, cleanup: () => undefined };
        voices.set(key, voice);
        if (!url) return;
        const el = new AudioCtor();
        voice.el = el;
        el.preload = "auto";
        const onMeta = () => {
          if (voice.pendingSeek !== null) {
            try {
              el.currentTime = voice.pendingSeek;
            } catch {
              // Not seekable yet.
            }
            voice.pendingSeek = null;
          }
        };
        const onEnded = () => {
          if (!el.loop) voice.status = "ended";
        };
        const onError = () => {
          voice.status = "error";
        };
        el.addEventListener("loadedmetadata", onMeta);
        el.addEventListener("ended", onEnded);
        el.addEventListener("error", onError);
        voice.cleanup = () => {
          el.removeEventListener("loadedmetadata", onMeta);
          el.removeEventListener("ended", onEnded);
          el.removeEventListener("error", onError);
        };
        el.src = url;
        applyVoiceOptions(voice, opts);
        if (el.readyState >= 1) onMeta();
        startVoice(voice);
      },
      pause(key) {
        const voice = voices.get(key);
        if (!voice?.el) return;
        voice.el.pause();
        if (voice.status !== "ended" && voice.status !== "error") voice.status = "paused";
      },
      seek(key, seconds) {
        const voice = voices.get(key);
        if (!voice?.el) return;
        const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
        voice.lastTime = t;
        if (voice.el.readyState >= 1) {
          try {
            voice.el.currentTime = t;
          } catch {
            voice.pendingSeek = t;
          }
        } else voice.pendingSeek = t;
        if (voice.status === "ended") voice.status = "paused";
      },
      update(key, opts) {
        const voice = voices.get(key);
        if (voice) applyVoiceOptions(voice, opts);
      },
      stop: stopVoice,
      state(key): AudioVoiceState | undefined {
        const voice = voices.get(key);
        if (!voice) return undefined;
        const el = voice.el;
        if (!el) return { status: voice.status, currentTime: 0, duration: 0, ended: false, loops: 0 };
        const t = Number.isFinite(el.currentTime) ? el.currentTime : 0;
        const duration = Number.isFinite(el.duration) ? el.duration : 0;
        if (voice.opts.loop && duration > 0 && t + duration * 0.25 < voice.lastTime) voice.loops++;
        voice.lastTime = t;
        return { status: voice.status, currentTime: t, duration, ended: voice.status === "ended", loops: voice.loops };
      },
      meter(source: AudioMeterSource, bands: number) {
        if (!("live" in source)) return undefined;
        const live = source.live;
        if (live.startsWith("audio/")) {
          const voice = voices.get(live.slice("audio/".length));
          const nodes = voice ? ensureNodes(voice) : null;
          return nodes ? readMeter(nodes.analyser, bands) : undefined;
        }
        const capture = captures.get(live);
        const analyser = capture ? captureAnalyser(capture) : null;
        return analyser ? readMeter(analyser, bands) : undefined;
      },
    };
    platform.audio = audio;
  }

  const unsubscribeMute = mute.subscribe((state, previous) => {
    if (state.muted === previous.muted) return;
    for (const voice of voices.values()) if (voice.el) voice.el.muted = state.muted;
    if (state.muted) stopSpeaking();
  });

  // ---- WebSockets ---------------------------------------------------------------
  const sockets = new Set<{ close: () => void }>();
  const WebSocketCtor = win?.WebSocket;
  if (typeof WebSocketCtor === "function") {
    platform.webSocket = (url, opts) => {
      let ws: WebSocket | null = null;
      const tracked = { close: () => ws?.close(1001, "Prototype restarted") };
      const socket: PlatformWebSocket = {
        send(text) {
          if (!ws || ws.readyState !== 1) {
            socket.onerror?.("The connection isn't open yet.");
            return;
          }
          try {
            ws.send(text);
          } catch (err) {
            socket.onerror?.(errorMessage(err));
          }
        },
        close(code, reason) {
          try {
            ws?.close(code, reason);
          } catch {
            ws?.close();
          }
        },
        get bufferedAmount() {
          return ws?.bufferedAmount ?? 0;
        },
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      try {
        ws = opts.protocols?.length ? new WebSocketCtor(url, opts.protocols) : new WebSocketCtor(url);
      } catch (err) {
        const message = errorMessage(err);
        queueMicrotask(() => {
          socket.onerror?.(`Couldn't connect to ${url}: ${message}`);
          socket.onclose?.(1006, message);
        });
        return socket;
      }
      ws.binaryType = "arraybuffer";
      sockets.add(tracked);
      ws.onopen = () => socket.onopen?.();
      ws.onmessage = (event: MessageEvent) => {
        const data: unknown = event.data;
        socket.onmessage?.(typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data));
      };
      ws.onerror = () => socket.onerror?.(`The connection to ${url} failed.`);
      ws.onclose = (event: CloseEvent) => {
        sockets.delete(tracked);
        socket.onclose?.(event.code, event.reason);
      };
      return socket;
    };
  }

  // ---- location ---------------------------------------------------------------
  const geoWatches = new Set<() => void>();
  const geo = nav?.geolocation;
  if (geo && typeof geo.watchPosition === "function") {
    const services: GeolocationServices = {
      watch(onFix, onError) {
        const id = geo.watchPosition(
          (position) => onFix({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
          (err) => onError(err.message || (err.code === 1 ? "Location permission was denied." : err.code === 2 ? "The location isn't available." : "Finding the location took too long.")),
          { enableHighAccuracy: true, maximumAge: 1000 },
        );
        const stop = () => {
          if (!geoWatches.delete(stop)) return;
          geo.clearWatch(id);
        };
        geoWatches.add(stop);
        return { stop };
      },
    };
    platform.geolocation = services;
  }

  // ---- gamepads -----------------------------------------------------------------
  if (typeof nav?.getGamepads === "function") {
    platform.gamepads = () => {
      let pads: readonly (Gamepad | null)[];
      try {
        pads = Array.from(nav.getGamepads() ?? []);
      } catch {
        return [];
      }
      return pads.map((pad): GamepadSnapshot | null =>
        pad ? { connected: pad.connected, mapping: pad.mapping || "", buttons: Array.from(pad.buttons, (b) => ({ pressed: b.pressed, value: b.value })), axes: Array.from(pad.axes) } : null,
      );
    };
  }

  // ---- device motion --------------------------------------------------------------
  if (typeof win?.DeviceMotionEvent === "function" && typeof win.addEventListener === "function") {
    let sample: DeviceMotionSample | undefined;
    let attitude: [number, number, number] | undefined;
    let listening = false;
    const G = 9.80665;
    const onMotion = (event: Event) => {
      const e = event as DeviceMotionEvent;
      const a = e.accelerationIncludingGravity;
      const r = e.rotationRate;
      sample = {
        acceleration: [(a?.x ?? 0) / G, (a?.y ?? 0) / G, (a?.z ?? 0) / G],
        rotationRate: [r?.beta ?? 0, r?.gamma ?? 0, r?.alpha ?? 0],
        ...(attitude ? { attitude } : {}),
      };
    };
    const onOrientation = (event: Event) => {
      const e = event as DeviceOrientationEvent;
      if (e.beta === null && e.gamma === null && e.alpha === null) return;
      attitude = [e.beta ?? 0, e.gamma ?? 0, e.alpha ?? 0];
      if (sample) sample = { ...sample, attitude };
    };
    const listen = () => {
      if (disposed) return;
      win.addEventListener!("devicemotion", onMotion);
      win.addEventListener!("deviceorientation", onOrientation);
      cleanups.add(() => {
        win.removeEventListener?.("devicemotion", onMotion);
        win.removeEventListener?.("deviceorientation", onOrientation);
      });
    };
    type PermissionEvent = { requestPermission?: () => Promise<string> };
    const motionPermission = (win.DeviceMotionEvent as unknown as PermissionEvent).requestPermission;
    const orientationPermission = (win.DeviceOrientationEvent as unknown as PermissionEvent | undefined)?.requestPermission;
    platform.deviceMotion = () => {
      if (!listening) {
        listening = true;
        // iOS asks the person first, and only from inside a tap.
        if (typeof motionPermission === "function") {
          const ask = () =>
            onNextGesture(() => {
              // Both prompts start inside the gesture; attitude simply stays unknown without the second.
              if (typeof orientationPermission === "function") void orientationPermission.call(win.DeviceOrientationEvent).catch(() => undefined);
              void motionPermission.call(win.DeviceMotionEvent).then(
                (state) => {
                  if (state === "granted") listen();
                },
                (err: unknown) => {
                  // Refused for want of a gesture, not by the person: ask again on the next one.
                  if ((err as { name?: string } | null)?.name === "NotAllowedError" && !disposed) ask();
                },
              );
            });
          ask();
        } else listen();
      }
      return sample;
    };
  }

  // ---- soft keyboard --------------------------------------------------------------
  if (win?.visualViewport) {
    platform.softKeyboard = (): SoftKeyboardSnapshot | undefined => {
      const vv = win.visualViewport;
      if (!vv || typeof win.innerHeight !== "number" || Math.abs(vv.scale - 1) > 0.01) return undefined;
      const covered = Math.max(0, win.innerHeight - vv.height - vv.offsetTop);
      return covered > 120 ? { visible: true, height: covered } : { visible: false, height: 0 };
    };
  }

  // ---- picking media --------------------------------------------------------------
  const measure = (url: string, kind: "image" | "video"): Promise<[number, number]> =>
    new Promise((resolve) => {
      if (!doc) {
        resolve([0, 0]);
        return;
      }
      const timer = setTimeout(() => resolve([0, 0]), 3000);
      const done = (size: [number, number]) => {
        clearTimeout(timer);
        resolve(size);
      };
      if (kind === "image") {
        const img = doc.createElement("img");
        img.onload = () => done([img.naturalWidth, img.naturalHeight]);
        img.onerror = () => done([0, 0]);
        img.src = url;
      } else {
        const video = doc.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.onloadedmetadata = () => done([video.videoWidth, video.videoHeight]);
        video.onerror = () => done([0, 0]);
        video.src = url;
      }
    });

  if (doc && typeof doc.createElement === "function") {
    platform.pickMedia = (opts) =>
      new Promise<readonly PickedMedia[]>((resolve) => {
        const input = doc.createElement("input");
        input.type = "file";
        input.accept = opts.accept === "photos" ? "image/*" : opts.accept === "videos" ? "video/*" : "image/*,video/*";
        input.multiple = opts.multiple;
        input.style.display = "none";
        let settled = false;
        let focusTimer: ReturnType<typeof setTimeout> | undefined;
        const onFocus = () => {
          // Browsers without a "cancel" event: focus comes back without a change.
          focusTimer = setTimeout(() => {
            if (!input.files?.length) finish([]);
          }, 600);
        };
        const cleanup = () => {
          clearTimeout(focusTimer);
          win?.removeEventListener?.("focus", onFocus);
          input.remove();
        };
        const finish = (files: File[]) => {
          if (settled) return;
          settled = true;
          cleanup();
          void Promise.all(
            files
              .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
              .map(async (file): Promise<PickedMedia | null> => {
                const kind = file.type.startsWith("video/") ? "video" : "image";
                const url = objectUrl(file);
                if (!url) return null;
                const [width, height] = await measure(url, kind);
                return { kind, image: kind === "image" ? { url } : null, video: kind === "video" ? { url } : null, width, height, name: file.name };
              }),
          ).then((picked) => resolve(picked.filter((p): p is PickedMedia => p !== null)));
        };
        input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
        input.addEventListener("cancel", () => finish([]));
        doc.body?.appendChild(input);
        win?.addEventListener?.("focus", onFocus);
        try {
          input.click();
        } catch {
          finish([]);
        }
      });
  }

  platform.releaseMedia = (ref) => {
    if (ref.url) revoke(ref.url);
  };

  platform.snapshot = () => Promise.reject(new Error("Snapshots of layers aren't available in the live viewer yet. Use a Camera patch's capture, or an image layer's own picture."));

  // ---- camera and microphone --------------------------------------------------------
  interface Capture {
    live: string;
    kind: "camera" | "microphone";
    stream: MediaStream;
    video: HTMLVideoElement | null;
    analyser: AnalyserNode | null;
    source: MediaStreamAudioSourceNode | null;
    recording: { started: Promise<{ recorder: MediaRecorder; chunks: Blob[]; startedAt: number; extra: MediaStream | null } | null> } | null;
  }
  const captures = new Map<string, Capture>();
  const captureAnalyser = (capture: Capture): AnalyserNode | null => {
    if (capture.analyser) return capture.analyser;
    if (capture.stream.getAudioTracks().length === 0) return null;
    const ctx = getAudioContext();
    if (!ctx || typeof ctx.createMediaStreamSource !== "function") return null;
    try {
      capture.source = ctx.createMediaStreamSource(capture.stream);
      capture.analyser = ctx.createAnalyser();
      capture.analyser.fftSize = 1024;
      capture.source.connect(capture.analyser);
    } catch {
      capture.analyser = null;
    }
    return capture.analyser;
  };
  const stopCapture = (live: string) => {
    const capture = captures.get(live);
    if (!capture) return;
    captures.delete(live);
    for (const track of capture.stream.getTracks?.() ?? []) track.stop();
    capture.recording?.started.then((rec) => {
      if (rec && rec.recorder.state !== "inactive") rec.recorder.stop();
      for (const track of rec?.extra?.getTracks() ?? []) track.stop();
    });
    try {
      capture.source?.disconnect();
    } catch {
      // Already disconnected.
    }
    if (capture.video) {
      capture.video.srcObject = null;
      capture.video.remove();
    }
  };
  const media = nav?.mediaDevices;
  const layerMedia = (layer: LayerRef): HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | undefined => {
    const el = options.layerElement?.(layer);
    return (el?.querySelector("video[data-sonobe-live], video, img, canvas") as HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null) ?? undefined;
  };
  const frameCounters = new WeakMap<Element, { key: string; id: number }>();
  const frameIdOf = (el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): number => {
    const signature = el instanceof HTMLVideoElement ? `${el.currentSrc || (el.srcObject ? "live" : "")}|${el.currentTime.toFixed(3)}|${el.readyState}` : el instanceof HTMLImageElement ? `${el.currentSrc || el.src}|${el.complete}` : `canvas|${Date.now() >> 4}`;
    const counter = frameCounters.get(el);
    if (!counter) {
      frameCounters.set(el, { key: signature, id: 1 });
      return 1;
    }
    if (counter.key !== signature) {
      counter.key = signature;
      counter.id++;
    }
    return counter.id;
  };
  if (media && typeof media.getUserMedia === "function") {
    const capture: MediaCaptureServices = {
      async openCamera(key, opts) {
        const live = `camera/${key}`;
        stopCapture(live);
        const [width, height] = opts.quality === "low" ? [640, 480] : opts.quality === "high" ? [1920, 1080] : [1280, 720];
        const stream = await media.getUserMedia({ video: { facingMode: opts.facing === "front" ? "user" : "environment", width: { ideal: width }, height: { ideal: height } }, audio: false });
        if (disposed) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("The prototype stopped.");
        }
        captures.set(live, { live, kind: "camera", stream, video: null, analyser: null, source: null, recording: null });
        return { live };
      },
      async openMicrophone(key) {
        const live = `microphone/${key}`;
        stopCapture(live);
        const stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (disposed) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("The prototype stopped.");
        }
        captures.set(live, { live, kind: "microphone", stream, video: null, analyser: null, source: null, recording: null });
        return { live };
      },
      close(key) {
        stopCapture(`camera/${key}`);
        stopCapture(`microphone/${key}`);
      },
      async captureFrame(key) {
        const cap = captures.get(`camera/${key}`);
        if (!cap || !doc) throw new Error("The camera isn't running.");
        if (!cap.video) {
          const video = doc.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.srcObject = cap.stream;
          cap.video = video;
          void video.play?.().catch(() => undefined);
        }
        const video = cap.video;
        if (video.readyState < 2) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 2000);
            video.addEventListener("loadeddata", () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
        const canvas = doc.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        const url = blob ? objectUrl(blob) : undefined;
        if (!url) throw new Error("Couldn't capture a photo.");
        return { url };
      },
      startRecording(key, opts) {
        const cap = captures.get(`camera/${key}`) ?? captures.get(`microphone/${key}`);
        const Recorder = win?.MediaRecorder;
        if (!cap || typeof Recorder !== "function" || cap.recording) return;
        const started = (async () => {
          let extra: MediaStream | null = null;
          const tracks = [...cap.stream.getTracks()];
          if (opts.audio && cap.kind === "camera" && cap.stream.getAudioTracks().length === 0) {
            try {
              extra = await media.getUserMedia({ audio: true, video: false });
              tracks.push(...extra.getAudioTracks());
            } catch {
              extra = null;
            }
          }
          const MediaStreamCtor = win?.MediaStream;
          const stream = typeof MediaStreamCtor === "function" ? new MediaStreamCtor(tracks) : cap.stream;
          const recorder = new Recorder(stream);
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.start(250);
          return { recorder, chunks, startedAt: Date.now(), extra };
        })().catch(() => null);
        cap.recording = { started };
      },
      async stopRecording(key) {
        const cap = captures.get(`camera/${key}`) ?? captures.get(`microphone/${key}`);
        const recording = cap?.recording;
        if (!cap || !recording) return null;
        cap.recording = null;
        const rec = await recording.started;
        if (!rec) return null;
        const seconds = (Date.now() - rec.startedAt) / 1000;
        await new Promise<void>((resolve) => {
          if (rec.recorder.state === "inactive") resolve();
          else {
            rec.recorder.addEventListener("stop", () => resolve(), { once: true });
            rec.recorder.stop();
          }
        });
        for (const track of rec.extra?.getTracks() ?? []) track.stop();
        if (seconds < 0.1 || rec.chunks.length === 0) return null;
        const url = objectUrl(new Blob(rec.chunks, { type: rec.recorder.mimeType || (cap.kind === "camera" ? "video/webm" : "audio/webm") }));
        return url ? { url } : null;
      },
      level(key) {
        const cap = captures.get(`microphone/${key}`) ?? captures.get(`camera/${key}`);
        const analyser = cap ? captureAnalyser(cap) : null;
        return analyser ? readMeter(analyser, 0).rms : undefined;
      },
      frameId(layer) {
        const el = layerMedia(layer);
        return el ? frameIdOf(el) : undefined;
      },
      readPixels(layer, maxSize): PixelReading | undefined {
        const el = layerMedia(layer);
        const host = options.layerElement?.(layer);
        if (!el || !host || !doc) return undefined;
        const contentW = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : el.width;
        const contentH = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : el.height;
        if (!(contentW > 0) || !(contentH > 0)) return undefined;
        const scale = Math.min(1, Math.max(1, maxSize) / Math.max(contentW, contentH));
        const width = Math.max(1, Math.round(contentW * scale));
        const height = Math.max(1, Math.round(contentH * scale));
        const canvas = doc.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx2d) return undefined;
        let data: Uint8ClampedArray;
        try {
          ctx2d.drawImage(el, 0, 0, width, height);
          data = ctx2d.getImageData(0, 0, width, height).data;
        } catch {
          return undefined; // Cross-origin media taints the canvas.
        }
        const layerW = host.offsetWidth || contentW;
        const layerH = host.offsetHeight || contentH;
        const fit = win?.getComputedStyle?.(el).objectFit ?? "fill";
        let rect: [number, number, number, number] = [0, 0, layerW, layerH];
        if (fit === "contain" || fit === "cover") {
          const s = fit === "contain" ? Math.min(layerW / contentW, layerH / contentH) : Math.max(layerW / contentW, layerH / contentH);
          const w = contentW * s;
          const h = contentH * s;
          rect = [(layerW - w) / 2, (layerH - h) / 2, w, h];
        }
        return { width, height, data, frameId: frameIdOf(el), contentSize: [contentW, contentH], contentRect: rect };
      },
    };
    platform.media = capture;
  }

  // ---- lifecycle ------------------------------------------------------------------
  const reset = () => {
    for (const key of [...voices.keys()]) stopVoice(key);
    stopSpeaking();
    for (const socket of [...sockets]) socket.close();
    sockets.clear();
    for (const stop of [...geoWatches]) stop();
    for (const live of [...captures.keys()]) stopCapture(live);
    for (const url of [...createdUrls]) revoke(url);
  };

  return Object.assign(platform, {
    liveStream: (live: string) => captures.get(live)?.stream,
    liveSources: () => [...captures.keys()],
    reset,
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      unsubscribeMute();
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      void audioContext?.close?.().catch(() => undefined);
      audioContext = null;
    },
  });
}
