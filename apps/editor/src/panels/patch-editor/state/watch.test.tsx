// @vitest-environment happy-dom
import type { SonobeDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import type { EditorSession } from "../../../state/session.ts";
import type { LiveScope } from "../model/instances.ts";
import { useInstanceCopies } from "./watch.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A document as far as the hook reads it: the row component's interface. `revision` stands for everything else in it. */
const docWith = (input: string, revision: number) => ({ revision, components: { row: { interface: { inputs: { [input]: {} }, outputs: {} } } } }) as unknown as SonobeDocument;

/** Inside the component patch "list_row" of the root, which shows the component "row". */
const inRow: LiveScope = { prefix: "list_row", steps: [{ parent: "main", component: "row", instances: [{ id: "list_row", name: "Row", kind: "patch" }], instance: "list_row" }] };
const atRoot: LiveScope = { prefix: "", steps: [] };

let container: HTMLDivElement;
let root: Root;
let renders: number;
let seen: (number | undefined)[];
let inspected: string[];
let copies: number;
const frames = new Set<() => void>();
const documentStore = createStore<{ doc: SonobeDocument }>(() => ({ doc: docWith("title", 0) }));
const session = {
  document: documentStore,
  runtime: {
    subscribeFrame: (cb: () => void) => {
      frames.add(cb);
      return () => frames.delete(cb);
    },
    runtime: {
      inspect: (address: string) => {
        inspected.push(address);
        return { copies };
      },
    },
  },
} as unknown as EditorSession;

function Probe({ scope }: { scope: LiveScope }) {
  renders++;
  seen.push(useInstanceCopies(session, scope));
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renders = 0;
  seen = [];
  inspected = [];
  copies = 3;
  frames.clear();
  documentStore.setState({ doc: docWith("title", 0) });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useInstanceCopies", () => {
  it("doesn't render for a document that leaves the instance's address alone", () => {
    act(() => root.render(<Probe scope={inRow} />));
    expect(seen.at(-1)).toBe(3);
    expect(inspected.at(-1)).toBe("list_row.title");
    const before = renders;
    for (let revision = 1; revision <= 5; revision++) act(() => documentStore.setState({ doc: docWith("title", revision) }));
    expect(renders).toBe(before);

    // The component's first port is renamed: the address is another one, and it reads that.
    act(() => documentStore.setState({ doc: docWith("label", 6) }));
    expect(renders).toBeGreaterThan(before);
    expect(inspected.at(-1)).toBe("list_row.label");
  });

  it("follows the copies that ran, frame by frame, and reads nothing at the root", () => {
    act(() => root.render(<Probe scope={inRow} />));
    copies = 5;
    act(() => frames.forEach((cb) => cb()));
    expect(seen.at(-1)).toBe(5);
    // One copy is how the engine counts an instance that isn't looped.
    copies = 1;
    act(() => frames.forEach((cb) => cb()));
    expect(seen.at(-1)).toBeUndefined();

    act(() => root.render(<Probe scope={atRoot} />));
    expect(seen.at(-1)).toBeUndefined();
    expect(frames.size).toBe(0);
    const before = renders;
    act(() => documentStore.setState({ doc: docWith("title", 7) }));
    expect(renders).toBe(before);
  });
});
