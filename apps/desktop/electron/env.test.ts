import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { projectPathsFromArgv, readDesktopEnv } from "./env.ts";
import { placeholderHtml, toDataUrl } from "./placeholder.ts";
import { isAppUrl, isExternalUrl } from "./security.ts";

describe("readDesktopEnv", () => {
  it("defaults to production behavior", () => {
    expect(readDesktopEnv({})).toEqual({ devUrl: null, mute: false, mcpPort: null, mcpEnabled: true, home: null, userData: null, editorDist: null, testHooks: false, lan: false, lanPort: null });
  });

  it("parses switches", () => {
    const env = readDesktopEnv({ SONOBE_DEV_URL: "http://localhost:5199", SONOBE_MUTE: "1", SONOBE_MCP_PORT: "47821", SONOBE_MCP: "0", SONOBE_HOME: " /tmp/h ", SONOBE_TEST: "true", SONOBE_LAN: "1", SONOBE_LAN_PORT: "8765" });
    expect(env.devUrl?.origin).toBe("http://localhost:5199");
    expect(env).toMatchObject({ mute: true, mcpPort: 47821, mcpEnabled: false, home: "/tmp/h", testHooks: true, lan: true, lanPort: 8765 });
  });

  it("warns and ignores invalid values", () => {
    const warn = vi.fn();
    const env = readDesktopEnv({ SONOBE_DEV_URL: "javascript:alert(1)", SONOBE_MCP_PORT: "99999", SONOBE_LAN_PORT: "phone" }, warn);
    expect(env.devUrl).toBeNull();
    expect(env.mcpPort).toBeNull();
    expect(env.lanPort).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("projectPathsFromArgv", () => {
  it("picks *.sonobe arguments and resolves relative ones", () => {
    const argv = ["/Applications/Sonobe.app/Contents/MacOS/Sonobe", "--mute-audio", "Checkout Flow.sonobe/", "/Users/me/Tabs.sonobe", "notes.txt", "/Users/me/Tabs.sonobe"];
    expect(projectPathsFromArgv(argv, "/Users/me/work")).toEqual(["/Users/me/work/Checkout Flow.sonobe", "/Users/me/Tabs.sonobe"]);
    expect(projectPathsFromArgv(["C:\\Work\\Tabs.sonobe"], "D:\\")).toEqual(["C:\\Work\\Tabs.sonobe"]);
  });
});

describe("isAppUrl", () => {
  const root = path.resolve("/opt/sonobe/editor");

  it("allows only files inside the editor build", () => {
    const content = { kind: "file" as const, root };
    expect(isAppUrl(pathToFileURL(path.join(root, "index.html")).href, content)).toBe(true);
    expect(isAppUrl(`${pathToFileURL(path.join(root, "index.html")).href}#/patch`, content)).toBe(true);
    expect(isAppUrl(pathToFileURL("/etc/passwd").href, content)).toBe(false);
    expect(isAppUrl(pathToFileURL(`${root}-evil/index.html`).href, content)).toBe(false);
    expect(isAppUrl("https://example.com", content)).toBe(false);
  });

  it("allows the dev server origin and placeholder data URLs", () => {
    expect(isAppUrl("http://localhost:5199/src/main.tsx", { kind: "dev", origin: "http://localhost:5199" })).toBe(true);
    expect(isAppUrl("http://localhost:5200/", { kind: "dev", origin: "http://localhost:5199" })).toBe(false);
    expect(isAppUrl("data:text/html;base64,AAAA", { kind: "placeholder" })).toBe(true);
    expect(isAppUrl("https://example.com", { kind: "placeholder" })).toBe(false);
    expect(isAppUrl("not a url", { kind: "placeholder" })).toBe(false);
  });

  it("recognizes external links", () => {
    expect(isExternalUrl("https://github.com/")).toBe(true);
    expect(isExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("placeholderHtml", () => {
  it("tells people how to build the editor", () => {
    const html = placeholderHtml({ kind: "missing-editor", editorIndex: "/repo/apps/editor/dist/index.html" });
    expect(html).toContain("npm run build -w @sonobe/editor");
    expect(html).toContain("Content-Security-Policy");
    expect(toDataUrl(html)).toMatch(/^data:text\/html;charset=utf-8;base64,/);
  });

  it("escapes interpolated values", () => {
    const html = placeholderHtml({ kind: "dev-server-unreachable", url: "http://localhost:5199/<script>", error: "ERR_CONNECTION_REFUSED" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("npm run dev");
  });
});
