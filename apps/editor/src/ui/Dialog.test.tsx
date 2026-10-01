// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dialog } from "./Dialog.tsx";
import { isBehindModal } from "./lib/focus.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // happy-dom reports no client rects, which getFocusable treats as hidden.
  HTMLElement.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as { getClientRects?: unknown }).getClientRects;
});

function open(children: ReactNode, props: { "aria-label"?: string } = {}) {
  act(() =>
    root.render(
      <Dialog open onOpenChange={() => undefined} {...props}>
        {children}
      </Dialog>,
    ),
  );
}

const focused = () => document.activeElement as HTMLElement;

describe("Dialog initial focus", () => {
  it("prefers data-autofocus over everything else", () => {
    open(
      <>
        <Dialog.Header title="Rename" onClose={() => undefined} />
        <input aria-label="Name" />
        <button data-autofocus>Safe</button>
      </>,
    );
    expect(focused().textContent).toBe("Safe");
  });

  it("skips the close X and lands on the first field", () => {
    open(
      <>
        <Dialog.Header title="Rename" onClose={() => undefined} />
        <Dialog.Body>
          <button>Link</button>
          <input aria-label="Name" />
        </Dialog.Body>
      </>,
    );
    expect(focused().getAttribute("aria-label")).toBe("Name");
  });

  it("without a field, lands on the footer's last button, not its destructive start side", () => {
    open(
      <>
        <Dialog.Header title="About" onClose={() => undefined} />
        <Dialog.Body>
          <a href="https://example.com">Credit</a>
        </Dialog.Body>
        <Dialog.Footer start={<button>Delete</button>}>
          <Dialog.Close>
            <button>Cancel</button>
          </Dialog.Close>
          <button>Done</button>
        </Dialog.Footer>
      </>,
    );
    expect(focused().textContent).toBe("Done");
  });

  it("never lands on a roving-tabindex item that isn't the current one", () => {
    open(
      <div role="radiogroup" aria-label="Theme">
        <button role="radio" aria-checked="false" tabIndex={-1}>
          Dark
        </button>
        <button role="radio" aria-checked="true" tabIndex={0}>
          Light
        </button>
      </div>,
    );
    expect(focused().textContent).toBe("Light");
  });

  it("falls back to the panel when nothing else can take focus", () => {
    open(<Dialog.Header title="Empty" onClose={() => undefined} />);
    expect(focused().getAttribute("role")).toBe("dialog");
  });
});

describe("Dialog focus hold", () => {
  const behind = (attrs: Record<string, string> = {}) => {
    const wrap = document.createElement("div");
    for (const [name, value] of Object.entries(attrs)) wrap.setAttribute(name, value);
    const button = document.createElement("button");
    wrap.appendChild(button);
    container.before(wrap);
    return button;
  };

  it("takes focus back from something behind it, to where it was in the dialog", () => {
    const late = behind();
    open(
      <>
        <input aria-label="Search" />
        <button>Done</button>
      </>,
    );
    expect(focused().getAttribute("aria-label")).toBe("Search");
    expect(isBehindModal(late)).toBe(true);
    late.focus();
    expect(focused().getAttribute("aria-label")).toBe("Search");

    const done = [...document.querySelectorAll("button")].find((b) => b.textContent === "Done")!;
    done.focus();
    late.focus();
    expect(focused()).toBe(done);
    expect(isBehindModal(done)).toBe(false);
  });

  it("lets a layer opened over it, and the toaster, keep focus", () => {
    const toast = behind({ "data-layer-ignore": "" });
    open(<input aria-label="Search" />);
    const menu = document.createElement("button");
    document.body.appendChild(menu);
    expect(isBehindModal(menu)).toBe(false);
    menu.focus();
    expect(focused()).toBe(menu);
    toast.focus();
    expect(focused()).toBe(toast);
  });

  it("lets go as it closes, so focus returns to what opened it", () => {
    const opener = behind();
    opener.focus();
    open(<input aria-label="Search" />);
    expect(focused().getAttribute("aria-label")).toBe("Search");
    act(() => root.render(<Dialog open={false} onOpenChange={() => undefined}>{null}</Dialog>));
    expect(focused()).toBe(opener);
    expect(isBehindModal(opener)).toBe(false);
    const other = behind();
    other.focus();
    expect(focused()).toBe(other);
  });
});

describe("Dialog.Header", () => {
  it("names the dialog by its title when there is no aria-label", () => {
    open(<Dialog.Header title="Rename prototype" />);
    const dialog = document.querySelector('[role="dialog"]')!;
    const title = dialog.querySelector("h2")!;
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
  });

  it("leaves an explicit aria-label alone", () => {
    open(<Dialog.Header title="Rename prototype" />, { "aria-label": "Rename" });
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-labelledby")).toBeNull();
  });
});
