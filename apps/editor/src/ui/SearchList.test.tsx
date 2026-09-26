// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchHints, SearchList } from "./SearchList.tsx";
import type { FuzzyKey } from "./lib/fuzzy.ts";

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
});

const items = Array.from({ length: 30 }, (_, i) => `Patch ${i}`);
const keys: FuzzyKey<string>[] = [{ name: "name", get: (i) => i }];

function render() {
  act(() =>
    root.render(
      <SearchList items={items} keys={keys} getId={(i) => i} limit={10} onSelect={() => undefined} aria-label="Patches" renderItem={(item) => <span>{item}</span>} />,
    ),
  );
}

const count = () => container.querySelectorAll('[role="option"]').length;

describe("SearchList limit", () => {
  it("lists everything for an empty query and caps typed results", () => {
    render();
    expect(count()).toBe(30);
    const input = container.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "patch");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(count()).toBe(10);
  });
});

describe("SearchList weakKeys", () => {
  const rowsData = [
    { name: "Comment", tag: "group" },
    { name: "Grouping", tag: "other" },
  ];
  const twoKeys: FuzzyKey<(typeof rowsData)[number]>[] = [
    { name: "name", get: (i) => i.name },
    { name: "tag", get: (i) => i.tag },
  ];
  const renderRows = (weakKeys?: readonly string[]) =>
    act(() =>
      root.render(
        <SearchList items={rowsData} keys={twoKeys} getId={(i) => i.name} weakKeys={weakKeys} query="other" onSelect={() => undefined} aria-label="Rows" renderItem={(item) => <span>{item.name}</span>} />,
      ),
    );

  it("starts with no active row when only weak keys matched", () => {
    renderRows(["tag"]);
    expect(container.querySelector('[role="option"][data-active]')).toBeNull();
  });

  it("activates the first row when a strong key matched or none is weak", () => {
    renderRows(["name"]);
    expect(container.querySelector('[role="option"][data-active]')).not.toBeNull();
    renderRows();
    expect(container.querySelector('[role="option"][data-active]')).not.toBeNull();
  });
});

describe("SearchHints", () => {
  it("reads navigate, the overlay's verb, and close", () => {
    act(() => root.render(<div className="sb-searchlist__footer"><SearchHints verb="insert" /></div>));
    const hints = [...container.querySelectorAll(".sb-searchlist__hint")].map((el) => el.textContent);
    expect(hints).toEqual(["↑↓ navigate", "insert", "Esc close"]);
  });
});
