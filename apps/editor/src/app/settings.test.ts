import { describe, expect, it, vi } from "vitest";
import { applyMotionPreference, createSettingsStore, DEFAULT_SETTINGS, sanitizeSettings, shouldReduceMotion } from "./settings.ts";

describe("settings", () => {
  it("sanitizes stored settings", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ motion: "wild", defaultDevice: "iphone-se", agentPermission: "readOnly", showWelcomeOnLaunch: "yes", trustedProjects: ["/a", 3, "/a", ""] })).toEqual({
      ...DEFAULT_SETTINGS,
      defaultDevice: "iphone-se",
      agentPermission: "readOnly",
      trustedProjects: ["/a"],
    });
    expect(sanitizeSettings({ defaultDevice: "no-such-device" }).defaultDevice).toBe(DEFAULT_SETTINGS.defaultDevice);
  });

  it("updates, trusts, and revokes", () => {
    const store = createSettingsStore({ storageKey: null });
    store.getState().update({ motion: "reduce", agentPermission: "readOnly" });
    expect(store.getState()).toMatchObject({ motion: "reduce", agentPermission: "readOnly" });
    store.getState().trustProject("/work/Checkout.sonobe");
    store.getState().trustProject("/work/Checkout.sonobe");
    expect(store.getState().trustedProjects).toEqual(["/work/Checkout.sonobe"]);
    expect(store.getState().isTrusted("/work/Checkout.sonobe")).toBe(true);
    expect(store.getState().isTrusted(null)).toBe(false);
    store.getState().revokeProject("/work/Checkout.sonobe");
    expect(store.getState().trustedProjects).toEqual([]);
    store.getState().reset();
    expect(store.getState().motion).toBe("system");
  });

  it("decides and applies reduced motion", () => {
    expect(shouldReduceMotion("system", true)).toBe(true);
    expect(shouldReduceMotion("system", false)).toBe(false);
    expect(shouldReduceMotion("reduce", false)).toBe(true);
    expect(shouldReduceMotion("full", true)).toBe(false);
    const root = { setAttribute: vi.fn() } as unknown as HTMLElement;
    applyMotionPreference("reduce", root)();
    expect(root.setAttribute).toHaveBeenLastCalledWith("data-motion", "reduce");
    applyMotionPreference("full", root)();
    expect(root.setAttribute).toHaveBeenLastCalledWith("data-motion", "full");
  });
});
