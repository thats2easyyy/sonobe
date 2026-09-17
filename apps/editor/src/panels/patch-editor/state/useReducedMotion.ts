import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(cb) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
  return () => {
    mq.removeEventListener?.("change", cb);
    observer?.disconnect();
  };
}

function read(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.getAttribute("data-reduced-motion") === "true") return true;
  return !!window.matchMedia?.(QUERY).matches;
}

/** True when the OS or the app asks for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
