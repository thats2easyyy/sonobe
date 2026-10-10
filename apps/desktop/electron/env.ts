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
  /** SONOBE_LAN=1: start the phone preview server at launch. */
  lan: boolean;
  /** SONOBE_LAN_PORT: fixed phone preview port; null picks a free port. */
  lanPort: number | null;
  /** SONOBE_UPDATES=off: never check for a new version, whatever else is set. */
  updates: boolean;
  /** SONOBE_UPDATE_FEED: a generic update feed to read instead of the release feed (http(s) only), for rehearsals. */
  updateFeed: URL | null;
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

/**
 * Why a build made with `package.mjs --launch-env` must not run, or null. Such a build is for the update
 * rehearsal (tests/update-rehearsal.mjs), which gives it a data folder of its own through those variables.
 * macOS relaunches an updated app without the environment it was started with, so the build carries them
 * in Info.plist; if they still aren't there, it stops rather than use the person's real Sonobe data.
 */
export function launchEnvProblem(required: readonly string[], env: Record<string, string | undefined>): string | null {
  const missing = required.filter((name) => !nonEmpty(env[name]));
  if (!missing.length) return null;
  return `This is a rehearsal build of Sonobe: it only runs with ${required.join(", ")} set, and ${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"}. Start it with node apps/desktop/tests/update-rehearsal.mjs, which sets them, or build a normal app with npm run package -w @sonobe/desktop.`;
}

/** An http(s) URL from a switch, or null with a warning. */
function httpUrl(name: string, raw: string | null, warn: (msg: string) => void): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
    warn(`${name} must be http(s); ignoring ${raw}`);
  } catch {
    warn(`${name} is not a valid URL; ignoring ${raw}`);
  }
  return null;
}

/** Parse desktop env vars; invalid values are ignored with a warning. */
export function readDesktopEnv(env: Record<string, string | undefined>, warn: (msg: string) => void = () => undefined): DesktopEnv {
  const devUrl = httpUrl("SONOBE_DEV_URL", nonEmpty(env.SONOBE_DEV_URL), warn);

  let mcpPort: number | null = null;
  const rawPort = nonEmpty(env.SONOBE_MCP_PORT);
  if (rawPort) {
    const n = Number(rawPort);
    if (Number.isInteger(n) && n > 0 && n < 65536) mcpPort = n;
    else warn(`SONOBE_MCP_PORT must be an integer in 1..65535; ignoring ${rawPort}`);
  }

  let lanPort: number | null = null;
  const rawLanPort = nonEmpty(env.SONOBE_LAN_PORT);
  if (rawLanPort) {
    const n = Number(rawLanPort);
    if (Number.isInteger(n) && n > 0 && n < 65536) lanPort = n;
    else warn(`SONOBE_LAN_PORT must be an integer in 1..65535; ignoring ${rawLanPort}`);
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
    lan: flag(env.SONOBE_LAN),
    lanPort,
    updates: !["off", "0", "false"].includes(env.SONOBE_UPDATES?.trim().toLowerCase() ?? ""),
    updateFeed: httpUrl("SONOBE_UPDATE_FEED", nonEmpty(env.SONOBE_UPDATE_FEED), warn),
  };
}
