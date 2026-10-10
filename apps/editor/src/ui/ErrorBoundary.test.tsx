// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, failRender, lastBoundaryError, type BoundaryProblem } from "./ErrorBoundary.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** What the panel under test does: a test flips it, then renders or presses Try again. */
let broken = false;

beforeEach(() => {
  // React logs each caught error; the tests read what the boundary shows.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  broken = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  for (const name of ["The Inspector", "Layers"]) failRender(name, false);
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Panel({ label = "Opacity" }: { label?: string }) {
  if (broken) throw new Error("no such layer");
  return <div className="panel">{label}</div>;
}

const text = (selector: string) => container.querySelector(selector)?.textContent ?? null;
const tryAgain = () => act(() => container.querySelector<HTMLButtonElement>(".sb-surface-problem button")!.click());

describe("ErrorBoundary", () => {
  it("shows the problem in place of a child that throws, and leaves what's beside it alone", () => {
    const App = () => (
      <>
        <ErrorBoundary name="The Inspector">
          <Panel />
        </ErrorBoundary>
        <aside className="layers">Layers</aside>
      </>
    );
    act(() => root.render(<App />));
    const layers = container.querySelector(".layers");
    expect(text(".panel")).toBe("Opacity");

    broken = true;
    act(() => root.render(<App />));
    expect(container.querySelector(".panel")).toBeNull();
    expect(container.querySelector(".sb-surface-problem")?.getAttribute("role")).toBe("alert");
    expect(text(".sb-empty__title")).toBe("The Inspector hit a problem");
    expect(text(".sb-empty__description")).toBe("The rest of Sonobe still works.");
    expect(container.querySelector(".layers")).toBe(layers);
    expect(lastBoundaryError()).toMatchObject({ message: "no such layer" });
  });

  it("draws the child again on Try again, and shows the problem again when it still throws", () => {
    broken = true;
    act(() =>
      root.render(
        <ErrorBoundary name="The Inspector">
          <Panel />
        </ErrorBoundary>,
      ),
    );
    tryAgain();
    expect(text(".sb-empty__title")).toBe("The Inspector hit a problem");

    broken = false;
    tryAgain();
    expect(text(".panel")).toBe("Opacity");
    expect(container.querySelector(".sb-surface-problem")).toBeNull();
  });

  it("clears the problem when its reset key changes, with no click", () => {
    const App = ({ selected }: { selected: string }) => (
      <ErrorBoundary name="The Inspector" resetKey={selected}>
        <Panel label={selected} />
      </ErrorBoundary>
    );
    broken = true;
    act(() => root.render(<App selected="card" />));
    expect(text(".sb-empty__title")).toBe("The Inspector hit a problem");

    // The same key keeps the problem: only what it belonged to changing clears it.
    broken = false;
    act(() => root.render(<App selected="card" />));
    expect(container.querySelector(".panel")).toBeNull();

    act(() => root.render(<App selected="dot" />));
    expect(text(".panel")).toBe("dot");
  });

  it("tells onError once per failure, with where it was thrown", () => {
    const onError = vi.fn();
    broken = true;
    act(() =>
      root.render(
        <ErrorBoundary name="The Inspector" onError={onError}>
          <Panel />
        </ErrorBoundary>,
      ),
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ message: "no such layer" });
    expect(onError.mock.calls[0]![1]).toContain("Panel");

    tryAgain();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("gives a custom fallback the error and a way to try again", () => {
    const seen: BoundaryProblem[] = [];
    const fallback = (problem: BoundaryProblem) => {
      seen.push(problem);
      return (
        <button className="again" onClick={problem.retry}>
          {String((problem.error as Error).message)}
        </button>
      );
    };
    broken = true;
    act(() =>
      root.render(
        <ErrorBoundary name="The Inspector" fallback={fallback}>
          <Panel />
        </ErrorBoundary>,
      ),
    );
    expect(text(".again")).toBe("no such layer");
    expect(seen.at(-1)!.componentStack).toContain("Panel");

    broken = false;
    act(() => container.querySelector<HTMLButtonElement>(".again")!.click());
    expect(text(".panel")).toBe("Opacity");
  });

  it("stops at the nearest boundary", () => {
    const outer = vi.fn();
    broken = true;
    act(() =>
      root.render(
        <ErrorBoundary name="Sonobe" onError={outer}>
          <header className="toolbar">Toolbar</header>
          <ErrorBoundary name="The Inspector">
            <Panel />
          </ErrorBoundary>
        </ErrorBoundary>,
      ),
    );
    expect(text(".sb-empty__title")).toBe("The Inspector hit a problem");
    expect(text(".toolbar")).toBe("Toolbar");
    expect(outer).not.toHaveBeenCalled();
  });

  it("fails the boundary a test names, and only that one, until the test lets go", () => {
    act(() =>
      root.render(
        <>
          <ErrorBoundary name="The Inspector">
            <Panel />
          </ErrorBoundary>
          <ErrorBoundary name="Layers">
            <Panel label="Card" />
          </ErrorBoundary>
        </>,
      ),
    );
    act(() => failRender("The Inspector"));
    expect([...container.querySelectorAll(".sb-empty__title")].map((el) => el.textContent)).toEqual(["The Inspector hit a problem"]);
    expect(text(".panel")).toBe("Card");
    expect(lastBoundaryError()).toMatchObject({ message: "The Inspector was asked to fail (window.__sonobe.failRender)." });

    // Still tripped: Try again fails again.
    tryAgain();
    expect(text(".sb-empty__title")).toBe("The Inspector hit a problem");

    failRender("The Inspector", false);
    tryAgain();
    expect([...container.querySelectorAll(".panel")].map((el) => el.textContent)).toEqual(["Opacity", "Card"]);
  });
});
