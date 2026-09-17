/** About Sonobe: version, the open-source work it's built on, and where to report an issue. */

export const APP_NAME = "Sonobe";

/** Editor version (apps/editor/package.json). The desktop app reports its own through sonobeHost.version. */
export const EDITOR_VERSION = "0.1.0";

export interface Credit {
  name: string;
  /** What Sonobe uses it for. */
  role: string;
  license: string;
  url: string;
}

/** Open-source software Sonobe ships with or reimplements formulas from. */
export const CREDITS: readonly Credit[] = [
  { name: "React and React DOM", role: "The editor interface", license: "MIT", url: "https://react.dev" },
  { name: "React Flow (@xyflow/react)", role: "The patch editor canvas", license: "MIT", url: "https://reactflow.dev" },
  { name: "d3-zoom and d3-selection", role: "Panning and zooming the patch editor", license: "ISC", url: "https://d3js.org" },
  { name: "elkjs", role: "Tidy Up graph layout", license: "EPL-2.0", url: "https://github.com/kieler/elkjs" },
  { name: "lottie-web", role: "Lottie animation layers", license: "MIT", url: "https://github.com/airbnb/lottie-web" },
  { name: "Zod", role: "Validating project files", license: "MIT", url: "https://zod.dev" },
  { name: "Zustand", role: "Editor state", license: "MIT", url: "https://github.com/pmndrs/zustand" },
  { name: "Lucide", role: "Icons", license: "ISC", url: "https://lucide.dev" },
  { name: "Motion", role: "Interface animation", license: "MIT", url: "https://motion.dev" },
  { name: "node-qrcode", role: "Preview on Phone QR codes", license: "MIT", url: "https://github.com/soldair/node-qrcode" },
  { name: "Electron", role: "The desktop app", license: "MIT", url: "https://www.electronjs.org" },
  { name: "Model Context Protocol SDK", role: "Connecting Claude over MCP", license: "MIT", url: "https://modelcontextprotocol.io" },
  { name: "Rebound", role: "Spring conversion formulas (reimplemented)", license: "BSD", url: "https://github.com/facebookarchive/rebound-js" },
];

/** Where issues are filed. */
export const ISSUES_URL = "https://github.com/thats2easyyy/sonobe/issues/new";

export interface IssueContext {
  version: string;
  platform: string;
  /** "desktop" or "browser". */
  host: string;
  userAgent?: string;
}

/** A new-issue link with the environment filled in. */
export function issueUrl(context: IssueContext, base: string = ISSUES_URL): string {
  const body = [
    "**What happened?**",
    "",
    "",
    "**What did you expect?**",
    "",
    "",
    "**Steps to reproduce**",
    "1. ",
    "",
    "---",
    `Sonobe ${context.version} · ${context.host} · ${context.platform}${context.userAgent ? ` · ${context.userAgent}` : ""}`,
  ].join("\n");
  return `${base}?body=${encodeURIComponent(body)}`;
}
