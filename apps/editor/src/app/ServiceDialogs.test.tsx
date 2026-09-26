// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDialogStore, type DialogStore } from "../state/dialogs.ts";
import { ServiceDialogs } from "./ServiceDialogs.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let store: DialogStore;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  store = createDialogStore();
  act(() => root.render(<ServiceDialogs store={store} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const buttonNamed = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;

describe("ServiceDialogs", () => {
  it("opens a danger confirm on Cancel, so Enter can't delete", async () => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = store.confirm({ title: "Delete “Bouncy”?", confirmLabel: "Delete", danger: true });
    });
    expect(document.activeElement).toBe(buttonNamed("Cancel"));
    act(() => buttonNamed("Cancel").click());
    await expect(answer).resolves.toBe(false);
  });

  it("opens a plain confirm on its confirming button", () => {
    act(() => void store.confirm({ title: "Replace the screen?", confirmLabel: "Replace" }));
    expect(document.activeElement).toBe(buttonNamed("Replace"));
  });

  it("puts a start-aligned choice on the left, quiet, and focuses the primary one", async () => {
    let answer!: Promise<string | null>;
    act(() => {
      answer = store.choose({
        title: "Changed on disk",
        actions: [
          { value: "overwrite", label: "Save Anyway", variant: "danger", align: "start" },
          { value: "cancel", label: "Cancel" },
          { value: "reload", label: "Reload", variant: "primary" },
        ],
      });
    });
    const anyway = buttonNamed("Save Anyway");
    expect(anyway.closest(".sb-appdialog__actions-start")).not.toBeNull();
    expect(anyway.dataset.variant).toBe("ghost");
    expect(anyway.dataset.tone).toBe("danger");
    expect(buttonNamed("Cancel").closest(".sb-appdialog__actions-start")).toBeNull();
    expect(document.activeElement).toBe(buttonNamed("Reload"));
    act(() => anyway.click());
    await expect(answer).resolves.toBe("overwrite");
  });

  it("focuses the last end action when nothing is primary", () => {
    act(() =>
      void store.choose({
        title: "Leave?",
        actions: [
          { value: "discard", label: "Discard", variant: "danger", align: "start" },
          { value: "cancel", label: "Cancel" },
        ],
      }),
    );
    expect(document.activeElement).toBe(buttonNamed("Cancel"));
  });
});
