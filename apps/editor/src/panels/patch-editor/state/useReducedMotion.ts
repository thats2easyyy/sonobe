import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(cb) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion", "data-reduced-motion"] });
  return () => {
    mq.removeEventListener?.("change", cb);
    observer?.disconnect();
  };
}

/**
 * Settings → Motion puts data-motion="reduce" or "full" on <html> (applyMotionPreference in
 * app/settings.ts), and "full" overrides the OS; the patch editor's dev page sets data-reduced-motion.
 */
function read(): boolean {
  if (typeof window === "undefined") return false;
  const root = document.documentElement;
  const motion = root.getAttribute("data-motion");
  if (motion === "reduce" || root.getAttribute("data-reduced-motion") === "true") return true;
  if (motion === "full") return false;
  return !!window.matchMedia?.(QUERY).matches;
}

/** True when the OS or the app asks for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
