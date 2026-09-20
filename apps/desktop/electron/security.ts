import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the renderer is allowed to live. */
export type AppContent =
  | { kind: "file"; /** Absolute path of the editor build directory. */ root: string }
  | { kind: "dev"; origin: string }
  | { kind: "placeholder" };

/** True for http(s) URLs that should open in the user's browser. */
export function isExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** True for mailto: links, which are also safe to hand to the OS. */
export function isMailtoUrl(raw: string): boolean {
  return raw.startsWith("mailto:");
}

/** Whether a URL belongs to the app's own content (navigation + IPC trust boundary). */
export function isAppUrl(raw: string, content: AppContent): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  switch (content.kind) {
    case "dev":
      return url.origin === content.origin;
    case "file": {
      if (url.protocol !== "file:") return false;
      let file: string;
      try {
        file = fileURLToPath(url);
      } catch {
        return false;
      }
      const rel = path.relative(content.root, file);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    }
    case "placeholder":
      return url.protocol === "data:";
  }
}

/**
 * Where a subframe of an editor window may navigate: only inline documents (the canvas's design
 * preview is a srcdoc frame). A sandboxed frame with scripts can still navigate itself, so anything
 * else is refused.
 */
export function isAllowedSubframeUrl(raw: string): boolean {
  return raw === "about:srcdoc" || raw === "about:blank" || raw.startsWith("about:blank#");
}

/** Permissions the renderer may request from Chromium. Everything else is denied. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-sanitized-write",
  "clipboard-read",
  "fullscreen",
  "pointerLock",
  "media",
]);
