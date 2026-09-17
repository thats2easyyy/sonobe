import type { PlatformServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { jsonFile } from "./jsonFile.ts";

type Fetch = NonNullable<PlatformServices["fetch"]>;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const respond = (text: string, status = 200): ReturnType<Fetch> => Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) });
const assetUrl = (id: string) => `asset://${id}`;

function loadFile(text: string, status = 200) {
  const calls: string[] = [];
  const fetch: Fetch = (url) => {
    calls.push(url);
    return respond(text, status);
  };
  const h = createPatchHarness(jsonFile, { settings: { asset: "data" }, services: { resolveAssetUrl: assetUrl, platform: { fetch } } });
  return { h, calls };
}

describe("jsonFile", () => {
  it("stays idle without a file", () => {
    const h = createPatchHarness(jsonFile);
    const f = h.run(2);
    expect(f.outputs).toEqual({ json: null, loading: false, error: false, errorMessage: "" });
    expect(f.requestedNextFrame).toBe(false);
    expect(h.logs).toEqual([]);
  });

  it("reads the file once, showing Loading until the read settles", async () => {
    const { h, calls } = loadFile('{"items":[1,2]}');
    const f0 = h.step();
    expect(f0.outputs).toEqual({ json: null, loading: true, error: false, errorMessage: "" });
    expect(f0.requestedNextFrame).toBe(true);
    await flush();
    const f1 = h.step();
    expect(f1.outputs).toEqual({ json: { items: [1, 2] }, loading: false, error: false, errorMessage: "" });
    expect(f1.requestedNextFrame).toBe(false);
    h.step();
    expect(calls).toEqual(["asset://data"]);
  });

  it("reports a missing asset or a host that can't read files, warning once", () => {
    const missing = createPatchHarness(jsonFile, { settings: { asset: "data" } });
    expect(missing.step().outputs).toEqual({ json: null, loading: false, error: true, errorMessage: 'No asset named "data" in this project' });
    missing.step();
    expect(missing.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    const noHost = createPatchHarness(jsonFile, { settings: { asset: "data" }, services: { resolveAssetUrl: assetUrl } });
    expect(noHost.step().outputs.errorMessage).toBe("This host can't read project files");
  });

  it("reports failed reads and invalid JSON with readable messages", async () => {
    const failed = loadFile("", 404);
    failed.h.step();
    await flush();
    expect(failed.h.step().outputs).toEqual({ json: null, loading: false, error: true, errorMessage: "Couldn't load data: the file couldn't be read (status 404)" });

    const invalid = loadFile("{nope");
    invalid.h.step();
    await flush();
    const f = invalid.h.step();
    expect(f.outputs.error).toBe(true);
    expect(String(f.outputs.errorMessage).startsWith("data isn't valid JSON: ")).toBe(true);

    const rejected = createPatchHarness(jsonFile, {
      settings: { asset: "data" },
      services: { resolveAssetUrl: assetUrl, platform: { fetch: () => Promise.reject(new Error("offline")) } },
    });
    rejected.step();
    await flush();
    expect(rejected.step().outputs.errorMessage).toBe("Couldn't load data: offline");
  });

  it("strips a byte-order mark before parsing", async () => {
    const { h } = loadFile("﻿[1]");
    h.step();
    await flush();
    expect(h.step().outputs.json).toEqual([1]);
  });

  it("reads again when the file's URL changes and ignores the older read", async () => {
    let version = "v1";
    const finish: Record<string, (text: string) => void> = {};
    const fetch: Fetch = (url) =>
      new Promise((resolve) => {
        finish[url] = (text) => resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
      });
    const h = createPatchHarness(jsonFile, { settings: { asset: "data" }, services: { resolveAssetUrl: (id) => `asset://${id}@${version}`, platform: { fetch } } });
    h.step();
    version = "v2";
    expect(h.step().outputs.loading).toBe(true);
    finish["asset://data@v2"]!("[2]");
    finish["asset://data@v1"]!("[1]");
    await flush();
    expect(h.step().outputs.json).toEqual([2]);
    await flush();
    expect(h.step().outputs.json).toEqual([2]);
  });

  it("ignores a read that settles after dispose", async () => {
    let finish!: (text: string) => void;
    const fetch: Fetch = () =>
      new Promise((resolve) => {
        finish = (text) => resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
      });
    const h = createPatchHarness(jsonFile, { settings: { asset: "data" }, services: { resolveAssetUrl: assetUrl, platform: { fetch } } });
    h.step();
    const state = h.state()!;
    h.dispose();
    finish("[1]");
    await flush();
    expect(state.pending).toBeNull();
  });

  it("starts no reads while muted", () => {
    const calls: string[] = [];
    const fetch: Fetch = (url) => {
      calls.push(url);
      return respond("[]");
    };
    const run = runPatch(jsonFile, [{}, {}], { muted: true, settings: { asset: "data" }, services: { resolveAssetUrl: assetUrl, platform: { fetch } } });
    expect(calls).toEqual([]);
    expect(run.frames[1]!.outputs).toEqual({ json: null, loading: false, error: false, errorMessage: "" });
  });
});
