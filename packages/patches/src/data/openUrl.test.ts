import type { PlatformServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { REFUSED_URL_SCHEMES, openUrl, validateOpenUrl } from "./openUrl.ts";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const PULSE = { pulses: ["open"] } as const;

function host(result: unknown = undefined) {
  const opened: string[] = [];
  const openHost = ((url: string) => {
    opened.push(url);
    return typeof result === "function" ? (result as (url: string) => unknown)(url) : result;
  }) as PlatformServices["openUrl"];
  return { opened, platform: { openUrl: openHost } };
}

describe("validateOpenUrl", () => {
  it("needs a URL with a scheme and refuses dangerous schemes", () => {
    expect(validateOpenUrl("")).toBe("Add a URL to open.");
    expect(validateOpenUrl("www.sonobe.dev")).toBe("Start the URL with https:// or an app scheme like myapp://.");
    for (const scheme of REFUSED_URL_SCHEMES) expect(validateOpenUrl(`${scheme}:x`)).toBe(`Links using ${scheme}: can't be opened from a prototype.`);
    expect(validateOpenUrl("JavaScript:alert(1)")).toBe("Links using javascript: can't be opened from a prototype.");
    for (const url of ["https://sonobe.dev", "http://localhost:3000", "mailto:a@b.test", "tel:+15555550100", "sms:+15555550100", "myapp://open"]) {
      expect(validateOpenUrl(url), url).toBeUndefined();
    }
  });
});

describe("openUrl", () => {
  it("opens the trimmed URL through the host on each pulse", () => {
    const { opened, platform } = host();
    const h = createPatchHarness(openUrl, { inputs: { url: " https://sonobe.dev " }, services: { platform } });
    expect(h.step().pulses.size).toBe(0);
    const f = h.step(PULSE);
    expect([...f.pulses]).toEqual(["opened"]);
    expect(f.outputs.errorMessage).toBe("");
    expect(opened).toEqual(["https://sonobe.dev"]);
    h.step({ inputs: { url: "https://example.test" } });
    expect(opened).toHaveLength(1);
    h.step(PULSE);
    h.step(PULSE);
    expect(opened).toEqual(["https://sonobe.dev", "https://example.test", "https://example.test"]);
  });

  it("pulses Failed with a readable message, and keeps it until a link opens", () => {
    const noHost = createPatchHarness(openUrl, { inputs: { url: "https://sonobe.dev" } }).step(PULSE);
    expect([...noHost.pulses]).toEqual(["failed"]);
    expect(noHost.outputs.errorMessage).toBe("This viewer can't open links.");

    const refused = host();
    const f = createPatchHarness(openUrl, { inputs: { url: "javascript:alert(1)" }, services: { platform: refused.platform } }).step(PULSE);
    expect(f.outputs.errorMessage).toBe("Links using javascript: can't be opened from a prototype.");
    expect(refused.opened).toEqual([]);

    const blocked = createPatchHarness(openUrl, { inputs: { url: "myapp://x" }, services: { platform: host(false).platform } });
    expect(blocked.step(PULSE).outputs.errorMessage).toBe("The link couldn't be opened. The browser may have blocked it, or no app handles it.");
    expect(blocked.step().outputs.errorMessage).toContain("blocked");

    const throwing = host(() => {
      throw new Error("denied");
    });
    expect(createPatchHarness(openUrl, { inputs: { url: "https://a.test" }, services: { platform: throwing.platform } }).step(PULSE).outputs.errorMessage).toBe(
      "The link couldn't be opened: Error: denied",
    );
  });

  it("reports promise results on the frame after they settle", async () => {
    const h = createPatchHarness(openUrl, { inputs: { url: "https://a.test" }, services: { platform: host(() => Promise.resolve(false)).platform } });
    const f0 = h.step(PULSE);
    expect(f0.pulses.size).toBe(0);
    expect(f0.requestedNextFrame).toBe(true);
    await flush();
    expect([...h.step().pulses]).toEqual(["failed"]);

    const ok = createPatchHarness(openUrl, { inputs: { url: "https://a.test" }, services: { platform: host(() => Promise.resolve(true)).platform } });
    ok.step(PULSE);
    await flush();
    const f = ok.step();
    expect([...f.pulses]).toEqual(["opened"]);
    expect(f.requestedNextFrame).toBe(false);
  });

  it("opens at most one link per frame across loop indices", () => {
    const { opened, platform } = host();
    const h = createPatchHarness(openUrl, { inputs: { url: loopOf(["https://a.test", "https://b.test"]) }, services: { platform } });
    const f = h.step(PULSE);
    expect(opened).toEqual(["https://a.test"]);
    expect(f.pulseItems.opened).toEqual([true, false]);
    expect(f.pulseItems.failed).toEqual([false, true]);
    expect(f.outputs.errorMessage).toEqual(loopOf(["", "Only one link can open per frame."]));
    h.step(PULSE);
    expect(opened).toEqual(["https://a.test", "https://a.test"]);
  });

  it("can open again on frame 0 after a restart", () => {
    const { opened, platform } = host();
    const h = createPatchHarness(openUrl, { inputs: { url: "https://a.test" }, services: { platform } });
    h.step(PULSE);
    h.restart();
    expect([...h.step(PULSE).pulses]).toEqual(["opened"]);
    expect(opened).toHaveLength(2);
  });

  it("never opens anything while muted", () => {
    const { opened, platform } = host();
    const run = runPatch(openUrl, [{ open: true, url: "https://a.test" }], { muted: true, services: { platform } });
    expect(opened).toEqual([]);
    expect(run.frames[0]!.pulses).toEqual([]);
    expect(run.frames[0]!.outputs.errorMessage).toBe("");
  });
});
