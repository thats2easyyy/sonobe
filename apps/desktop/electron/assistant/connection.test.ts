import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("keeps a change for this launch when it can't be saved", async () => {
    const warnings: string[] = [];
    // Its folder is a file, so there is nothing to read and nowhere to write.
    await writeFile(path.join(dir, "not-a-folder"), "");
    const store = createConnectionStore({ file: path.join(dir, "not-a-folder", "assistant-connection.json"), log: (_level, message) => warnings.push(message) });
    expect(store.update({ subscriptionEnabled: true })).toMatchObject({ subscriptionEnabled: true });
    expect(store.get()).toMatchObject({ subscriptionEnabled: true });
    expect(warnings).toEqual([expect.stringMatching(/^Couldn't save the Assistant's connection settings: /)]);
  });

  // A person edits this file by hand (CONTRIBUTING.md), so the usual slips have to be said, not swallowed.
  const SLIPS: Record<string, string | Buffer> = {
    "a missing comma": '{\n  "subscriptionEnabled": true,\n  "provider": "subscription"\n  "extra": true\n}\n',
    "a trailing comma": '{\n  "subscriptionEnabled": true,\n  "provider": "subscription",\n}\n',
    "curly quotes": "{ \u201csubscriptionEnabled\u201d: true }",
    "a comment": '{\n  // mine\n  "subscriptionEnabled": true\n}',
    "a byte order mark": '\uFEFF{ "subscriptionEnabled": true }',
    "UTF-16": Buffer.from('\uFEFF{ "subscriptionEnabled": true }', "utf16le"),
    "half an edit": '{ "subscriptionEnabled": tr',
  };

  it("says in the log when the file isn't valid JSON, ignores all of it, and names no key", async () => {
    for (const [slip, body] of Object.entries(SLIPS)) {
      const warnings: string[] = [];
      await writeFile(file, body);
      const store = createConnectionStore({ file, log: (level, message) => warnings.push(`${level}: ${message}`) });
      expect([slip, store.get(), store.packagedOptIn()]).toEqual([slip, { subscriptionEnabled: false, provider: "api_key", active: "api_key" }, false]);
      expect(warnings, slip).toEqual([
        "warn: assistant-connection.json isn't valid JSON, so Sonobe ignores it: the Assistant's connection settings start from their defaults. Check it for a missing or trailing comma and for curly quotes, or delete it.",
      ]);
      expect(warnings[0], slip).not.toMatch(new RegExp(`${PACKAGED_OPT_IN}|packaged|opt`, "i"));
    }
    // Valid JSON that isn't an object is ignored the same way, and so is a file that can't be read at all.
    for (const [body, problem] of [["[]", "isn't a JSON object"], ['"subscription"', "isn't a JSON object"], ["null", "isn't a JSON object"]] as const) {
      const warnings: string[] = [];
      await writeFile(file, body);
      createConnectionStore({ file, log: (_level, message) => warnings.push(message) });
      expect(warnings, body).toEqual([`assistant-connection.json ${problem}, so Sonobe ignores it: the Assistant's connection settings start from their defaults. It has to be one object in braces. Fix it, or delete it.`]);
    }
    await rm(file);
    await mkdir(file);
    const unread: string[] = [];
    expect(createConnectionStore({ file, log: (_level, message) => unread.push(message) }).get().subscriptionEnabled).toBe(false);
    expect(unread).toEqual([expect.stringMatching(/^assistant-connection\.json couldn't be read \(\w+\), so Sonobe ignores it: /)]);
    await rm(file, { recursive: true });
    // No file, or one with nothing in it, is where everyone starts: nothing to say.
    for (const body of [null, "", " \n"]) {
      const warnings: string[] = [];
      if (body !== null) await writeFile(file, body);
      createConnectionStore({ file, log: (_level, message) => warnings.push(message) });
      expect(warnings, JSON.stringify(body)).toEqual([]);
    }
  });

  it("leaves a file it can't read as it is at a save, and says the change lasts until Sonobe quits", async () => {
    for (const [slip, body] of Object.entries(SLIPS)) {
      await rm(file, { force: true });
      const warnings: string[] = [];
      const store = createConnectionStore({ file, log: (_level, message) => warnings.push(message) });
      await writeFile(file, body);
      const before = await readFile(file);
      expect([slip, store.update({ subscriptionEnabled: true, provider: "subscription" })]).toEqual([slip, { subscriptionEnabled: true, provider: "subscription", active: "subscription" }]);
      expect((await readFile(file)).equals(before), slip).toBe(true);
      expect(warnings, slip).toEqual([
        "assistant-connection.json isn't valid JSON, so Sonobe left it as it is and this change lasts only until Sonobe quits. Check it for a missing or trailing comma and for curly quotes, or delete it.",
      ]);
    }
    // Once the person has fixed it, the next change is saved.
    await writeFile(file, "{}");
    const store = createConnectionStore({ file });
    await writeFile(file, SLIPS["a trailing comma"]!);
    store.update({ subscriptionEnabled: true });
    await writeFile(file, JSON.stringify({ subscriptionEnabled: false, provider: "api_key" }));
    store.update({ provider: "subscription" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ subscriptionEnabled: true, provider: "subscription" });
    // A file with nothing in it has nothing to lose: it's written.
    await writeFile(file, "");
    store.update({ provider: "api_key" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ subscriptionEnabled: true, provider: "api_key" });
  });

  it("can't have its answers swapped by whoever holds it", () => {
    const store = createConnectionStore({ file });
    expect(Object.isFrozen(store)).toBe(true);
    expect(Object.keys(store).sort()).toEqual(["get", "packagedOptIn", "update"]);
    expect(() => ((store as { packagedOptIn: () => boolean }).packagedOptIn = () => true)).toThrow(TypeError);
    expect(() => Object.defineProperty(store, "packagedOptIn", { value: () => true })).toThrow(TypeError);
    expect(store.packagedOptIn()).toBe(false);
  });
});

describe("whether a build offers the subscription switch", () => {
  it("offers it from a checkout, whatever the file says", () => {
    expect(offersSubscription({ packaged: false, optedIn: false })).toBe(true);
    expect(offersSubscription({ packaged: false, optedIn: true })).toBe(true);
  });

  it("offers nothing when it isn't told whether the build is packaged: only `false` is a checkout", () => {
    for (const junk of [undefined, null, 0, "", Number.NaN, "false", 1, "true", {}]) {
      expect([junk, offersSubscription({ packaged: junk as unknown as boolean, optedIn: false })]).toEqual([junk, false]);
      // The opt-in still counts, and the log treats the build as packaged.
      expect(offersSubscription({ packaged: junk as unknown as boolean, optedIn: true })).toBe(true);
      expect(packagedOfferNote({ packaged: junk as unknown as boolean, optedIn: false }, { subscriptionEnabled: true })).toMatch(/a packaged Sonobe doesn't offer it/);
    }
    expect(offersSubscription({} as unknown as { packaged: boolean; optedIn: boolean })).toBe(false);
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

  // The one way Sonobe could put the key in the file itself: from what the launch read. It never does.
  it("never writes it from what the launch read: taken out by hand while Sonobe runs, it stays out, however the file is left", async () => {
    const withKey = JSON.stringify({ subscriptionEnabled: true, provider: "subscription", ...optIn });
    const leftBehind: Record<string, string | null> = {
      // CONTRIBUTING.md's example has the key on the last line: deleting that line leaves this.
      "a trailing comma": '{\n  "subscriptionEnabled": true,\n  "provider": "subscription",\n}\n',
      "half an edit": "{ half an edit",
      "an empty file": "",
      "an empty object": "{}",
      "the key set to false": JSON.stringify({ subscriptionEnabled: true, provider: "subscription", [PACKAGED_OPT_IN]: false }),
      "the key in quotes": JSON.stringify({ subscriptionEnabled: true, provider: "subscription", [PACKAGED_OPT_IN]: "true" }),
      "no file": null,
    };
    for (const [how, body] of Object.entries(leftBehind)) {
      await writeFile(file, withKey);
      const store = createConnectionStore({ file });
      expect([how, store.packagedOptIn()]).toEqual([how, true]);
      if (body === null) await rm(file);
      else await writeFile(file, body);
      // Any save, such as turning the switch off in Settings before quitting.
      store.update({ subscriptionEnabled: false });
      store.update({ subscriptionEnabled: true, provider: "api_key" });
      const text = await readFile(file, "utf8").catch(() => "");
      expect(text, how).not.toContain(PACKAGED_OPT_IN + '": true');
      // The next launch isn't opted in, and a packaged app doesn't offer the switch.
      const next = createConnectionStore({ file });
      expect([how, next.packagedOptIn(), offersSubscription({ packaged: true, optedIn: next.packagedOptIn() })]).toEqual([how, false, false]);
    }
    // A store that never read it doesn't invent it either.
    await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription" }));
    const plain = createConnectionStore({ file });
    await writeFile(file, "{ half an edit");
    plain.update({ subscriptionEnabled: false });
    expect(await readFile(file, "utf8")).toBe("{ half an edit");
  });

  it("writes it only as `true`: a key with any other value is no key, and a save doesn't keep it", async () => {
    for (const value of [false, "true", 1, null]) {
      await writeFile(file, JSON.stringify({ subscriptionEnabled: true, provider: "subscription", [PACKAGED_OPT_IN]: value }));
      createConnectionStore({ file }).update({ provider: "api_key" });
      expect([value, await saved()]).toEqual([value, { subscriptionEnabled: true, provider: "api_key" }]);
    }
  });
});
