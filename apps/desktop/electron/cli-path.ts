/** Where the app's bundled `sonobe` CLI launcher lives, for Connect Claude's copy-paste setup. */

import path from "node:path";

export interface BundledCliOptions {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** `process.resourcesPath`, where packaged builds keep `cli/` (electron-builder extraResources). */
  resourcesPath: string;
  /** The folder the main bundle runs from; development builds write `cli/` beside it. */
  mainDir: string;
  platform: string;
  exists: (file: string) => boolean;
}

/** The launcher's absolute path (`<cli>/sonobe`, or `sonobe.cmd` on Windows), or null when it isn't there. */
export function bundledCliPath(options: BundledCliOptions): string | null {
  const windows = options.platform === "win32";
  const join = windows ? path.win32.join : path.posix.join;
  const dir = options.packaged ? join(options.resourcesPath, "cli") : join(options.mainDir, "cli");
  const file = join(dir, windows ? "sonobe.cmd" : "sonobe");
  return options.exists(file) ? file : null;
}
