import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnectionStore, offersSubscription, PACKAGED_OPT_IN, packagedOfferNote } from "./connection.ts";
import type { AssistantConnectionUpdate } from "./protocol.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-assistant-connection-"));
  file = path.join(dir, "assistant-connection.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the Assistant's connection settings", () => {
  it("starts with the switch off and the API key, and writes nothing until something changes", async () => {
    const store = createConnectionStore({ file });
    expect(store.get()).toEqual({ subscriptionEnabled: false, provider: "api_key", active: "api_key" });
    expect(store.update({})).toEqual({ subscriptionEnabled: false, provider: "api_key", active: "api_key" });
    await expect(stat(file)).rejects.toThrow();
  });

  it("counts the subscription pick only while the switch is on, and keeps the pick when it's turned off", () => {
    const store = createConnectionStore({ file });
    expect(store.update({ provider: "subscription" })).toEqual({ subscriptionEnabled: false, provider: "subscription", active: "api_key" });
    expect(store.update({ subscriptionEnabled: true })).toEqual({ subscriptionEnabled: true, provider: "subscription", active: "subscription" });
    expect(store.update({ subscriptionEnabled: false })).toEqual({ subscriptionEnabled: false, provider: "subscription", active: "api_key" });
    expect(store.update({ subscriptionEnabled: true, provider: "api_key" })).toEqual({ subscriptionEnabled: true, provider: "api_key", active: "api_key" });
  });

  it("saves atomically at 0600 and reads it back in the next launch", async () => {
    createConnectionStore({ file }).update({ subscriptionEnabled: true, provider: "subscription" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ subscriptionEnabled: true, provider: "subscription" });
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(createConnectionStore({ file }).get()).toEqual({ subscriptionEnabled: true, provider: "subscription", active: "subscription" });
  });

  it("ignores fields and values it doesn't know, in a patch or the file", async () => {
    const store = createConnectionStore({ file });
    for (const junk of [{ subscriptionEnabled: "yes" }, { provider: "claude_ai" }, { active: "subscription" }, null, "subscription", [true]]) {
      expect(store.update(junk as unknown as AssistantConnectionUpdate)).toEqual({ subscriptionEnabled: false, provider: "api_key", active: "api_key" });
    }
    for (const body of ["not json", "[]", JSON.stringify({ subscriptionEnabled: 1, provider: "subscription", active: "subscription" })]) {
      await writeFile(file, body);
      expect(createConnectionStore({ file }).get()).toEqual({ subscriptionEnabled: false, provider: body.startsWith("{") ? "subscription" : "api_key", active: "api_key" });
    }
  });

  it("keeps a change for this launch when it can't be saved", () => {
    const warnings: string[] = [];
    const store = createConnectionStore({ file: path.join(dir, "missing", "\0", "assistant-connection.json"), log: (_level, message) => warnings.push(message) });
    expect(store.update({ subscriptionEnabled: true })).toMatchObject({ subscriptionEnabled: true });
    expect(store.get()).toMatchObject({ subscriptionEnabled: true });
    expect(warnings).toEqual([expect.stringMatching(/^Couldn't save the Assistant's connection settings: /)]);
  });
});

describe("whether a build offers the subscription switch", () => {
  it("offers it from a checkout, whatever the file says", () => {
    expect(offersSubscription({ packaged: false, optedIn: false })).toBe(true);
    expect(offersSubscription({ packaged: false, optedIn: true })).toBe(true);
  });

  it("offers it in a packaged app only when the person opted in by hand", () => {
    expect(offersSubscription({ packaged: true, optedIn: false })).toBe(false);
    expect(offersSubscription({ packaged: true, optedIn: true })).toBe(true);
    // Only `true` opts in, also from code that isn't type checked.
    for (const junk of ["true", 1, {}, null, undefined]) expect(offersSubscription({ packaged: true, optedIn: junk as unknown as boolean })).toBe(false);
  });

  it("doesn't take the saved switch for the opt-in: what a checkout's Settings writes isn't enough in a packaged app", async () => {
    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription" }));
    const store = createConnectionStore({ file });
    expect(store.get()).toEqual({ subscriptionEnabled: true, provider: "subscription", active: "subscription" });
    expect(store.packagedOptIn()).toBe(false);
    expect(offersSubscription({ packaged: true, optedIn: store.packagedOptIn() })).toBe(false);
    expect(offersSubscription({ packaged: false, optedIn: store.packagedOptIn() })).toBe(true);
  });

  it("says in the log why a packaged app does or doesn't offer it, and never how to opt in", () => {
    expect(packagedOfferNote({ packaged: false, optedIn: true }, { subscriptionEnabled: true })).toBeNull();
    expect(packagedOfferNote({ packaged: true, optedIn: false }, { subscriptionEnabled: false })).toBeNull();
    const refused = packagedOfferNote({ packaged: true, optedIn: false }, { subscriptionEnabled: true });
    expect(refused).toBe("assistant-connection.json has the Claude subscription switch on, but a packaged Sonobe doesn't offer it, so the Assistant uses your Anthropic API key.");
    expect(refused).not.toContain(PACKAGED_OPT_IN);
    expect(packagedOfferNote({ packaged: true, optedIn: true }, { subscriptionEnabled: false })).toBe(`This packaged Sonobe offers the experimental Claude subscription switch: assistant-connection.json has "${PACKAGED_OPT_IN}": true, set by hand.`);
  });
});

