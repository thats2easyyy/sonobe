/** Environment switches read by the desktop main process. */
export interface DesktopEnv {
  /** Dev server URL for the editor (SONOBE_DEV_URL), http(s) only. */
  devUrl: URL | null;
  /** SONOBE_MUTE=1: append Chromium's mute-audio switch. */
  mute: boolean;
  /** SONOBE_MCP_PORT: fixed MCP port; null picks a random free port. */
  mcpPort: number | null;
  /** SONOBE_MCP=0: don't start the MCP server. */
  mcpEnabled: boolean;
  /** SONOBE_HOME: overrides ~/.sonobe (where mcp.json lives). */
  home: string | null;
  /** SONOBE_USER_DATA: overrides Electron's userData directory. */
  userData: string | null;
  /** SONOBE_EDITOR_DIST: overrides the editor build directory. */
  editorDist: string | null;
  /** SONOBE_TEST=1: expose test hooks on globalThis in the main process. */
  testHooks: boolean;
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

/**
 * Project folders named on a command line (`sonobe "Checkout Flow.sonobe"`). Flags and the app
 * path are skipped; relative paths resolve against `cwd`.
 */
export function projectPathsFromArgv(argv: readonly string[], cwd: string): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    if (!arg || arg.startsWith("-")) continue;
    const trimmed = arg.replace(/[\\/]+$/, "");
    if (!trimmed.toLowerCase().endsWith(".sonobe")) continue;
    const resolved = /^([A-Za-z]:[\\/]|[\\/])/.test(trimmed) ? trimmed : `${cwd.replace(/[\\/]+$/, "")}/${trimmed}`;
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** Parse desktop env vars; invalid values are ignored with a warning. */
export function readDesktopEnv(env: Record<string, string | undefined>, warn: (msg: string) => void = () => undefined): DesktopEnv {
  let devUrl: URL | null = null;
  const rawDevUrl = nonEmpty(env.SONOBE_DEV_URL);
  if (rawDevUrl) {
    try {
      const url = new URL(rawDevUrl);
      if (url.protocol === "http:" || url.protocol === "https:") devUrl = url;
      else warn(`SONOBE_DEV_URL must be http(s); ignoring ${rawDevUrl}`);
    } catch {
      warn(`SONOBE_DEV_URL is not a valid URL; ignoring ${rawDevUrl}`);
    }
  }

  let mcpPort: number | null = null;
  const rawPort = nonEmpty(env.SONOBE_MCP_PORT);
  if (rawPort) {
    const n = Number(rawPort);
    if (Number.isInteger(n) && n > 0 && n < 65536) mcpPort = n;
    else warn(`SONOBE_MCP_PORT must be an integer in 1..65535; ignoring ${rawPort}`);
  }

  return {
    devUrl,
    mute: flag(env.SONOBE_MUTE),
    mcpPort,
    mcpEnabled: env.SONOBE_MCP !== "0" && env.SONOBE_MCP !== "false",
    home: nonEmpty(env.SONOBE_HOME),
    userData: nonEmpty(env.SONOBE_USER_DATA),
    editorDist: nonEmpty(env.SONOBE_EDITOR_DIST),
    testHooks: flag(env.SONOBE_TEST),
  };
}
