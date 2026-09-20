// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useReducedMotion } from "./useReducedMotion.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let osReduces = false;
const seen: boolean[] = [];

function Probe() {
  seen.push(useReducedMotion());
  return null;
}

beforeEach(() => {
  osReduces = false;
  seen.length = 0;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query.includes("reduce") && osReduces, addEventListener() {}, removeEventListener() {} }),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("data-motion");
  document.documentElement.removeAttribute("data-reduced-motion");
});

async function render(): Promise<void> {
  await act(async () => root.render(<Probe />));
}

/** Let the MutationObserver report, then React re-render. */
async function settle(): Promise<void> {
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("useReducedMotion", () => {
  it("follows the OS while Settings → Motion is System", async () => {
    osReduces = true;
    await render();
    expect(seen.at(-1)).toBe(true);
  });

  it("follows Settings → Motion over the OS", async () => {
    osReduces = true;
    document.documentElement.setAttribute("data-motion", "full");
    await render();
    expect(seen.at(-1)).toBe(false);
    document.documentElement.setAttribute("data-motion", "reduce");
    await settle();
    expect(seen.at(-1)).toBe(true);
  });

  it("reads the dev page's data-reduced-motion", async () => {
    document.documentElement.setAttribute("data-reduced-motion", "true");
    await render();
    expect(seen.at(-1)).toBe(true);
  });
});