describe("the opt-in a person sets by hand for a packaged app", () => {
  const optIn = { [PACKAGED_OPT_IN]: true };
  const saved = async () => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

  it("is named for what it allows", () => {
    expect(PACKAGED_OPT_IN).toBe("subscriptionInPackagedApp");
  });

  it("reads it from the file, and only `true` counts", async () => {
    expect(createConnectionStore({ file }).packagedOptIn()).toBe(false);
    expect(createConnectionStore({}).packagedOptIn()).toBe(false);
    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription", ...optIn }));
    expect(createConnectionStore({ file }).packagedOptIn()).toBe(true);
    // The key alone opts in, with the switch still off.
    await writeFile(file, JSON.stringify(optIn));
    const alone = createConnectionStore({ file });
    expect([alone.packagedOptIn(), alone.get()]).toEqual([true, { subscriptionEnabled: false, provider: "api_key", active: "api_key" }]);
    for (const value of [false, "true", "yes", 1, null, {}, [true]]) {
      const warnings: string[] = [];
      await writeFile(file, JSON.stringify({ subscriptionEnabled: true, [PACKAGED_OPT_IN]: value }));
      const store = createConnectionStore({ file, log: (_level, message) => warnings.push(message) });
      expect([value, store.packagedOptIn()]).toEqual([value, false]);
      // The switch is still read, and a malformed opt-in says so in the log.
      expect(store.get().subscriptionEnabled).toBe(true);
      expect(warnings).toEqual(value === false ? [] : [`assistant-connection.json has "${PACKAGED_OPT_IN}" set to something other than true or false, so it's ignored.`]);
    }
    for (const body of ["not json", "[]", `{"${PACKAGED_OPT_IN}": true`, `{"${PACKAGED_OPT_IN.toUpperCase()}": true}`, `{"nested": {"${PACKAGED_OPT_IN}": true}}`]) {
      await writeFile(file, body);
      expect(createConnectionStore({ file }).packagedOptIn(), body).toBe(false);
    }
  });

  it("never takes it from update(): nothing that patches the connection can set or clear it", async () => {
    const store = createConnectionStore({ file });
    const sneak = { ...optIn, subscriptionEnabled: true } as unknown as AssistantConnectionUpdate;
    expect(store.update(sneak)).toEqual({ subscriptionEnabled: true, provider: "api_key", active: "api_key" });
    expect(store.packagedOptIn()).toBe(false);
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "api_key" });
    expect(createConnectionStore({ file }).packagedOptIn()).toBe(false);
    // The key alone changes nothing, so nothing is written either.
    await rm(file);
    store.update(optIn as unknown as AssistantConnectionUpdate);
    await expect(stat(file)).rejects.toThrow();

    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription", ...optIn }));
    const optedIn = createConnectionStore({ file });
    optedIn.update({ [PACKAGED_OPT_IN]: false, provider: "api_key" } as unknown as AssistantConnectionUpdate);
    expect(optedIn.packagedOptIn()).toBe(true);
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "api_key", ...optIn });
  });

  it("keeps it in the file when the switch and the pick are saved, at 0600", async () => {
    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription", ...optIn }));
    const store = createConnectionStore({ file });
    store.update({ subscriptionEnabled: false });
    expect(await saved()).toEqual({ subscriptionEnabled: false, provider: "subscription", ...optIn });
    store.update({ subscriptionEnabled: true });
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "subscription", ...optIn });
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    const next = createConnectionStore({ file });
    expect([next.packagedOptIn(), next.get().active]).toEqual([true, "subscription"]);
  });

  it("is read once, at launch: an edit while Sonobe runs counts from the next launch, and a save keeps the file's own answer", async () => {
    // Added while it runs: not in effect yet, and a save doesn't drop it.
    await writeFile(file, JSON.stringify({ subscriptionEnabled: false, provider: "api_key" }));
    const store = createConnectionStore({ file });
    await writeFile(file, JSON.stringify({ subscriptionEnabled: false, provider: "api_key", ...optIn }));
    expect(store.packagedOptIn()).toBe(false);
    store.update({ subscriptionEnabled: true });
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "api_key", ...optIn });
    expect(store.packagedOptIn()).toBe(false);
    expect(createConnectionStore({ file }).packagedOptIn()).toBe(true);

    // Taken out while it runs: still in effect until Sonobe quits, and a save doesn't put it back.
    const running = createConnectionStore({ file });
    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "api_key" }));
    running.update({ provider: "subscription" });
    expect(running.packagedOptIn()).toBe(true);
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "subscription" });
    expect(createConnectionStore({ file }).packagedOptIn()).toBe(false);
  });

  it("keeps what the launch read when the file can't be parsed at a save, and drops it with a deleted file", async () => {
    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription", ...optIn }));
    const store = createConnectionStore({ file });
    await writeFile(file, "{ half an edit");
    store.update({ provider: "api_key" });
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "api_key", ...optIn });
    await rm(file);
    store.update({ provider: "subscription" });
    expect(await saved()).toEqual({ subscriptionEnabled: true, provider: "subscription" });
    // A store that never read it doesn't invent it from a file it can't parse.
    const plain = createConnectionStore({ file });
    await writeFile(file, "{ half an edit");
    plain.update({ subscriptionEnabled: false });
    expect(await saved()).toEqual({ subscriptionEnabled: false, provider: "subscription" });
  });
});
