import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { etagMatches, lanAddresses, matchPreviewPath, phonePreviewDetail, previewUrl, resolveUnder, startLanPreview, type LanPreviewHandle, type PreviewDocument, type PreviewMessage } from "./lan-preview.ts";

interface Player {
  ws: WebSocket;
  /** The next message (buffered from the start) matching `predicate`. */
  next(predicate: (m: PreviewMessage) => boolean, timeoutMs?: number): Promise<PreviewMessage>;
}

function open(url: string, headers: Record<string, string> = {}): Promise<Player> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const inbox: PreviewMessage[] = [];
    const waiters = new Set<() => void>();
    ws.on("message", (data) => {
      inbox.push(JSON.parse(String(data)) as PreviewMessage);
      for (const wake of [...waiters]) wake();
    });
    const next = (predicate: (m: PreviewMessage) => boolean, timeoutMs = 3000) =>
      new Promise<PreviewMessage>((resolveMessage, rejectMessage) => {
        const check = () => {
          const index = inbox.findIndex(predicate);
          if (index < 0) return;
          const [message] = inbox.splice(0, index + 1).slice(-1);
          waiters.delete(check);
          clearTimeout(timer);
          resolveMessage(message!);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          rejectMessage(new Error("Timed out waiting for a preview message"));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    ws.once("open", () => resolve({ ws, next }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

describe("lan preview helpers", () => {
  it("prefers Wi-Fi and Ethernet addresses over VPNs and skips internal ones", () => {
    const iface = (address: string, internal = false) => ({ address, internal, family: "IPv4", netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null }) as never;
    expect(
      lanAddresses({
        lo0: [iface("127.0.0.1", true)],
        utun3: [iface("10.8.0.2")],
        en0: [iface("192.168.1.24"), { address: "fe80::1", internal: false, family: "IPv6" } as never],
        bridge100: [iface("169.254.3.1")],
      }),
    ).toEqual(["192.168.1.24", "10.8.0.2"]);
    expect(previewUrl("192.168.1.24", 5173, "abc")).toBe("http://192.168.1.24:5173/p/abc/");
  });

  it("matches only the token prefix and refuses traversal", () => {
    expect(matchPreviewPath("/p/tok/", "tok")).toEqual({ rest: "" });
    expect(matchPreviewPath("/p/tok/player.js?v=1", "tok")).toEqual({ rest: "player.js" });
    expect(matchPreviewPath("/p/tok", "tok")).toBe("redirect");
    expect(matchPreviewPath("/p/nope/", "tok")).toBeNull();
    expect(matchPreviewPath("/", "tok")).toBeNull();
    expect(matchPreviewPath("/p/tok/%E0%A4%A", "tok")).toBeNull();
    expect(resolveUnder("/srv/player", "../secret")).toBeNull();
    expect(resolveUnder("/srv/player", "player.js")).toBe(path.resolve("/srv/player/player.js"));
  });

  it("words the app's own Preview on Phone dialog like the editor's panel", () => {
    const url = "http://192.168.1.24:5173/p/abc/";
    const lan = phonePreviewDetail(url, true);
    expect(lan.split("\n").slice(0, 2)).toEqual(["Scan the code with a phone on the same Wi-Fi, or open this link:", url]);
    expect(lan).toContain("Sonobe Viewer app to feel haptics");
    expect(lan).toContain("a three-finger tap opens a menu with Restart");
    expect(lan).toContain("Anyone with it can view this prototype");
    const local = phonePreviewDetail("http://127.0.0.1:5173/p/abc/", false);
    expect(local).toContain("only this computer can open the preview");
    expect(local).not.toContain("Sonobe Viewer");
  });
});

describe("startLanPreview", () => {
  let dir: string;
  let server: LanPreviewHandle | null = null;
  let current: PreviewDocument | null;
  const clients: number[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sonobe-lan-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Player</title>");
    await writeFile(path.join(dir, "player.js"), "console.log('player')");
    await writeFile(path.join(dir, "clip.mp4"), Buffer.from("0123456789"));
    current = { docId: "photo_zoom", name: "Photo Zoom", revision: 1, doc: { project: { name: "Photo Zoom" } } };
    clients.length = 0;
    server = await startLanPreview({
      playerRoot: dir,
      host: "127.0.0.1",
      pollMs: 50,
      version: "9.9.9",
      getDocument: async () => current,
      resolveAsset: async (file) => (file === "clip.mp4" ? path.join(dir, "clip.mp4") : null),
      onClientsChange: (count) => clients.push(count),
    });
  });

  afterEach(async () => {
    await server?.close();
    server = null;
    await rm(dir, { recursive: true, force: true });
  });

  const base = () => `http://127.0.0.1:${server!.port}`;

  it("serves the player under the token only", async () => {
    const s = server!;
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/p/${s.token}/`);
    expect(s.lanReachable).toBe(false);
    expect(s.token.length).toBeGreaterThanOrEqual(22);

    const page = await fetch(s.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    // Code only from the player; prototypes reach other hosts as in the editor's viewer (Network Request, WebSocket, remote media).
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self' http: https: ws: wss:");
    expect(csp).toContain("img-src 'self' data: blob: http: https:");
    expect(csp).toContain("media-src 'self' data: blob: http: https:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await page.text()).toContain("<title>Player</title>");

    expect((await fetch(`${s.url}player.js`)).headers.get("content-type")).toContain("text/javascript");
    expect((await fetch(`${base()}/p/wrong-token/`)).status).toBe(404);
    expect((await fetch(`${base()}/`)).status).toBe(404);
    expect((await fetch(`${s.url}..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${s.url}missing.js`)).status).toBe(404);
    expect((await fetch(s.url, { method: "POST" })).status).toBe(405);
    const redirect = await fetch(`${base()}/p/${s.token}`, { redirect: "manual" });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe(`/p/${s.token}/`);
  });

  it("compresses text files and answers revalidation with 304", async () => {
    const s = server!;
    const source = "console.log('a player bundle line');\n".repeat(400);
    await writeFile(path.join(dir, "big.js"), source);
    const zipped = await fetch(`${s.url}big.js`, { headers: { "Accept-Encoding": "gzip" } });
    expect(zipped.status).toBe(200);
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    expect(zipped.headers.get("vary")).toBe("Accept-Encoding");
    expect(Number(zipped.headers.get("content-length"))).toBeLessThan(source.length / 4);
    expect(await zipped.text()).toBe(source);
    const etag = zipped.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"/);

    const again = await fetch(`${s.url}big.js`, { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    // A changed file gets a new tag, so the stale one downloads again.
    await writeFile(path.join(dir, "big.js"), `${source}// edited\n`);
    const changed = await fetch(`${s.url}big.js`, { headers: { "If-None-Match": etag, "Accept-Encoding": "gzip" } });
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe(`${source}// edited\n`);
    // Byte ranges stay uncompressed.
    const ranged = await fetch(`${s.url}big.js`, { headers: { Range: "bytes=0-6", "Accept-Encoding": "gzip" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-encoding")).toBeNull();
    expect(await ranged.text()).toBe("console");
    // The page itself is never cached.
    const page = await fetch(s.url, { headers: { "If-None-Match": "*" } });
    expect(page.status).toBe(200);
    expect(etagMatches('"abc", W/"def"', 'W/"def"')).toBe(true);
    expect(etagMatches(undefined, 'W/"def"')).toBe(false);
  });

  it("serves the document as JSON and assets with byte ranges", async () => {
    const s = server!;
    const doc = await fetch(`${s.url}document.json`);
    expect(doc.status).toBe(200);
    expect(await doc.json()).toMatchObject({ type: "document", docId: "photo_zoom", revision: 1, doc: { project: { name: "Photo Zoom" } } });

    const ranged = await fetch(`${s.url}assets/clip.mp4`, { headers: { range: "bytes=2-5" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await ranged.text()).toBe("2345");
    expect((await fetch(`${s.url}assets/other.png`)).status).toBe(404);
    expect((await fetch(`${s.url}assets/..%2Fplayer.js`)).status).toBe(404);

    current = null;
    const offline = await fetch(`${s.url}document.json`);
    expect(offline.status).toBe(503);
    expect(await offline.json()).toMatchObject({ type: "offline" });
  });

  it("streams new revisions to players and reports who's connected", async () => {
    const s = server!;
    const { ws, next } = await open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`);
    expect(await next((m) => m.type === "hello")).toEqual({ type: "hello", version: "9.9.9" });
    expect(await next((m) => m.type === "document")).toMatchObject({ type: "document", revision: 1, name: "Photo Zoom" });
    expect(s.clientCount()).toBe(1);
    expect(clients).toEqual([1]);

    current = { ...current!, revision: 2, doc: { project: { name: "Photo Zoom 2" } } };
    expect(await next((m) => m.type === "document")).toMatchObject({ revision: 2, doc: { project: { name: "Photo Zoom 2" } } });

    current = null;
    expect(await next((m) => m.type === "offline")).toMatchObject({ message: expect.stringContaining("Open a prototype") });

    const closed = new Promise((resolve) => ws.once("close", resolve));
    ws.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(s.clientCount()).toBe(0);
    expect(clients).toEqual([1, 0]);
  });

  it("follows pokes instead of polling in push mode", async () => {
    const s = server!;
    expect(s.pushUpdates).toBe(false);
    s.setPushUpdates(true);
    expect(s.pushUpdates).toBe(true);
    const { ws, next } = await open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`);
    expect(await next((m) => m.type === "document")).toMatchObject({ revision: 1 });

    current = { ...current!, revision: 2 };
    await expect(next((m) => m.type === "document", 300)).rejects.toThrow(/Timed out/);
    s.poke();
    expect(await next((m) => m.type === "document")).toMatchObject({ revision: 2 });

    current = { ...current!, revision: 3 };
    s.setPushUpdates(false);
    expect(await next((m) => m.type === "document")).toMatchObject({ revision: 3 });
    ws.terminate();
  });

  it("restarts players after sending the revision they don't have yet", async () => {
    const s = server!;
    s.setPushUpdates(true);
    s.restart(); // No players yet: nothing to do.
    const { ws, next } = await open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`);
    expect(await next((m) => m.type === "document")).toMatchObject({ revision: 1 });

    current = { ...current!, revision: 2 };
    s.restart();
    // The new revision first, then the restart, so the phone starts over on what the editor restarted.
    expect(await next((m) => m.type === "document" || m.type === "restart")).toMatchObject({ type: "document", revision: 2 });
    expect(await next(() => true)).toEqual({ type: "restart" });

    s.restart();
    expect(await next(() => true)).toEqual({ type: "restart" });
    ws.terminate();
  });

  it("says when the project's scripts wait for trust, and sends the document again once trusted", async () => {
    const s = server!;
    s.setPushUpdates(true);
    current = { ...current!, scriptsPaused: true };
    const { ws, next } = await open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`);
    expect(await next((m) => m.type === "document")).toMatchObject({ revision: 1, scriptsPaused: true });
    // Trusting changes no revision; the editor restarts, and the restart carries the change.
    current = { ...current!, scriptsPaused: false };
    s.restart();
    const again = await next((m) => m.type === "document");
    expect(again).toMatchObject({ revision: 1 });
    expect("scriptsPaused" in again).toBe(false);
    expect(await next(() => true)).toEqual({ type: "restart" });
    ws.terminate();
  });

  it("rejects sockets without the token or from other origins", async () => {
    const s = server!;
    await expect(open(`ws://127.0.0.1:${s.port}/p/nope/sync`)).rejects.toThrow();
    await expect(open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`, { origin: "https://evil.example" })).rejects.toThrow(/404/);
    const { ws, next } = await open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`, { origin: `http://127.0.0.1:${s.port}` });
    expect(await next((m) => m.type === "hello")).toEqual({ type: "hello", version: "9.9.9" });
    ws.terminate();
  });

  it("closes open sockets on close", async () => {
    const s = server!;
    const { ws } = await open(`ws://127.0.0.1:${s.port}/p/${s.token}/sync`);
    const closed = new Promise((resolve) => ws.once("close", resolve));
    await s.close();
    server = null;
    await closed;
    await expect(fetch(s.url)).rejects.toThrow();
  });
});
