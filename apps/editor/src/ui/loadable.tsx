/**
 * Components whose code loads on demand, without Suspense.
 *
 * `React.lazy` suspends, and React holds suspended content back until 300 ms after it last showed a
 * fallback, however soon the code arrived; a boundary shared by several surfaces also hides the ones
 * on screen while another loads. A loadable never suspends: it renders its component once the code
 * is in and its `fallback` until then, so code that takes 20 ms shows in 20 ms and each surface waits
 * alone. `preload()` starts the load before the surface is asked for.
 *
 * A loadable also contains what it loads (`ErrorBoundary.tsx`). A surface with a `fallback` says in
 * place that it didn't load or hit a problem; one without (a dialog) says it in a toast and calls
 * `onFailed`, so its caller closes it. Either way a failed load is raised as an error on `window`,
 * so it is reported like any other of the editor's.
 */

import { createElement, useEffect, useSyncExternalStore, type Attributes, type ComponentType, type ReactNode } from "react";
import { DialogBoundary, ErrorBoundary, SurfaceProblem } from "./ErrorBoundary.tsx";
import { useLatest } from "./lib/hooks.ts";
import { toast } from "./Toast.tsx";

export interface LoadableProps {
  /** Shown while the code loads. A surface with one also says so in place when its code can't load or it throws while drawing. Default: nothing. */
  fallback?: ReactNode;
  /** The code couldn't load, or the surface threw while drawing. A dialog closes its open state here. */
  onFailed?: () => void;
}

export type Loadable<P> = ((props: P & LoadableProps) => ReactNode) & {
  /** Start loading the code now. Resolves once it's in or has failed, and never rejects. */
  preload(): Promise<void>;
};

export interface LoadableOptions {
  /** What the surface is called in the message when it fails, as a sentence starts: "The patch editor". */
  name: string;
}

type LoadState<P> = { status: "loading" | "failed" } | { status: "ready"; Component: ComponentType<P> };

export function loadable<P extends object>(load: () => Promise<ComponentType<P>>, options: LoadableOptions): Loadable<P> {
  let state: LoadState<P> = { status: "loading" };
  let started: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: LoadState<P>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const snapshot = () => state;

  const preload = (): Promise<void> =>
    (started ??= new Promise<ComponentType<P>>((resolve) => resolve(load())).then(
      (Component) => set({ status: "ready", Component }),
      (error: unknown) => {
        // Raised on `window`, where the editor's error reporting listens (`app/errorReports.ts`): the HUD console gets its
        // line and Copy details lists it, as for a surface that threw. The browser prints it too.
        const problem = new Error(`${options.name} didn't load. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        if (typeof reportError === "function") reportError(problem);
        else console.error(problem);
        set({ status: "failed" });
      },
    ));

  function Surface({ fallback, onFailed, ...props }: P & LoadableProps) {
    const current = useSyncExternalStore(subscribe, snapshot, snapshot);
    const inline = fallback !== undefined;
    const latest = useLatest({ inline, onFailed });

    useEffect(() => {
      if (state.status === "ready") return;
      let mounted = true;
      void preload().then(() => {
        if (!mounted || state.status !== "failed") return;
        // A surface with a fallback says it in place; a dialog has nowhere to, so it says it in a toast and closes.
        // The browser keeps a failed import for the life of the page, so asking again from here can't work.
        if (!latest.current.inline) toast({ id: `loadable:${options.name}`, title: `${options.name} didn't load`, description: "Restart Sonobe to try again.", tone: "warn" });
        latest.current.onFailed?.();
      });
      return () => {
        mounted = false;
      };
    }, [latest]);

    if (current.status === "ready") {
      const surface = createElement(current.Component, props as unknown as P & Attributes);
      if (inline) return <ErrorBoundary name={options.name}>{surface}</ErrorBoundary>;
      return (
        <DialogBoundary name={options.name} {...(onFailed ? { onFailed } : {})}>
          {surface}
        </DialogBoundary>
      );
    }
    if (current.status === "failed" && inline) return <SurfaceProblem name={options.name} kind="load" />;
    return fallback ?? null;
  }

  return Object.assign(Surface, { preload });
}
