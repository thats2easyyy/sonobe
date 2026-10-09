/**
 * The `sonobe` and `sonobe.cmd` launchers scripts/build.mjs writes into dist/cli (Resources/cli in a packaged
 * app), as text, so a test can run the one for this platform. A launcher picks:
 *
 * - the entry: relay.mjs for exactly `sonobe mcp`, the stdio relay a Claude session keeps running, which is a
 *   few kilobytes; sonobe.mjs, the whole CLI, for everything else (`mcp --headless`, `mcp --help` included)
 * - the runtime: SONOBE_NODE when set, else the app's own (Electron in Node mode) when the launcher sits inside
 *   an installed Sonobe app, else `node` from PATH
 * - with the app's runtime and the whole CLI, Node's compile cache: NODE_COMPILE_CACHE is set to
 *   <SONOBE_HOME or ~/.sonobe>/compile-cache/cli-<version>, unless it is set already. The folder is per
 *   version, and the app removes the other versions' at launch (electron/compile-cache.ts).
 */

import { cliCompileCacheKey } from "../electron/compile-cache.ts";

/** `version` is the app's, which names the compile cache's folder. */
export function posixLauncher(version: string): string {
  return `#!/bin/sh
# Runs the bundled Sonobe CLI. Uses SONOBE_NODE when set, else the app's own runtime (Electron in
# Node mode) when this file is inside an installed Sonobe app, else \`node\` from PATH.
DIR="$(cd "$(dirname "$0")" && pwd)"
# \`sonobe mcp\` alone is the relay a Claude session keeps running: relay.mjs holds it and nothing else.
ENTRY=sonobe.mjs
if [ "$#" -eq 1 ] && [ "$1" = "mcp" ]; then
  ENTRY=relay.mjs
fi
# Headless imports draw SF Symbols with the app's helper (Resources/bin/sfsymbol on a Mac).
if [ -z "$SONOBE_SFSYMBOL" ] && [ -x "$DIR/../bin/sfsymbol" ]; then
  SONOBE_SFSYMBOL="$DIR/../bin/sfsymbol"
  export SONOBE_SFSYMBOL
fi
if [ -n "$SONOBE_NODE" ]; then
  exec "$SONOBE_NODE" "$DIR/$ENTRY" "$@"
fi
for APP_EXE in "$DIR/../../MacOS/Sonobe" "$DIR/../../sonobe"; do
  if [ -x "$APP_EXE" ] && [ ! -d "$APP_EXE" ]; then
    # Node's compile cache for the CLI's 9 MB, per version, in the person's Sonobe folder. The relay is too
    # small to need one, and under App Translocation this path is new on every launch, so each run would
    # miss and leave another entry.
    CACHE_HOME="\${SONOBE_HOME:-\${HOME:+$HOME/.sonobe}}"
    case "$DIR" in
      */AppTranslocation/*) CACHE_HOME= ;;
    esac
    if [ -z "$NODE_COMPILE_CACHE" ] && [ -n "$CACHE_HOME" ] && [ "$ENTRY" = sonobe.mjs ]; then
      NODE_COMPILE_CACHE="$CACHE_HOME/compile-cache/${cliCompileCacheKey(version)}"
      export NODE_COMPILE_CACHE
    fi
    ELECTRON_RUN_AS_NODE=1 exec "$APP_EXE" "$DIR/$ENTRY" "$@"
  fi
done
exec node "$DIR/$ENTRY" "$@"
`;
}

// A bare `exit /b` returns the CLI's exit code. `exit /b %ERRORLEVEL%` inside a parenthesized block
// wouldn't: cmd expands the variable when it reads the block, before the CLI has run. For the same reason
// everything a block reads is set before the block.
export function windowsLauncher(version: string): string {
  return [
    "@echo off",
    "rem Runs the bundled Sonobe CLI with the app's own runtime (Electron in Node mode), else node.",
    "setlocal",
    "rem `sonobe mcp` alone is the relay a Claude session keeps running: relay.mjs holds it and nothing else.",
    'set "ENTRY=sonobe.mjs"',
    'if "%~1"=="mcp" if "%~2"=="" set "ENTRY=relay.mjs"',
    "rem Node's compile cache for the whole CLI, per version, in the person's Sonobe folder, with the app's runtime.",
    'set "CACHE_HOME="',
    'if defined USERPROFILE set "CACHE_HOME=%USERPROFILE%\\.sonobe"',
    'if defined SONOBE_HOME set "CACHE_HOME=%SONOBE_HOME%"',
    'if defined NODE_COMPILE_CACHE set "CACHE_HOME="',
    'if "%ENTRY%"=="relay.mjs" set "CACHE_HOME="',
    "if defined SONOBE_NODE (",
    '  "%SONOBE_NODE%" "%~dp0%ENTRY%" %*',
    "  exit /b",
    ")",
    'if exist "%~dp0..\\..\\Sonobe.exe" (',
    "  set ELECTRON_RUN_AS_NODE=1",
    `  if defined CACHE_HOME set "NODE_COMPILE_CACHE=%CACHE_HOME%\\compile-cache\\${cliCompileCacheKey(version)}"`,
    '  "%~dp0..\\..\\Sonobe.exe" "%~dp0%ENTRY%" %*',
    "  exit /b",
    ")",
    'node "%~dp0%ENTRY%" %*',
    "",
  ].join("\r\n");
}
