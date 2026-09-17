import { describe, expect, it } from "vitest";
import { createWelcomeStore, shouldShowWelcomeOnLaunch } from "./welcomeStore.ts";

describe("welcome store", () => {
  it("shows on the first launch, then only when asked", () => {
    expect(shouldShowWelcomeOnLaunch(false, false)).toBe(true);
    expect(shouldShowWelcomeOnLaunch(true, false)).toBe(false);
    expect(shouldShowWelcomeOnLaunch(true, true)).toBe(true);
  });

  it("opens with a reason and closes", () => {
    const store = createWelcomeStore({ storageKey: null });
    expect(store.getState().open).toBe(false);
    store.getState().show("new");
    expect(store.getState()).toMatchObject({ open: true, reason: "new" });
    store.getState().show();
    expect(store.getState().reason).toBe("menu");
    store.getState().hide();
    expect(store.getState().open).toBe(false);
  });
});
