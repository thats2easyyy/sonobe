// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchEditorContext, useLiveSelect, type PatchEditorContextValue } from "./context.ts";
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

function Positive({ address }: { address: string | null }) {
  renders++;
  return <span>{String(useLiveSelect(address, (value) => typeof value === "number" && value > 0))}</span>;
}

const mount = (address: string | null) => act(() => root.render(<PatchEditorContext.Provider value={{ live } as PatchEditorContextValue}>{<Positive address={address} />}</PatchEditorContext.Provider>));

describe("useLiveSelect", () => {
  it("renders again when what it selects changes, not with every value", () => {
    mount("time.time");
    expect(container.textContent).toBe("false");
    expect(renders).toBe(1);
    for (let i = 1; i <= 10; i++) act(() => live.setValues({ "time.time": i }));
    expect(container.textContent).toBe("true");
    expect(renders).toBe(2);
    act(() => live.setValues({ "time.time": -1, "other.value": 5 }));
    expect(container.textContent).toBe("false");
    expect(renders).toBe(3);
  });

  it("reads the value that's there when it starts following an address", () => {
    live.setValues({ "time.time": 4 });
    mount(null);
    expect(container.textContent).toBe("false");
    mount("time.time");
    expect(container.textContent).toBe("true");
  });
});
