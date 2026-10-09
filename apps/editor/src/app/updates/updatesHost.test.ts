// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { fakeUpdatesHost, updateStatus } from "./testing.ts";
import { createUpdateStore, followUpdates } from "./updateStore.ts";
import { getUpdatesHost, toUpdateStatus } from "./updatesHost.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  delete (window as { sonobeHost?: unknown }).sonobeHost;
  delete (window as { __sonobeFakeUpdates?: unknown }).__sonobeFakeUpdates;
});

describe("toUpdateStatus", () => {
  it("keeps a well-formed status as it is", () => {
    const status = updateStatus({ state: "failed", version: "0.2.0", progress: 0.5, error: { kind: "network", phase: "download", message: "No connection.", hint: "Try again." }, manual: true, asks: 3, updatedFrom: "0.0.9", notesUrl: "https://example.test/notes", canMove: true, offerMove: true, restarting: true, reason: "Why." });
    expect(toUpdateStatus(status)).toEqual(status);
  });

  it("drops what isn't a status", () => {
    for (const value of [null, undefined, "ready", 3, {}, { mode: "install" }, { mode: "sometimes", state: "ready", current: "0.1.0" }, { mode: "install", state: "ready" }, { mode: "install", state: "finished", current: "0.1.0" }]) expect(toUpdateStatus(value), JSON.stringify(value)).toBeNull();
  });

  it("gives a status with malformed fields their defaults", () => {
    const status = toUpdateStatus({ mode: "notify", state: "available", current: "0.1.0", version: 2, releaseUrl: null, progress: "half", error: { kind: "weird", message: "It broke." }, manual: "yes", autoCheck: "no", asks: Number.NaN, offerMove: 1 });
    expect(status).toEqual(updateStatus({ mode: "notify", state: "available", releaseUrl: "", error: { kind: "other", phase: "check", message: "It broke.", hint: "" } }));
    expect(toUpdateStatus({ mode: "install", state: "downloading", current: "0.1.0", progress: 7, error: { hint: "No message." } })).toMatchObject({ progress: 1, error: null });
  });
});

describe("getUpdatesHost", () => {
  it("is null in the browser and with a preload that lacks updates", () => {
    expect(getUpdatesHost()).toBeNull();
    (window as { sonobeHost?: unknown }).sonobeHost = { platform: "darwin", version: "0.1.0" };
    expect(getUpdatesHost()).toBeNull();
    (window as { sonobeHost?: unknown }).sonobeHost = { updates: { status: async () => updateStatus() } };
    expect(getUpdatesHost()).toBeNull();
  });

  it("wraps the desktop app's updates, sanitising what comes back", async () => {
    const fake = fakeUpdatesHost({ state: "ready", version: "0.2.0" });
    (window as { sonobeHost?: unknown }).sonobeHost = { updates: { ...fake, status: async () => ({ ...(await fake.status()), progress: "junk" }) } };
    const host = getUpdatesHost()!;
    expect(await host.status()).toEqual(updateStatus({ state: "ready", version: "0.2.0" }));
    expect(await host.restart()).toBe(false);
    expect((await host.setAutoCheck(false))?.autoCheck).toBe(false);
    const seen: string[] = [];
    const off = host.onStatus((status) => seen.push(status.state));
    fake.push({ state: "failed", error: { kind: "other", phase: "check", message: "No.", hint: "" } });
    (fake.push as (patch: unknown) => unknown)({ state: "nonsense" });
    expect(seen).toEqual(["failed"]);
    off();
    expect(fake.listeners()).toBe(0);
  });

  it("answers false for a move the preload can't make", async () => {
    const { moveToApplications: _move, ...older } = fakeUpdatesHost();
    (window as { sonobeHost?: unknown }).sonobeHost = { updates: older };
    expect(await getUpdatesHost()!.moveToApplications()).toBe(false);
  });

  it("uses the e2e fake under Vite's dev mode", () => {
    (window as { __sonobeFakeUpdates?: unknown }).__sonobeFakeUpdates = fakeUpdatesHost();
    expect(getUpdatesHost()).not.toBeNull();
  });
});

describe("followUpdates", () => {
  it("subscribes first, then asks, and follows every change", async () => {
    const fake = fakeUpdatesHost({ state: "upToDate" });
    const order: string[] = [];
    const store = createUpdateStore(() => fake);
    const off = followUpdates(store, {
      ...fake,
      onStatus: (cb) => (order.push("subscribe"), fake.onStatus(cb)),
      status: () => (order.push("ask"), fake.status()),
    });
    expect(order).toEqual(["subscribe", "ask"]);
    expect(store.getState().status).toBeNull();
    await settle();
    expect(store.getState().status?.state).toBe("upToDate");
    fake.push({ state: "ready", version: "0.2.0" });
    expect(store.getState().status).toMatchObject({ state: "ready", version: "0.2.0" });
    off();
    fake.push({ state: "failed" });
    expect(store.getState().status?.state).toBe("ready");
    expect(fake.listeners()).toBe(0);
  });

  it("drops a first answer that arrives after a newer change", async () => {
    const fake = fakeUpdatesHost({ state: "idle" });
    const store = createUpdateStore(() => fake);
    let answer!: (status: ReturnType<typeof updateStatus>) => void;
    followUpdates(store, { ...fake, status: () => new Promise((resolve) => (answer = resolve)) });
    fake.push({ state: "available", version: "0.2.0" });
    answer(updateStatus({ state: "idle" }));
    await settle();
    expect(store.getState().status?.state).toBe("available");
  });

  it("does nothing without a host, and the store's actions answer quietly", async () => {
    const store = createUpdateStore(() => null);
    followUpdates(store, null)();
    await store.getState().check();
    await store.getState().setAutoCheck(false);
    expect(await store.getState().restart()).toBe(false);
    expect(await store.getState().moveToApplications()).toBe(false);
    expect(store.getState().status).toBeNull();
  });

  it("passes the actions to the host", async () => {
    const fake = fakeUpdatesHost({}, { restarts: true });
    const store = createUpdateStore(() => fake);
    await store.getState().check();
    await store.getState().setAutoCheck(false);
    expect(await store.getState().restart()).toBe(true);
    await store.getState().moveToApplications();
    expect(fake.calls).toEqual(["check", "autoCheck:false", "restart", "move"]);
  });
});
