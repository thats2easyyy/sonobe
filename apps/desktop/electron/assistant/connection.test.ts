import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnectionStore } from "./connection.ts";
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
