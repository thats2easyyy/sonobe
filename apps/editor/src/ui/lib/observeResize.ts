/**
 * A ResizeObserver that calls back at most once per animation frame. A handler that sets React state
 * straight from the observer callback can resize what's being observed within the same frame, and
 * the browser then reports "ResizeObserver loop completed with undelivered notifications" (Vite's
 * dev overlay shows it as an error). Deferring to the next frame breaks that loop and coalesces
 * bursts such as a splitter drag or a drawer docking.
 */

export interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export type ResizeObserverConstructor = new (callback: () => void) => ResizeObserverLike;

export interface ObserveResizeOptions {
  /** Default: requestAnimationFrame (setTimeout where there's none). */
  requestFrame?: (callback: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
  /** Default: the global ResizeObserver. Without one, nothing is observed. */
  Observer?: ResizeObserverConstructor;
}

const defaultRequestFrame = (callback: () => void): unknown => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : setTimeout(callback, 16));

const defaultCancelFrame = (handle: unknown): void => {
  if (typeof cancelAnimationFrame === "function" && typeof handle === "number") cancelAnimationFrame(handle);
  else clearTimeout(handle as ReturnType<typeof setTimeout>);
};

/** Observe elements and call `onResize` on the frame after they change size. Returns disconnect. */
export function observeResize(targets: readonly (Element | null | undefined)[], onResize: () => void, options: ObserveResizeOptions = {}): () => void {
  const Observer = options.Observer ?? (typeof ResizeObserver === "undefined" ? undefined : (ResizeObserver as unknown as ResizeObserverConstructor));
  const elements = targets.filter((el): el is Element => !!el);
  if (!Observer || elements.length === 0) return () => undefined;
  const requestFrame = options.requestFrame ?? defaultRequestFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  let pending: unknown = null;
  let disposed = false;
  const observer = new Observer(() => {
    if (disposed || pending !== null) return;
    pending = requestFrame(() => {
      pending = null;
      if (!disposed) onResize();
    });
  });
  for (const el of elements) observer.observe(el);
  return () => {
    disposed = true;
    observer.disconnect();
    if (pending !== null) cancelFrame(pending);
    pending = null;
  };
}
