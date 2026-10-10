/**
 * Components whose code loads on demand, without Suspense.
 *
 * `React.lazy` suspends, and React holds suspended content back until 300 ms after it last showed a
 * fallback, however soon the code arrived; a boundary shared by several surfaces also hides the ones
 * on screen while another loads. A loadable never suspends: it renders its component once the code
 * is in and its `fallback` until then, so code that takes 20 ms shows in 20 ms and each surface waits
 * alone. `preload()` starts the load before the surface is asked for.
 */

import { createElement, useEffect, useSyncExternalStore, type Attributes, type ComponentType, type ReactNode } from "react";
import { EmptyState } from "./EmptyState.tsx";
import { useLatest } from "./lib/hooks.ts";
import { toast } from "./Toast.tsx";

export interface LoadableProps {
  /** Shown while the code loads. A surface with one also says so in place when its code can't load. Default: nothing. */
  fallback?: ReactNode;
  /** The code couldn't load. A dialog closes its open state here. */
  onLoadError?: () => void;
}

export type Loadable<P> = ((props: P & LoadableProps) => ReactNode) & {
  /** Start loading the code now. Resolves once it's in or has failed, and never rejects. */
  preload(): Promise<void>;
};

export interface LoadableOptions {
  /** What the surface is called in the message when it can't load, as a sentence starts: "The patch editor". */
  name: string;
}

type LoadState<P> = { status: "loading" | "failed" } | { status: "ready"; Component: ComponentType<P> };

/** The browser keeps a failed import for the life of the page, so asking again from here can't work. */
const FAILED_HINT = "Restart Sonobe to try again.";

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
        console.error(`${options.name} didn't load.`, error);
        set({ status: "failed" });
      },
    ));

  function Surface({ fallback, onLoadError, ...props }: P & LoadableProps) {
    const current = useSyncExternalStore(subscribe, snapshot, snapshot);
    const latest = useLatest({ inline: fallback !== undefined, onLoadError });

    useEffect(() => {
      if (state.status === "ready") return;
      let mounted = true;
      void preload().then(() => {
        if (!mounted || state.status !== "failed") return;
        // A surface with a fallback says it in place; a dialog has nowhere to, so it says it in a toast and closes.
        if (!latest.current.inline) toast({ id: `loadable:${options.name}`, title: `${options.name} didn't load`, description: FAILED_HINT, tone: "warn" });
        latest.current.onLoadError?.();
      });
      return () => {
        mounted = false;
      };
    }, [latest]);

    if (current.status === "ready") return createElement(current.Component, props as unknown as P & Attributes);
    if (current.status === "failed" && fallback !== undefined) return <EmptyState size="sm" variant="inline" title={`${options.name} didn't load`} description={FAILED_HINT} />;
    return fallback ?? null;
  }

  return Object.assign(Surface, { preload });
}
