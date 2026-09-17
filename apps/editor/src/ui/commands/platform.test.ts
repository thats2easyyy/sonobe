import { afterEach, describe, expect, it } from "vitest";
import { detectHostPlatform, detectPlatform, platformFromName } from "./shortcutManager.ts";

const g = globalThis as { sonobeHost?: { platform: string } };

afterEach(() => {
  delete g.sonobeHost;
});

describe("platform detection", () => {
  it("reads Node and browser platform names", () => {
    expect(platformFromName("darwin")).toBe("mac");
    expect(platformFromName("MacIntel")).toBe("mac");
    expect(platformFromName("macOS")).toBe("mac");
    expect(platformFromName("win32")).toBe("windows");
    expect(platformFromName("Windows")).toBe("windows");
    expect(platformFromName("Linux x86_64")).toBe("linux");
    expect(platformFromName("")).toBeUndefined();
    expect(platformFromName("Unknown")).toBeUndefined();
  });

  it("prefers userAgentData, then platform, then the user agent", () => {
    expect(detectPlatform({ userAgentData: { platform: "macOS" }, platform: "Win32" })).toBe("mac");
    expect(detectPlatform({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe("mac");
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe("windows");
    expect(detectPlatform({})).toBe("linux");
  });

  it("trusts the desktop host over what the web view reports", () => {
    expect(detectPlatform({ platform: "Win32" }, { platform: "darwin" })).toBe("mac");
    expect(detectHostPlatform({ platform: "MacIntel" }, { platform: "win32" })).toBe("win32");
    g.sonobeHost = { platform: "darwin" };
    expect(detectPlatform()).toBe("mac");
    expect(detectHostPlatform()).toBe("darwin");
    // An explicit navigator without a host ignores window.sonobeHost (tests, previews).
    expect(detectPlatform({ platform: "Linux x86_64" })).toBe("linux");
  });
});
