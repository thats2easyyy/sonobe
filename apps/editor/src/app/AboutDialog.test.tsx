// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog.tsx";
import { fakeUpdatesHost, updateStatus, type FakeUpdatesHost } from "./updates/testing.ts";
import { updateLine } from "./updates/UpdateStatusLine.tsx";
import { followUpdates, updateStore } from "./updates/updateStore.ts";
import type { UpdateStatus } from "./updates/updatesHost.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let unfollow: () => void = () => undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  unfollow();
  unfollow = () => undefined;
  updateStore.setState({ status: null });
  delete (window as { sonobeHost?: unknown }).sonobeHost;
  container.remove();
  document.body.innerHTML = "";
});

/** About in the desktop app (with `updates`) or in the browser (null). */
async function mount(updates: FakeUpdatesHost | null) {
  if (updates) {
    (window as { sonobeHost?: unknown }).sonobeHost = { platform: "darwin", version: "0.1.0", updates, openExternal: vi.fn() };
    unfollow = followUpdates();
  }
  await act(async () => {
    root.render(<AboutDialog open onOpenChange={() => undefined} onReportIssue={() => undefined} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const line = () => document.querySelector<HTMLElement>(".sb-update-line");
const lineText = () => line()?.querySelector(".sb-update-line__text")?.textContent ?? null;
const lineButton = () => line()?.querySelector<HTMLButtonElement>("button") ?? null;
const push = (updates: FakeUpdatesHost, patch: Partial<UpdateStatus>) => act(() => void updates.push(patch));

describe("About → the update line", () => {
  it("shows the version and where this copy stands, state by state", async () => {
    const updates = fakeUpdatesHost();
    await mount(updates);
    expect(document.body.textContent).toContain("Version 0.1.0 · Desktop app for macOS");
    expect(lineText()).toBe("Sonobe hasn't checked for updates yet.");
    expect(lineButton()?.textContent).toBe("Check now");

    push(updates, { state: "checking" });
    expect(lineText()).toBe("Checking for updates…");
    expect(lineButton()).toBeNull();

    push(updates, { state: "upToDate", checkedAt: 1 });
    expect(lineText()).toBe("Sonobe is up to date.");
    expect(lineButton()?.textContent).toBe("Check again");

    push(updates, { state: "downloading", version: "0.2.0", progress: 0.42 });
    expect(lineText()).toBe("Downloading Sonobe 0.2.0… 42%");
    expect(line()?.querySelector(".sb-update-line__percent")?.classList.contains("sb-tabular")).toBe(true);
    expect(lineButton()).toBeNull();

    push(updates, { state: "ready", progress: null });
    expect(lineText()).toBe("Sonobe 0.2.0 is ready to install.");
    expect(lineButton()?.textContent).toBe("Restart to Update");

    push(updates, { state: "failed", error: { kind: "rejected", message: "macOS wouldn't install the update: its signature doesn't match this copy of Sonobe.", hint: "Download the new version from the release page and replace Sonobe in your Applications folder." } });
    expect(lineText()).toBe("macOS wouldn't install the update: its signature doesn't match this copy of Sonobe. Download the new version from the release page and replace Sonobe in your Applications folder.");
    expect(lineButton()?.textContent).toBe("Open release page");

    push(updates, { state: "failed", error: { kind: "network", message: "Sonobe couldn't reach the release feed to check for updates.", hint: "Check your internet connection, then choose Check for Updates again." } });
    expect(lineButton()?.textContent).toBe("Check again");
  });

  it("says a version is available with why this copy can't install it, and opens the release page", async () => {
    const reason = "This copy of Sonobe was built locally, so it can't replace itself. Download the new version instead.";
    const updates = fakeUpdatesHost({ mode: "notify", state: "available", version: "0.2.0", reason, releaseUrl: "https://example.test/tag/v0.2.0" });
    await mount(updates);
    expect(lineText()).toBe(`Sonobe 0.2.0 is available. ${reason}`);
    expect(lineButton()?.textContent).toBe("Download");
    act(() => lineButton()!.click());
    expect((window as unknown as { sonobeHost: { openExternal: ReturnType<typeof vi.fn> } }).sonobeHost.openExternal).toHaveBeenCalledWith("https://example.test/tag/v0.2.0");
  });

  it("offers the move to Applications where that lets this copy update itself", async () => {
    const updates = fakeUpdatesHost({ mode: "notify", state: "available", version: "0.2.0", canMove: true, reason: "Sonobe updates itself only from an Applications folder. Move it there." });
    await mount(updates);
    expect(lineButton()?.textContent).toBe("Move to Applications");
    await act(async () => lineButton()!.click());
    expect(updates.calls).toEqual(["move"]);
  });

  it("asks the app to check and to restart", async () => {
    const updates = fakeUpdatesHost({}, { found: { state: "ready", version: "0.2.0" } });
    await mount(updates);
    await act(async () => lineButton()!.click());
    expect(lineText()).toBe("Sonobe 0.2.0 is ready to install.");
    await act(async () => lineButton()!.click());
    expect(updates.calls).toEqual(["check", "restart"]);
  });

  it("says when automatic checks are off", async () => {
    await mount(fakeUpdatesHost({ autoCheck: false }));
    expect(lineText()).toBe("Automatic update checks are off.");
    expect(lineButton()?.textContent).toBe("Check now");
  });

  it("isn't there in a copy that never checks, or in the browser", async () => {
    await mount(fakeUpdatesHost({ mode: "off", reason: "Sonobe run from a checkout doesn't check for updates. Pull the repository instead." }));
    expect(line()).toBeNull();
    expect(document.body.textContent).not.toContain("updates");
    act(() => root.unmount());
    unfollow();
    updateStore.setState({ status: null });
    delete (window as { sonobeHost?: unknown }).sonobeHost;
    root = createRoot(container);
    await mount(null);
    expect(document.body.textContent).toContain("In your browser");
    expect(line()).toBeNull();
  });
});

describe("updateLine", () => {
  it("has one sentence for every state, and at most one action", () => {
    for (const state of ["idle", "checking", "upToDate", "available", "downloading", "ready", "failed"] as const) {
      const described = updateLine(updateStatus({ state, version: "0.2.0" }));
      expect(described?.text, state).toBeTruthy();
    }
    expect(updateLine(updateStatus({ mode: "off" }))).toBeNull();
    expect(updateLine(updateStatus({ state: "available" }))?.text).toBe("A new version of Sonobe is available.");
  });
});
