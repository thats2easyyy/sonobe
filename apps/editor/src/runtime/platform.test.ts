import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createBrowserPlatform, detectMuted, liveKeyOf, type MuteState, type PlatformWindow } from "./platform.ts";

const muteStore = (muted = false) => createStore<MuteState>()(() => ({ muted, reason: muted ? "test" : null }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static playResult: () => Promise<void> = () => Promise.resolve();
  src = "";
  preload = "";
  loop = false;
  volume = 1;
  muted = false;
  playbackRate = 1;
  currentTime = 0;
  duration = 3;
  readyState = 4;
  paused = true;
  preservesPitch = true;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play() {
    this.paused = false;
    return FakeAudio.playResult();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

type TestWindow = PlatformWindow & { dispatchEvent(event: Event): boolean };

function fakeWindow(extra: Record<string, unknown> = {}): TestWindow {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    Audio: FakeAudio,
    ...extra,
  } as unknown as TestWindow;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  FakeAudio.instances = [];
  FakeAudio.playResult = () => Promise.resolve();
});

describe("platform: network and links", () => {
  it("fetches with methods, headers, signals, and lowercase response headers", async () => {
    const calls: [string, RequestInit][] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init ?? {}]);
      return new Response("hello", { status: 201, headers: { "X-Test": "yes" } });
    });
    const platform = createBrowserPlatform({ window: fakeWindow(), fetch: fetch as never, mute: muteStore() });
    const controller = new AbortController();
    const res = await platform.fetch!("https://api.test/items", { method: "post", headers: { "Content-Type": "application/json" }, body: '{"a":1}', signal: controller.signal });
    expect(res).toMatchObject({ ok: true, status: 201, url: "https://api.test/items", headers: { "x-test": "yes" } });
    expect(calls[0]![1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}', signal: controller.signal });
    expect(await res.text()).toBe("hello");
    await platform.fetch!("https://api.test/items", { body: "ignored" });
    expect(calls[1]![1].body).toBeUndefined();
  });

  it("streams chunks as they arrive", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of ["Hel", "lo ", "world"]) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
    const platform = createBrowserPlatform({ window: fakeWindow(), fetch: (async () => new Response(stream)) as never, mute: muteStore() });
    const chunks: string[] = [];
    const res = await platform.fetch!("https://stream.test", { onChunk: (text) => chunks.push(text) });
    expect(await res.text()).toBe("Hello world");
    expect(await res.text()).toBe("Hello world");
    expect(chunks.join("")).toBe("Hello world");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("builds multipart forms with media files", async () => {
    let body: unknown;
    let headers: unknown;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "blob:photo") return new Response(new Blob([new Uint8Array([1, 2, 3])]));
      body = init?.body;
      headers = init?.headers;
      return new Response("ok");
    });
    const platform = createBrowserPlatform({ window: fakeWindow(), fetch: fetch as never, mute: muteStore(), resolveAssetUrl: (id) => (id === "photo" ? "blob:photo" : undefined) });
    await platform.fetch!("https://upload.test", {
      method: "POST",
      headers: { "content-type": "multipart/form-data", Authorization: "Bearer x" },
      body: { form: [{ name: "title", value: "Hi" }, { name: "photo", value: { assetId: "photo", filename: "me.png", mime: "image/png" } }] },
    });
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("title")).toBe("Hi");
    expect((form.get("photo") as File).name).toBe("me.png");
    expect((form.get("photo") as File).type).toBe("image/png");
    expect(headers).toEqual({ Authorization: "Bearer x" });
    await expect(platform.fetch!("https://upload.test", { method: "POST", body: { form: [{ name: "f", value: { assetId: "missing" } }] } })).rejects.toThrow('"f"');
  });

  it("opens only web, mail, and phone links", async () => {
    const open = vi.fn();
    const platform = createBrowserPlatform({ window: fakeWindow({ open }), mute: muteStore() });
    expect(platform.openUrl!("https://sonobe.dev/docs")).toBe(true);
    expect(open).toHaveBeenCalledWith("https://sonobe.dev/docs", "_blank", "noopener,noreferrer");
    expect(platform.openUrl!("javascript:alert(1)")).toBe(false);
    expect(platform.openUrl!("not a link")).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    const openExternal = vi.fn(async (url: string) => url.startsWith("mailto:"));
    const desktop = createBrowserPlatform({ window: fakeWindow({ open }), mute: muteStore(), openExternal });
    await expect(desktop.openUrl!("mailto:hi@sonobe.dev")).resolves.toBe(true);
    await expect(desktop.openUrl!("https://sonobe.dev")).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("reads bytes of assets and URLs, and says what it can't do", async () => {
    const platform = createBrowserPlatform({
      window: fakeWindow(),
      mute: muteStore(),
      fetch: (async () => new Response(new Uint8Array([5, 6]))) as never,
      readAssetBytes: async (id) => (id === "held" ? new Uint8Array([1]).buffer : undefined),
      resolveAssetUrl: (id) => (id === "remote" ? "https://x.test/a.bin" : undefined),
    });
    expect(new Uint8Array(await platform.readBytes!({ assetId: "held" }))).toEqual(new Uint8Array([1]));
    expect(new Uint8Array(await platform.readBytes!({ assetId: "remote" }))).toEqual(new Uint8Array([5, 6]));
    expect(new Uint8Array(await platform.readBytes!({ url: "https://x.test/b.bin" }))).toEqual(new Uint8Array([5, 6]));
    await expect(platform.readBytes!({ assetId: "missing" })).rejects.toThrow("isn't available");
    await expect(platform.readBytes!({ live: "camera/k" })).rejects.toThrow("Live");
    await expect(platform.snapshot!(null, { scale: 1 })).rejects.toThrow("Snapshots");
  });

  it("relays WebSocket events", async () => {
    class FakeSocket {
      static last: FakeSocket;
      readyState = 0;
      bufferedAmount = 7;
      binaryType = "blob";
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((e: { code: number; reason: string }) => void) | null = null;
      url: string;
      protocols: string[] | undefined;
      constructor(url: string, protocols?: string[]) {
        this.url = url;
        this.protocols = protocols;
        FakeSocket.last = this;
      }
      send(text: string) {
        this.sent.push(text);
      }
      close(code?: number, reason?: string) {
        this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
      }
    }
    const platform = createBrowserPlatform({ window: fakeWindow({ WebSocket: FakeSocket }), mute: muteStore() });
    const socket = platform.webSocket!("wss://echo.test", { protocols: ["chat"] });
    const events: string[] = [];
    socket.onopen = () => events.push("open");
    socket.onmessage = (text) => events.push(`message:${text}`);
    socket.onerror = (message) => events.push(`error:${message}`);
    socket.onclose = (code, reason) => events.push(`close:${code}:${reason}`);
    socket.send("early");
    const ws = FakeSocket.last;
    expect(ws).toMatchObject({ url: "wss://echo.test", protocols: ["chat"], binaryType: "arraybuffer" });
    ws.readyState = 1;
    ws.onopen!();
    socket.send("hi");
    ws.onmessage!({ data: "hello" });
    ws.onmessage!({ data: new TextEncoder().encode("bytes").buffer });
    expect(socket.bufferedAmount).toBe(7);
    socket.close(4000, "bye");
    expect(ws.sent).toEqual(["hi"]);
    expect(events).toEqual(["error:The connection isn't open yet.", "open", "message:hello", "message:bytes", "close:4000:bye"]);

    const blocked = createBrowserPlatform({
      window: fakeWindow({
        WebSocket: class {
          constructor() {
            throw new Error("Mixed content");
          }
        },
      }),
      mute: muteStore(),
    });
    const failed = blocked.webSocket!("ws://insecure.test", {});
    const failures: string[] = [];
    failed.onerror = (message) => failures.push(String(message));
    failed.onclose = (code) => failures.push(`close:${code}`);
    await flush();
    expect(failures).toEqual([expect.stringContaining("Mixed content"), "close:1006"]);
  });
});

