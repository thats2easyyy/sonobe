import { describe, expect, it } from "vitest";
import { createConnectClaudeStore } from "./connectStore.ts";

describe("connectClaudeStore", () => {
  it("counts opens and records copies", () => {
    let t = 10;
    const store = createConnectClaudeStore(() => t);
    store.getState().show("desktop");
    store.getState().show();
    expect(store.getState()).toMatchObject({ open: true, tab: "desktop", openCount: 1 });
    store.getState().setOpen(false);
    store.getState().setOpen(true);
    expect(store.getState().openCount).toBe(2);
    store.getState().markCopied("setup");
    t = 20;
    store.getState().markCopied("prompt");
    expect(store.getState().copied).toEqual({ setup: 10, prompt: 20 });
  });
});
