/**
 * Error containment (ARCHITECTURE §9): a part of the editor that throws while it renders shows a
 * problem in its own place, and the rest keeps working. `ErrorBoundary` catches, `SurfaceProblem` is
 * what a failed part says, whether its code didn't load (`loadable`) or it threw. Boundaries don't
 * report: the root's error handlers do (`app/errorReports.ts`), so each failure is logged once.
 */

import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";

export interface BoundaryProblem {
  error: unknown;
  /** Where in the tree it was thrown; null until React has said. */
  componentStack: string | null;
  /** Render the children again. */
  retry: () => void;
}

export interface ErrorBoundaryProps {
  /** What the part is called, as a sentence starts: "The Inspector". Also the name the test hook's `failRender` takes. */
  name: string;
  children?: ReactNode;
  /** What to draw in place of the children. Default: a SurfaceProblem with Try again. A dialog returns null and closes in `onError`. */
  fallback?: (problem: BoundaryProblem) => ReactNode;
  /** A change clears the problem: the failure belonged to what this names (the selection, a dialog request). */
  resetKey?: unknown;
  /** Runs once per failure, after the fallback is on screen. */
  onError?: (error: unknown, componentStack: string) => void;
}

interface BoundaryState {
  failed: boolean;
  error: unknown;
  componentStack: string | null;
  /** The `resetKey` the problem belongs to. */
  resetKey: unknown;
}

const CLEAR = { failed: false, error: null, componentStack: null };

let lastCaught: unknown = null;

/** The error a boundary caught most recently. The last resort shows it when the recovery screen itself fails, since React then reports only that second error. */
export function lastBoundaryError(): unknown {
  return lastCaught;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, BoundaryState> {
  state: BoundaryState = { ...CLEAR, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    lastCaught = error;
    return { failed: true, error, componentStack: null };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { ...CLEAR, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    this.props.onError?.(error, componentStack);
  }

  retry = (): void => this.setState(CLEAR);

  render(): ReactNode {
    const { name, fallback, children } = this.props;
    if (this.state.failed) {
      const problem: BoundaryProblem = { error: this.state.error, componentStack: this.state.componentStack, retry: this.retry };
      return fallback ? fallback(problem) : <SurfaceProblem name={name} kind="render" onRetry={this.retry} />;
    }
    return (
      <>
        <Tripwire name={name} />
        {children}
      </>
    );
  }
}

export interface SurfaceProblemProps {
  /** As a sentence starts: "The patch editor". */
  name: string;
  /** "load": its code couldn't be fetched. "render": it threw while drawing. */
  kind: "load" | "render";
  /** Render it again. Only a render problem can: the browser keeps a failed import for the life of the page. */
  onRetry?: () => void;
}

/** What a failed part of the editor says in its own place. */
export function SurfaceProblem({ name, kind, onRetry }: SurfaceProblemProps) {
  if (kind === "load") return <EmptyState className="sb-surface-problem" role="alert" size="sm" variant="inline" title={`${name} didn't load`} description="Restart Sonobe to try again." />;
  return (
    <EmptyState
      className="sb-surface-problem"
      role="alert"
      size="sm"
      variant="inline"
      title={`${name} hit a problem`}
      description="The rest of Sonobe still works."
      actions={
        onRetry && (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

// The tripwire, for tests: `failRender(name)` makes the boundary with that name catch an error on its
// next render, the way a broken component inside it would. Nothing in the app calls it; the test hook
// (`window.__sonobe.failRender`) does.
const tripped = new Set<string>();
const tripListeners = new Set<() => void>();

const subscribeTrips = (listener: () => void) => {
  tripListeners.add(listener);
  return () => {
    tripListeners.delete(listener);
  };
};

/** Make the boundary called `name` fail (or, with `on` false, stop failing: its Try again then brings it back). */
export function failRender(name: string, on = true): void {
  if (on === tripped.has(name)) return;
  if (on) tripped.add(name);
  else tripped.delete(name);
  for (const listener of [...tripListeners]) listener();
}

function Tripwire({ name }: { name: string }) {
  const snapshot = () => tripped.has(name);
  if (useSyncExternalStore(subscribeTrips, snapshot, snapshot)) throw new Error(`${name} was asked to fail (window.__sonobe.failRender).`);
  return null;
}
