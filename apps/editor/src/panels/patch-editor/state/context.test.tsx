// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchEditorContext, useLiveValue, type PatchEditorContextValue } from "./context.ts";
import { createLiveStore, type LiveStore } from "./liveStore.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let live: LiveStore;
let renders: number;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  live = createLiveStore();
  renders = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Prints the value. With `coarse` it renders again only when the value's sign changes. */
function Clock({ address, coarse }: { address: string | null; coarse: boolean }) {
  renders++;
  return <span>{String(useLiveValue(address, coarse ? (value) => typeof value === "number" && value > 0 : undefined))}</span>;
}

const mount = (address: string | null, coarse: boolean) => act(() => root.render(<PatchEditorContext.Provider value={{ live } as PatchEditorContextValue}>{<Clock address={address} coarse={coarse} />}</PatchEditorContext.Provider>));

describe("useLiveValue", () => {
  it("follows every value", () => {
    mount("time.time", false);
    expect(container.textContent).toBe("undefined");
    for (let i = 1; i <= 3; i++) act(() => live.setValues({ "time.time": i }));
    expect(container.textContent).toBe("3");
    expect(renders).toBe(4);
  });

  it("with `shown`, renders again when what's shown changes, with the value as it is then", () => {
    mount("time.time", true);
    expect(renders).toBe(1);
    for (let i = 1; i <= 10; i++) act(() => live.setValues({ "time.time": i }));
    // One render, when the clock turned positive: it printed that value and none since.
    expect(container.textContent).toBe("1");
    expect(renders).toBe(2);
    act(() => live.setValues({ "time.time": -4, "other.value": 5 }));
    expect(container.textContent).toBe("-4");
    expect(renders).toBe(3);
  });

  it("reads the value that's there when it stops being coarse, or starts following an address", () => {
    live.setValues({ "time.time": 1 });
    mount("time.time", true);
    act(() => live.setValues({ "time.time": 9 }));
    expect(container.textContent).toBe("1");
    mount("time.time", false);
    expect(container.textContent).toBe("9");
    mount(null, false);
    expect(container.textContent).toBe("undefined");
  });
});
