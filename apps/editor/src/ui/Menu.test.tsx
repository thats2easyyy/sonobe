// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MenuList, type MenuEntry } from "./Menu.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const entries: MenuEntry[] = [
  { type: "label", label: "Group", id: "eyebrow" },
  { type: "label", label: "Insert above “Card”", id: "plain", plain: true },
  { id: "lock", label: "Lock", disabled: true, tooltip: "Unlock the group first" },
  { id: "snap", label: "Snap to grid", checked: true },
  { id: "plainrow", label: "Duplicate" },
];

const render = () => act(() => root.render(<MenuList entries={entries} autoFocus="none" onClose={() => undefined} aria-label="Test" />));
const item = (label: string) => [...container.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) => el.textContent === label)!;

describe("MenuList", () => {
  it("keeps a plain label in its own case and marks the others as eyebrows", () => {
    render();
    const labels = container.querySelectorAll<HTMLElement>(".sb-menu__label");
    expect(labels[0]!.hasAttribute("data-plain")).toBe(false);
    expect(labels[1]!.hasAttribute("data-plain")).toBe(true);
  });

  it("marks checked rows so they take the accent tint", () => {
    render();
    expect(item("Snap to grid").hasAttribute("data-checked")).toBe(true);
    expect(item("Duplicate").hasAttribute("data-checked")).toBe(false);
  });

  it("shows a row's tooltip on hover, also when the row is disabled", () => {
    render();
    expect(item("Lock").getAttribute("aria-disabled")).toBe("true");
    const lock = item("Lock");
    const matches = lock.matches.bind(lock);
    Object.defineProperty(lock, "matches", { value: (selector: string) => (selector === ":focus-visible" ? true : matches(selector)), configurable: true });
    act(() => lock.focus());
    expect(document.querySelector(".sb-tooltip")?.textContent).toBe("Unlock the group first");
    expect(document.querySelector(".sb-tooltip")!.getAttribute("id")).toBe(lock.getAttribute("aria-describedby"));
  });

  it("lets arrow keys reach a disabled row that says why, and skips one that does not", () => {
    const list: MenuEntry[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta", disabled: true },
      { id: "c", label: "Gamma", disabled: true, tooltip: "Unlock it first" },
      { id: "d", label: "Delta" },
    ];
    act(() => root.render(<MenuList entries={list} autoFocus="first" onClose={() => undefined} aria-label="Test" />));
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    const press = () => act(() => void menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    press();
    expect(item("Gamma").hasAttribute("data-active")).toBe(true);
    press();
    expect(item("Delta").hasAttribute("data-active")).toBe(true);
  });

  it("puts no tooltip on rows without one", () => {
    render();
    expect(item("Duplicate").hasAttribute("aria-describedby")).toBe(false);
  });
});
