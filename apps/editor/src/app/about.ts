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
  /** An error to file under "What happened?" (the recovery screen's Report an Issue). */
  error?: string;
}

/** "Sonobe 0.1.0 · desktop · mac · <user agent>": the line a report ends with. */
export function environmentLine(context: IssueContext): string {
  return `Sonobe ${context.version} · ${context.host} · ${context.platform}${context.userAgent ? ` · ${context.userAgent}` : ""}`;
}

/** The longest error text a new-issue link carries, and the longest link: the desktop app refuses to open one over 8,192 characters. */
const ISSUE_ERROR_LIMIT = 1500;
const ISSUE_URL_LIMIT = 6000;

/** A new-issue link with the environment filled in, and the error when there is one, cut so the link stays short enough to open. */
export function issueUrl(context: IssueContext, base: string = ISSUES_URL): string {
  const link = (error: string) => {
    const body = ["**What happened?**", "", ...(error ? ["```", error, "```"] : []), "", "**What did you expect?**", "", "", "**Steps to reproduce**", "1. ", "", "---", environmentLine(context)].join("\n");
    return `${base}?body=${encodeURIComponent(body)}`;
  };
  // A cut can land inside a surrogate pair, which encodeURIComponent refuses.
  const cut = (text: string, length: number) => text.slice(0, length).replace(/[\uD800-\uDBFF]$/, "");
  let error = cut(context.error?.trim() ?? "", ISSUE_ERROR_LIMIT);
  let url = link(error);
  // Encoding makes a newline, a slash or a non-Latin character three to nine times longer.
  while (url.length > ISSUE_URL_LIMIT && error) {
    error = cut(error, Math.floor(error.length * 0.8));
    url = link(error);
  }
  return url;
}