describe("platform: speech and audio", () => {
  class FakeUtterance {
    rate = 1;
    pitch = 1;
    volume = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  }

  it("speaks through speechSynthesis and reports how it ended", async () => {
    const spoken: FakeUtterance[] = [];
    const synth = { speak: vi.fn((u: FakeUtterance) => spoken.push(u)), cancel: vi.fn(), getVoices: () => [{ name: "Samantha", voiceURI: "com.apple.Samantha", lang: "en-US" }] };
    const platform = createBrowserPlatform({ window: fakeWindow({ speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance }), mute: muteStore() });
    const done = platform.speak!("Hello there", { rate: 20, pitch: 1.5, voice: "samantha", volume: 3 }) as Promise<string>;
    expect(spoken[0]).toMatchObject({ text: "Hello there", rate: 10, pitch: 1.5, volume: 1, voice: { name: "Samantha" } });
    spoken[0]!.onend!();
    await expect(done).resolves.toBe("ended");
    const second = platform.speak!("Stop me") as Promise<string>;
    platform.stopSpeaking!();
    expect(synth.cancel).toHaveBeenCalled();
    await expect(second).resolves.toBe("interrupted");
  });

  it("stays silent while muted but keeps speech timing", async () => {
    vi.useFakeTimers();
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
    const mute = muteStore(true);
    const platform = createBrowserPlatform({ window: fakeWindow({ speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance }), mute });
    const done = platform.speak!("Hello") as Promise<string>;
    expect(synth.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe("ended");

    mute.setState({ muted: false, reason: null });
    const talking = platform.speak!("A long sentence to interrupt") as Promise<string>;
    expect(synth.speak).toHaveBeenCalledTimes(1);
    mute.setState({ muted: true, reason: "test" });
    expect(synth.cancel).toHaveBeenCalled();
    await expect(talking).resolves.toBe("interrupted");
  });

  it("plays keyed voices with loop, volume, pitch, pause, seek, and stop", async () => {
    const mute = muteStore();
    const platform = createBrowserPlatform({ window: fakeWindow(), mute, resolveAssetUrl: (id) => `blob:${id}` });
    const audio = platform.audio!;
    const key = "main/player#0";
    audio.play(key, { assetId: "song" }, { loop: false, volume: 0.5, rate: 1, pitch: 12, pan: 0, from: 1.5 });
    const el = FakeAudio.instances[0]!;
    expect(el).toMatchObject({ src: "blob:song", volume: 0.5, playbackRate: 2, preservesPitch: false, currentTime: 1.5, muted: false });
    await flush();
    expect(audio.state(key)).toEqual({ status: "playing", currentTime: 1.5, duration: 3, ended: false, loops: 0 });

    mute.setState({ muted: true, reason: "test" });
    expect(el.muted).toBe(true);
    audio.pause(key);
    expect(audio.state(key)?.status).toBe("paused");
    audio.seek(key, 0.25);
    expect(el.currentTime).toBe(0.25);
    audio.play(key, { assetId: "song" }, { loop: false, volume: 1, rate: 1, pitch: 0, pan: 0, from: 0.25 });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(el).toMatchObject({ volume: 1, playbackRate: 1, preservesPitch: true, muted: true, paused: false });
    el.dispatchEvent(new Event("ended"));
    expect(audio.state(key)).toMatchObject({ status: "ended", ended: true });

    audio.play("looper", { url: "https://x.test/a.mp3" }, { loop: true, volume: 1, rate: 1, pitch: 0, pan: 0, from: 0 });
    const looper = FakeAudio.instances[1]!;
    looper.currentTime = 2.5;
    audio.state("looper");
    looper.currentTime = 0.1;
    expect(audio.state("looper")?.loops).toBe(1);

    audio.stop(key);
    expect(audio.state(key)).toBeUndefined();
    expect(el.src).toBe("");
    audio.play("nothing", {}, { loop: false, volume: 1, rate: 1, pitch: 0, pan: 0, from: 0 });
    expect(audio.state("nothing")?.status).toBe("error");
    expect(audio.meter!({ layer: { layerId: "video" } }, 4)).toBeUndefined();
    platform.reset();
    expect(audio.state("looper")).toBeUndefined();
  });

  it("retries voices the browser blocked after the next gesture", async () => {
    const win = fakeWindow();
    const platform = createBrowserPlatform({ window: win, mute: muteStore() });
    FakeAudio.playResult = () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    platform.audio!.play("blocked", { url: "https://x.test/a.mp3" }, { loop: false, volume: 1, rate: 1, pitch: 0, pan: 0, from: 0 });
    await flush();
    expect(platform.audio!.state("blocked")?.status).toBe("blocked");
    FakeAudio.playResult = () => Promise.resolve();
    win.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(platform.audio!.state("blocked")?.status).toBe("playing");
  });
});

describe("platform: devices and capture", () => {
  it("watches location, reads gamepads, and vibrates", () => {
    const geolocation = {
      watchPosition: vi.fn((ok: (p: unknown) => void, err: (e: unknown) => void) => {
        ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 } });
        err({ code: 1, message: "" });
        return 9;
      }),
      clearWatch: vi.fn(),
    };
    const pads = [null, { connected: true, mapping: "standard", buttons: [{ pressed: true, value: 1 }], axes: [0.5, -0.5] }];
    const vibrate = vi.fn();
    const platform = createBrowserPlatform({ window: fakeWindow({ navigator: { geolocation, getGamepads: () => pads, vibrate } }), mute: muteStore() });
    const fixes: unknown[] = [];
    const errors: string[] = [];
    const watch = platform.geolocation!.watch((fix) => fixes.push(fix), (message) => errors.push(message));
    expect(fixes).toEqual([{ latitude: 1, longitude: 2, accuracy: 3 }]);
    expect(errors).toEqual(["Location permission was denied."]);
    watch.stop();
    watch.stop();
    expect(geolocation.clearWatch).toHaveBeenCalledTimes(1);
    platform.geolocation!.watch(() => undefined, () => undefined);
    platform.reset();
    expect(geolocation.clearWatch).toHaveBeenCalledTimes(2);

    expect(platform.gamepads!()).toEqual([null, { connected: true, mapping: "standard", buttons: [{ pressed: true, value: 1 }], axes: [0.5, -0.5] }]);
    platform.vibrate!([10, 20]);
    expect(vibrate).toHaveBeenCalledWith([10, 20]);
  });

  it("opens cameras and microphones as live references", async () => {
    const makeStream = (audio: boolean) => {
      const tracks = [{ stop: vi.fn() }];
      return { getTracks: () => tracks, getAudioTracks: () => (audio ? tracks : []) };
    };
    const getUserMedia = vi.fn(async (constraints: { audio?: unknown }) => makeStream(!!constraints.audio));
    const platform = createBrowserPlatform({ window: fakeWindow({ navigator: { mediaDevices: { getUserMedia } } }), mute: muteStore() });
    const media = platform.media!;
    const ref = await media.openCamera!("main/cam#0", { facing: "front", quality: "high" });
    expect(ref).toEqual({ live: "camera/main/cam#0" });
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    expect(platform.liveSources()).toEqual(["camera/main/cam#0"]);
    const stream = platform.liveStream("camera/main/cam#0")!;
    media.close("main/cam#0");
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled();
    expect(platform.liveSources()).toEqual([]);

    expect(await media.openMicrophone!("main/mic#0")).toEqual({ live: "microphone/main/mic#0" });
    expect(media.level!("main/mic#0")).toBeUndefined();
    await expect(media.stopRecording("main/mic#0")).resolves.toBeNull();
    platform.dispose();
    expect(platform.liveSources()).toEqual([]);
    expect(liveKeyOf({ url: "sonobe-live:audio/main/player#0" })).toBe("audio/main/player#0");
    expect(liveKeyOf({ url: "https://x.test" })).toBeUndefined();
  });

  it("lets the person pick photos", async () => {
    const png = new Uint8Array([1, 2, 3]);
    const inputs: (EventTarget & { accept: string; multiple: boolean; files: File[] | null; remove: () => void })[] = [];
    const doc = {
      createElement(tag: string) {
        if (tag === "input") {
          const input = Object.assign(new EventTarget(), {
            type: "",
            accept: "",
            multiple: false,
            style: {},
            files: null as File[] | null,
            remove: vi.fn(),
            click() {
              input.files = [new File([png], "a.png", { type: "image/png" }), new File(["x"], "notes.txt", { type: "text/plain" })];
              input.dispatchEvent(new Event("change"));
            },
          });
          inputs.push(input);
          return input;
        }
        const img = {
          naturalWidth: 300,
          naturalHeight: 200,
          onload: null as (() => void) | null,
          onerror: null as (() => void) | null,
          set src(_value: string) {
            queueMicrotask(() => img.onload?.());
          },
        };
        return img;
      },
      body: { appendChild: vi.fn() },
    };
    const platform = createBrowserPlatform({ window: fakeWindow({ document: doc }), mute: muteStore() });
    const picked = await platform.pickMedia!({ accept: "photos", multiple: true });
    expect(inputs[0]).toMatchObject({ accept: "image/*", multiple: true });
    expect(inputs[0]!.remove).toHaveBeenCalled();
    expect(picked).toEqual([{ kind: "image", image: { url: expect.stringMatching(/^blob:/) }, video: null, width: 300, height: 200, name: "a.png" }]);
    platform.releaseMedia!(picked[0]!.image!);
  });

  it("detects mute requests from the environment", () => {
    vi.stubEnv("SONOBE_MUTE", "");
    expect(detectMuted({})).toEqual({ muted: false, reason: null });
    expect(detectMuted({ location: { search: "?mute=1" } })).toEqual({ muted: true, reason: "query" });
    expect(detectMuted({ location: { search: "?mute" } })).toEqual({ muted: true, reason: "query" });
    expect(detectMuted({ location: { search: "?mute=0" } }).muted).toBe(false);
    expect(detectMuted({ sonobeHost: { muted: true } })).toEqual({ muted: true, reason: "host" });
    expect(detectMuted({ navigator: { webdriver: true } })).toEqual({ muted: true, reason: "automation" });
    vi.stubEnv("SONOBE_MUTE", "1");
    expect(detectMuted({})).toEqual({ muted: true, reason: "env" });
  });
});
