// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuideHome } from "./GuideHome.tsx";
import { getGuideCatalog } from "./guides.ts";

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

const render = (opened: ReadonlySet<string>) => {
  const noop = () => undefined;
  act(() => root.render(<GuideHome catalog={getGuideCatalog()} opened={opened} examples={[]} query="" onQueryChange={noop} onOpenGuide={noop} onOpenPatches={noop} onTryExample={noop} />));
  return container.querySelector(".sb-learnx__next")?.textContent ?? null;
};

describe("GuideHome next guide", () => {
  const catalog = getGuideCatalog();

  it("says where to start before anything is opened", () => {
    expect(render(new Set())).toMatch(/^Start here:/);
  });

  it("points at the first unopened guide once started", () => {
    expect(render(new Set([catalog.guides[0]!.slug]))).toMatch(/^Up next:/);
  });

  it("drops the row when every guide has been opened", () => {
    expect(render(new Set(catalog.guides.map((g) => g.slug)))).toBeNull();
  });
});
