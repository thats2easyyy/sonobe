// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeView, type TreeViewProps } from "./TreeView.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Node {
  id: string;
  name: string;
  children?: Node[];
}

const NODES: Node[] = [
  { id: "group", name: "Group", children: [{ id: "child", name: "Child" }] },
  { id: "leaf", name: "Leaf" },
];

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
  vi.restoreAllMocks();
});

function render(props: Partial<TreeViewProps<Node>> = {}) {
  act(() => root.render(<TreeView<Node> aria-label="Layers" nodes={NODES} getLabel={(n) => n.name} defaultExpanded={["group"]} {...props} />));
}

const tree = () => container.querySelector<HTMLElement>(".sb-tree")!;
const row = (id: string) => [...container.querySelectorAll<HTMLElement>(".sb-tree__row")].find((r) => r.id.endsWith(`-row-${id}`))!;
const key = (target: Element, init: KeyboardEventInit) => act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));

describe("TreeView", () => {
  it("names a row by its label and describes it with its status", () => {
    render({ renderTrailing: () => <span aria-label="Locked" />, renderActions: () => <button type="button">Hide</button> });
    const item = row("leaf");
    expect(item.getAttribute("aria-labelledby")).toBe(`${item.id}-label`);
    expect(item.querySelector(".sb-tree__label")!.id).toBe(`${item.id}-label`);
    expect(item.querySelector(".sb-tree__label")!.hasAttribute("title")).toBe(false);
    expect(item.getAttribute("aria-describedby")).toBe(`${item.id}-trailing`);
    expect(item.querySelector(`#${CSS.escape(`${item.id}-trailing`)}`)).not.toBeNull();
  });

  it("labels a row directly while it is renamed", () => {
    render({ onRename: () => undefined });
    act(() => tree().focus());
    key(tree(), { key: "F2" });
    const item = row("group");
    expect(item.getAttribute("aria-label")).toBe("Group");
    expect(item.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("draws no chevron when it is not expandable", () => {
    render({ expandable: false });
    expect(container.querySelector(".sb-tree__chevron svg")).toBeNull();
    expect(container.querySelector(".sb-tree__chevron[data-visible]")).toBeNull();
    render({ expandable: true });
    expect(container.querySelector(".sb-tree__chevron[data-visible] svg")).not.toBeNull();
  });

  it("leaves expansion alone when it is not expandable", () => {
    const onExpandedChange = vi.fn();
    render({ expandable: false, expanded: new Set(["group"]), onExpandedChange });
    act(() => tree().focus());
    key(tree(), { key: "ArrowLeft" });
    act(() => void row("group").querySelector(".sb-tree__chevron")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("activates instead of renaming when a double-click may not rename", () => {
    const onActivate = vi.fn();
    render({ onRename: () => undefined, onActivate, renameOnDoubleClick: (n) => n.id !== "leaf" });
    act(() => void row("leaf").querySelector(".sb-tree__label")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onActivate).toHaveBeenCalledWith(NODES[1]);
    expect(container.querySelector(".sb-tree__rename")).toBeNull();
    act(() => void row("group").querySelector(".sb-tree__label")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(container.querySelector(".sb-tree__rename")).not.toBeNull();
  });

  it("starts a rename when a request arrives, and ignores the one it mounted with", () => {
    render({ onRename: () => undefined, renameRequest: { id: "leaf", nonce: 1 } });
    expect(container.querySelector(".sb-tree__rename")).toBeNull();
    render({ onRename: () => undefined, renameRequest: { id: "leaf", nonce: 2 } });
    const input = container.querySelector<HTMLInputElement>(".sb-tree__rename")!;
    expect(input.value).toBe("Leaf");
    expect(row("leaf").contains(input)).toBe(true);
  });

  it("shows the full name in a tooltip only for a truncated label", () => {
    vi.useFakeTimers();
    try {
      const scrollWidth = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
      const hover = (id: string) => {
        act(() => void row(id).querySelector(".sb-tree__label")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
        act(() => void row(id).querySelector(".sb-tree__label")!.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
        act(() => void vi.advanceTimersByTime(600));
      };
      render();
      scrollWidth.mockReturnValue(100);
      hover("leaf");
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      scrollWidth.mockReturnValue(160);
      hover("group");
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Group");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a rename request when rows cannot be renamed", () => {
    render({ renameRequest: { id: "leaf", nonce: 1 } });
    render({ renameRequest: { id: "leaf", nonce: 2 } });
    expect(container.querySelector(".sb-tree__rename")).toBeNull();
  });

  it("scrolls to a row a virtualized tree has not rendered", () => {
    const many: Node[] = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, name: `Row ${i}` }));
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(260);
    render({ nodes: many, defaultExpanded: [], scrollToId: { id: "n200", nonce: 1 } });
    expect(tree().scrollTop).toBe(200 * 26 + 26 - 260);
    render({ nodes: many, defaultExpanded: [], scrollToId: { id: "n0", nonce: 2 } });
    expect(tree().scrollTop).toBe(0);
  });

  it("opens the focused row's menu from the keyboard", () => {
    const onRowContextMenu = vi.fn();
    render({ onRowContextMenu });
    act(() => tree().focus());
    key(tree(), { key: "ArrowDown" });
    key(tree(), { key: "ContextMenu" });
    expect(onRowContextMenu).toHaveBeenCalledTimes(1);
    expect(onRowContextMenu.mock.calls[0]![0]).toBe(NODES[0]!.children![0]);
    key(tree(), { key: "F10", shiftKey: true });
    expect(onRowContextMenu).toHaveBeenCalledTimes(2);
    key(tree(), { key: "F10" });
    expect(onRowContextMenu).toHaveBeenCalledTimes(2);
  });

  it("tells the consumer a menu came from the keyboard, and where the row is", () => {
    const onRowContextMenu = vi.fn();
    render({ onRowContextMenu });
    act(() => tree().focus());
    act(() => void row("leaf").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(onRowContextMenu.mock.calls[0]![2]).toMatchObject({ keyboard: false, rect: { width: expect.any(Number) } });
    key(tree(), { key: "ContextMenu" });
    expect(onRowContextMenu.mock.calls[1]![2].keyboard).toBe(true);
    act(() => void row("leaf").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(onRowContextMenu.mock.calls[2]![2].keyboard).toBe(false);
  });

  it("opens the focused row's menu from a contextmenu on the tree itself, only after keyboard use", () => {
    const onRowContextMenu = vi.fn();
    render({ onRowContextMenu });
    act(() => tree().focus());
    const fire = () => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      act(() => void tree().dispatchEvent(event));
      return event;
    };
    tree().removeAttribute("data-kbd");
    fire();
    expect(onRowContextMenu).not.toHaveBeenCalled();
    key(tree(), { key: "ArrowDown" });
    onRowContextMenu.mockClear();
    const event = fire();
    expect(event.defaultPrevented).toBe(true);
    expect(onRowContextMenu).toHaveBeenCalledTimes(1);
    expect(onRowContextMenu.mock.calls[0]![0]).toBe(NODES[0]!.children![0]);
    expect(onRowContextMenu.mock.calls[0]![2].keyboard).toBe(true);
  });

  describe("drag autoscroll", () => {
    let frames: FrameRequestCallback[];
    const runFrame = () => {
      const pending = frames.splice(0);
      act(() => pending.forEach((cb) => cb(0)));
    };

    beforeEach(() => {
      frames = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(260);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 260, width: 300, height: 260, toJSON: () => ({}) });
      HTMLElement.prototype.setPointerCapture = () => undefined;
    });

    function startDrag() {
      const many: Node[] = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, name: `Row ${i}` }));
      render({ nodes: many, defaultExpanded: [], onMove: () => undefined });
      act(() => tree().focus());
      act(() => void row("n0").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 40, clientY: 10 })));
      act(() => void tree().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 40, clientY: 255 })));
    }

    it("scrolls every frame while the pointer rests at the bottom edge", () => {
      startDrag();
      runFrame();
      const once = tree().scrollTop;
      expect(once).toBeGreaterThan(0);
      runFrame();
      expect(tree().scrollTop).toBeGreaterThan(once);
    });

    it("stops on Escape", () => {
      startDrag();
      runFrame();
      key(tree(), { key: "Escape" });
      const stopped = tree().scrollTop;
      runFrame();
      runFrame();
      expect(tree().scrollTop).toBe(stopped);
      expect(frames).toHaveLength(0);
    });

    it("stops on pointer up", () => {
      startDrag();
      act(() => void tree().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
      const stopped = tree().scrollTop;
      runFrame();
      expect(tree().scrollTop).toBe(stopped);
      expect(frames).toHaveLength(0);
    });
  });

  it("marks keyboard use so the focus ring stays off after a click", () => {
    render();
    act(() => tree().focus());
    key(tree(), { key: "ArrowDown" });
    expect(tree().hasAttribute("data-kbd")).toBe(true);
    act(() => void row("leaf").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 })));
    expect(tree().hasAttribute("data-kbd")).toBe(false);
  });
});
