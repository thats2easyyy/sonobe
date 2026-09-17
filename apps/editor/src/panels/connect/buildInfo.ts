/**
 * Build-time facts for Connect Claude: whether this is a development build (a source checkout), the
 * checkout's path (read from the dev server's /@fs URL of the CLI entry), and whether the repo ships
 * a Claude Desktop extension (integrations/claude-desktop/manifest.json).
 */

import { repoPathFromDevUrl } from "./connectInfo.ts";

const DESKTOP_MANIFEST = import.meta.glob("../../../../../integrations/claude-desktop/manifest.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** True in development builds, which run from a source checkout. */
export const IS_DEV_BUILD: boolean = import.meta.env.DEV;

export interface DesktopBundleInfo {
  name: string;
  /** Repo-relative folder with the bundle sources. */
  folder: string;
}

/** The Claude Desktop extension this build ships, or null when the repo has none. */
export function claudeDesktopBundle(): DesktopBundleInfo | null {
  const text = Object.values(DESKTOP_MANIFEST)[0];
  if (text === undefined) return null;
  const folder = "integrations/claude-desktop";
  try {
    const manifest = JSON.parse(text) as { display_name?: unknown; name?: unknown };
    const name = typeof manifest.display_name === "string" ? manifest.display_name : typeof manifest.name === "string" ? manifest.name : "Sonobe";
    return { name, folder };
  } catch {
    return { name: "Sonobe", folder };
  }
}

let repoPath: Promise<string | null> | undefined;

/** The source checkout's root in development builds; null in production or when it can't be told. */
export function detectRepoPath(): Promise<string | null> {
  if (!import.meta.env.DEV) return Promise.resolve(null);
  repoPath ??= (async () => {
    const loaders = import.meta.glob("../../../../../packages/cli/src/main.ts", { query: "?url", import: "default" });
    const load = Object.values(loaders)[0];
    if (!load) return null;
    try {
      return repoPathFromDevUrl(String(await load()));
    } catch {
      return null;
    }
  })();
  return repoPath;
}
