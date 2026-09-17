// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDialogs } from "./AppDialogs.tsx";
import { createAppDialogStore, type AppDialogStore } from "./dialogs.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let store: AppDialogStore;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  store = createAppDialogStore();
  act(() => root.render(<AppDialogs store={store} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const setInputValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const buttonNamed = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("AppDialogs", () => {
  it("asks for a name and resolves on submit", async () => {
    let result!: Promise<string | null>;
    act(() => {
      result = store.promptName("Photo Zoom");
    });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Prototype name"]')!;
    expect(input.value).toBe("Photo Zoom");
    act(() => setInputValue(input, "  Checkout Flow "));
    act(() => {
      input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(result).resolves.toBe("Checkout Flow");
    expect(document.querySelector('input[aria-label="Prototype name"]')).toBeNull();
  });

  it("disables Save for an empty name, and Cancel resolves null", async () => {
    let result!: Promise<string | null>;
    act(() => {
      result = store.promptName("Draft");
    });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Prototype name"]')!;
    act(() => setInputValue(input, "   "));
    expect(buttonNamed("Save")!.disabled).toBe(true);
    act(() => buttonNamed("Cancel")!.click());
    await expect(result).resolves.toBeNull();
  });

  it("picks a stored prototype", async () => {
    let result!: Promise<string | null>;
    act(() => {
      result = store.pickProject(["Checkout Flow", "Photo Zoom"]);
    });
    const item = [...document.querySelectorAll(".sb-appdialog__item-name")].find((el) => el.textContent === "Photo Zoom") as HTMLElement;
    expect(item).toBeTruthy();
    act(() => item.click());
    await expect(result).resolves.toBe("Photo Zoom");
  });

  it("asks before discarding changes, one request at a time", async () => {
    let first!: Promise<string>;
    let second!: Promise<string>;
    act(() => {
      first = store.confirmDiscard({ name: "Photo Zoom", action: "open" });
      second = store.confirmDiscard({ name: "Photo Zoom", action: "new" });
    });
    expect(document.body.textContent).toContain("Save changes to “Photo Zoom”?");
    expect(document.body.textContent).toContain("opening another prototype");
    act(() => buttonNamed("Don’t Save")!.click());
    await expect(first).resolves.toBe("discard");
    expect(document.body.textContent).toContain("starting a new prototype");
    act(() => buttonNamed("Cancel")!.click());
    await expect(second).resolves.toBe("cancel");
    expect(buttonNamed("Save")).toBeUndefined();
  });
});
