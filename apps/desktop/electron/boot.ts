/**
 * The app's entry (package.json "main"): turns on Node's compile cache, then loads the main bundle. A module can't cache
 * itself, so this stays a few lines and main.cjs, which is everything else, loads from the cache (electron/compile-cache.ts).
 *
 * The data folder is worked out the way main.ts is about to set it (SONOBE_USER_DATA, else the app's name under appData),
 * without setting anything: the app's name and paths stay main.ts's.
 */

import { app } from "electron";
import { enableCompileCache } from "node:module";
import path from "node:path";
import { startCompileCache } from "./compile-cache.ts";
import { APP_NAME, launchEnvProblem, readDesktopEnv } from "./env.ts";

startCompileCache({
  enable: enableCompileCache,
  userData: readDesktopEnv(process.env).userData ?? path.join(app.getPath("appData"), APP_NAME),
  version: __SONOBE_VERSION__,
  packaged: app.isPackaged,
  exePath: process.execPath,
  appImage: process.env.APPIMAGE,
  launchProblem: launchEnvProblem(__SONOBE_LAUNCH_ENV__.split(",").filter(Boolean), process.env),
  warn: (message) => console.warn(`[sonobe] ${message}`),
});

// Not a literal, so esbuild leaves it to run here instead of bundling main into this file.
require(path.join(__dirname, "main.cjs"));
