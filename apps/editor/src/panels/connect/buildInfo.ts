/**
 * Build-time facts for Connect Claude: whether this is a development build (a source checkout), the
 * checkout's path (read from the dev server's /@fs URL of the CLI entry), and the Claude Desktop
 * extension a checkout can build (integrations/claude-desktop/manifest.json).
 */

import { repoPathFromDevUrl } from "./connectInfo.ts";

const DESKTOP_MANIFEST = import.meta.glob("../../../../../integrations/claude-desktop/manifest.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** True in development builds, which run from a source checkout. */
export const IS_DEV_BUILD: boolean = import.meta.env.DEV;

/** What a checkout runs, from its root, to build and pack the Claude Desktop extension (integrations/claude-desktop/README.md). */
export const CLAUDE_DESKTOP_BUILD_COMMANDS = "node integrations/claude-desktop/build.ts\nnpx @anthropic-ai/mcpb pack integrations/claude-desktop/dist sonobe.mcpb";

export interface DesktopBundleInfo {
  name: string;
  /** Repo-relative folder with the bundle sources. */
  folder: string;
  /** Shell commands, run from the checkout's root, that build and pack the bundle. */
  buildCommands: string;
  /** The file the commands write. */
  file: string;
}

export interface DesktopBundleOptions {
  /** Default IS_DEV_BUILD. */
  dev?: boolean;
  /** Default: the manifest bundled at build time. */
  manifest?: string | null;
}

/**
 * The Claude Desktop extension a source checkout can build, or null. The app ships no `.mcpb`, so
 * production builds get null and lead with the hand-written config instead.
 */
export function claudeDesktopBundle(options: DesktopBundleOptions = {}): DesktopBundleInfo | null {
  if (!(options.dev ?? IS_DEV_BUILD)) return null;
  const text = options.manifest === undefined ? Object.values(DESKTOP_MANIFEST)[0] : options.manifest;
  if (text === undefined || text === null) return null;
  const base = { folder: "integrations/claude-desktop", buildCommands: CLAUDE_DESKTOP_BUILD_COMMANDS, file: "sonobe.mcpb" };
  try {
    const manifest = JSON.parse(text) as { display_name?: unknown; name?: unknown };
    const name = typeof manifest.display_name === "string" ? manifest.display_name : typeof manifest.name === "string" ? manifest.name : "Sonobe";
    return { name, ...base };
  } catch {
    return { name: "Sonobe", ...base };
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
