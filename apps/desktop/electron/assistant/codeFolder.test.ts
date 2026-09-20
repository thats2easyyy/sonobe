import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODE_TOOL_NAMES, CodeFolderError, createCodeFolderStore, createCodeTools, MAX_CODE_FOLDER_LINKS, type CodeFolderKey, type CodeFolderStore } from "./codeFolder.ts";
import { toAnthropicTools, type LocalTools, type LocalToolScope, type ToolCallResult } from "./toolBridge.ts";

let dir: string;
let home: string;
let app: string;
let file: string;

const windowKey: CodeFolderKey = { projectPath: null, windowId: "1" };
const posix = process.platform !== "win32";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-code-"));
  home = path.join(dir, "home");
  app = path.join(home, "code", "placemark");
  file = path.join(dir, "userData", "assistant-code-folders.json");
  await mkdir(app, { recursive: true });
});
afterEach(async () => {
  await chmod(path.join(app, "locked"), 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string, content: string | Uint8Array, root = app): Promise<void> {
  const target = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

const scope = (over: Partial<LocalToolScope> = {}): LocalToolScope => ({ conversationId: "1", runId: "run-1", projectPath: null, signal: new AbortController().signal, ...over });
const text = (result: ToolCallResult) => result.content.map((block) => block.text ?? "").join("\n");

async function linkedTools(options?: Parameters<typeof createCodeTools>[1]): Promise<{ store: CodeFolderStore; tools: LocalTools }> {
  const store = createCodeFolderStore({ file, home });
  await store.link(windowKey, app);
  return { store, tools: createCodeTools(store, options) };
}

async function linkError(store: CodeFolderStore, folder: string): Promise<CodeFolderError> {
  try {
    await store.link(windowKey, folder);
  } catch (err) {
    if (err instanceof CodeFolderError) return err;
    throw err;
  }
  throw new Error(`Expected linking ${folder} to fail`);
}

describe("code folder store", () => {
  it("links a folder for the window and shows home as ~", async () => {
    const store = createCodeFolderStore({ file, home });
    expect(await store.status(windowKey)).toEqual({ linked: null, missing: false });
    expect(await store.link(windowKey, app)).toEqual({ linked: { name: "placemark", path: "~/code/placemark", persisted: false }, missing: false });
    expect(await store.get(windowKey)).toMatchObject({ name: "placemark", persisted: false });
    expect(await store.get({ projectPath: null, windowId: "2" })).toBeNull();
  });

  it("refuses /, home, a folder that contains home, and things that aren't folders", async () => {
    const store = createCodeFolderStore({ file, home });
    for (const folder of [path.parse(dir).root, home, path.dirname(home), dir]) {
      const err = await linkError(store, folder);
      expect(err.code, folder).toBe("too_broad");
      expect(err.message).toBe("Pick your app's folder, not your whole home folder.");
    }
    await put("README.md", "# placemark");
    for (const folder of [path.join(app, "README.md"), path.join(app, "nope"), "code/placemark", ""]) {
      const err = await linkError(store, folder);
      expect(err.code, folder).toBe("not_a_folder");
      expect(err.message).toBe("That isn't a folder.");
    }
    // A folder inside home is fine.
    expect((await store.link(windowKey, path.join(home, "code"))).linked?.path).toBe("~/code");
    expect((await store.link(windowKey, `${app}${path.sep}`)).linked?.name).toBe("placemark");
  });

  it.skipIf(!posix || process.getuid?.() === 0)("refuses a folder it can't read", async () => {
    const locked = path.join(app, "locked");
    await mkdir(locked);
    await chmod(locked, 0o000);
    const err = await linkError(createCodeFolderStore({ file, home }), locked);
    expect(err.code).toBe("unreadable");
    expect(err.message).toBe("Sonobe can't read that folder. Check that your user account can open it.");
  });

  it("reads as missing once the folder is replaced or gone", async () => {
    const { store, tools } = await linkedTools();
    await rename(app, `${app}-old`);
    await mkdir(app);
    expect(await store.status(windowKey)).toEqual({ linked: { name: "placemark", path: "~/code/placemark", persisted: false }, missing: true });
    const result = await tools.call("list_code_files", {}, scope());
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("The linked folder “placemark” isn't where it was linked (~/code/placemark). Ask the person to link it again.");
    await rm(app, { recursive: true });
    expect((await store.status(windowKey)).missing).toBe(true);
  });

  it("keeps project links in a 0600 file across stores, and window links only in memory", async () => {
    const project = path.join(home, "Prototypes", "Checkout");
    const store = createCodeFolderStore({ file, home, now: () => 1234 });
    expect(await store.link({ projectPath: project, windowId: "1" }, app)).toEqual({ linked: { name: "placemark", path: "~/code/placemark", persisted: true }, missing: false });
    await store.link({ projectPath: null, windowId: "2" }, path.join(home, "code"));

    const saved = JSON.parse(await readFile(file, "utf8")) as { version: number; links: Record<string, Record<string, unknown>> };
    expect(saved.version).toBe(1);
    expect(Object.keys(saved.links)).toEqual([project]);
    expect(saved.links[project]).toEqual({ root: expect.stringMatching(/placemark$/), name: "placemark", dev: expect.any(Number), ino: expect.any(Number), linkedAt: 1234 });
    if (posix) expect((await stat(file)).mode & 0o777).toBe(0o600);

    const next = createCodeFolderStore({ file, home });
    expect(await next.get({ projectPath: project, windowId: "9" })).toMatchObject({ name: "placemark", persisted: true, linkedAt: 1234 });
    expect(await next.get({ projectPath: null, windowId: "2" })).toBeNull();
    expect(await store.get({ projectPath: null, windowId: "2" })).toMatchObject({ name: "code" });
    store.forgetWindow("2");
    expect(await store.get({ projectPath: null, windowId: "2" })).toBeNull();
  });

  it("keeps a window's link with the project once the prototype is saved", async () => {
    const store = createCodeFolderStore({ file, home });
    await store.link(windowKey, app);
    const project = path.join(home, "Prototypes", "Checkout");
    expect(await store.status({ projectPath: project, windowId: "1" })).toEqual({ linked: { name: "placemark", path: "~/code/placemark", persisted: true }, missing: false });
    expect(await createCodeFolderStore({ file, home }).get({ projectPath: project, windowId: "7" })).toMatchObject({ name: "placemark" });
  });

  it("unlinks the project's link and the window's", async () => {
    const project = path.join(home, "Prototypes", "Checkout");
    const store = createCodeFolderStore({ file, home });
    await store.link({ projectPath: project, windowId: "1" }, app);
    expect(await store.unlink({ projectPath: project, windowId: "1" })).toEqual({ linked: null, missing: false });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, links: {} });
    await store.link(windowKey, app);
    expect(await store.unlink(windowKey)).toEqual({ linked: null, missing: false });
  });

  it(`remembers at most ${MAX_CODE_FOLDER_LINKS} projects, dropping the oldest`, async () => {
    let clock = 0;
    const store = createCodeFolderStore({ file, home, now: () => ++clock });
    for (let i = 0; i < MAX_CODE_FOLDER_LINKS + 3; i++) await store.link({ projectPath: path.join(home, "p", `project-${String(i).padStart(3, "0")}`), windowId: "1" }, app);
    const saved = JSON.parse(await readFile(file, "utf8")) as { links: Record<string, unknown> };
    const names = Object.keys(saved.links).map((p) => path.basename(p));
    expect(names).toHaveLength(MAX_CODE_FOLDER_LINKS);
    expect(names).not.toContain("project-000");
    expect(names).not.toContain("project-002");
    expect(names).toContain("project-003");
  });
});

describe("code tools", () => {
  it("lists their names in a stable order with closed input schemas", async () => {
    const { tools } = await linkedTools();
    expect(tools.infos.map((info) => info.name)).toEqual([...CODE_TOOL_NAMES]);
    expect(tools.infos.map((info) => info.title)).toEqual(["List code files", "Search code", "Read code file"]);
    for (const info of tools.infos) {
      expect(info.readOnly).toBe(true);
      expect(info.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(tools.infos[1]!.inputSchema.required).toEqual(["query"]);
    expect(tools.infos[2]!.inputSchema.required).toEqual(["path"]);
    // The same bytes every time, so the cached prompt prefix holds.
    expect(JSON.stringify(toAnthropicTools(createCodeTools(createCodeFolderStore({ file, home })).infos))).toBe(JSON.stringify(toAnthropicTools(tools.infos)));
  });

  it("refuses fields a tool doesn't take, and values out of range, with teaching errors", async () => {
    const { tools } = await linkedTools();
    const unknown = await tools.call("list_code_files", { glob: "*.ts" }, scope());
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toBe('list_code_files has no field "glob".\nlist_code_files takes: path, pattern, maxResults.');
    expect(text(await tools.call("list_code_files", { max_results: 5 }, scope()))).toContain('Did you mean "maxResults"?');
    expect(text(await tools.call("list_code_files", { maxResults: 0 }, scope()))).toContain('list_code_files\'s "maxResults" must be a whole number from 1 to 400.');
    expect(text(await tools.call("search_code", { query: "a" }, scope()))).toContain('search_code\'s "query" must be text of 2 to 200 characters.');
    expect(text(await tools.call("read_code_file", {}, scope()))).toContain('read_code_file needs "path".');
    expect(text(await tools.call("read_code_file", { path: "x", offset: 0 }, scope()))).toContain('"offset" must be a whole number of 1 or more.');
    expect((await tools.call("delete_code", {}, scope())).isError).toBe(true);
  });

  it("says when no folder is linked", async () => {
    const tools = createCodeTools(createCodeFolderStore({ file, home }));
    const result = await tools.call("search_code", { query: "accentColor" }, scope());
    expect(result).toEqual({
      content: [{ type: "text", text: "No code folder is linked to this prototype. Ask the person to choose Match my code… in the Design with Claude box." }],
      isError: true,
    });
  });

  it("uses the project's link when the window has a saved prototype", async () => {
    const project = path.join(home, "Prototypes", "Checkout");
    const store = createCodeFolderStore({ file, home });
    await store.link({ projectPath: project, windowId: "5" }, app);
    await put("src/theme.ts", "export const accent = '#8B5CF6';\n");
    const tools = createCodeTools(store);
    expect((await tools.call("read_code_file", { path: "src/theme.ts" }, scope({ conversationId: "8" }))).isError).toBe(true);
    expect(text(await tools.call("read_code_file", { path: "src/theme.ts" }, scope({ conversationId: "8", projectPath: project })))).toBe("src/theme.ts (lines 1–1 of 1)\nexport const accent = '#8B5CF6';");
  });

  it("lists files breadth first, skipping hidden, dependency and build folders, and marks secret files", async () => {
    await put("package.json", "{}");
    await put("src/theme.ts", "export const accent = '#8B5CF6';\n");
    await put("src/ui/Colors.swift", "let accent = Color(.purple)\n");
    await put(".env", "API_KEY=sk-ant-api03-abcdefghijklmnop\n");
    await put(".env.local", "X=1\n");
    await put("id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n");
    await put(".eslintrc", "{}");
    await put(".git/config", "[core]");
    await put(".github/workflows/ci.yml", "on: push");
    await put("node_modules/react/index.js", "module.exports = {};");
    await put("dist/app.js", "x");
    await put("build/out.css", "x");
    await put("ios/Pods/Lib/a.swift", "x");
    const { tools } = await linkedTools();

    const all = await tools.call("list_code_files", {}, scope());
    expect(all.isError).toBeUndefined();
    expect(text(all)).toBe(
      [
        "(skipped: may hold secrets) .env",
        "(skipped: may hold secrets) .env.local",
        "(skipped: may hold secrets) id_rsa",
        "package.json  2 B",
        "src/theme.ts  33 B",
        "src/ui/Colors.swift  28 B",
      ].join("\n"),
    );
    expect(text(await tools.call("list_code_files", { pattern: "*.swift" }, scope()))).toBe("src/ui/Colors.swift  28 B");
    expect(text(await tools.call("list_code_files", { pattern: "**/*color*" }, scope()))).toBe("src/ui/Colors.swift  28 B");
    expect(text(await tools.call("list_code_files", { pattern: "*.{ts,json}" }, scope()))).toBe("package.json  2 B\nsrc/theme.ts  33 B");
    expect(text(await tools.call("list_code_files", { path: "src", pattern: "ui/*" }, scope()))).toBe("src/ui/Colors.swift  28 B");
    expect(text(await tools.call("list_code_files", { path: "src/ui" }, scope()))).toBe("src/ui/Colors.swift  28 B");
    expect(text(await tools.call("list_code_files", { pattern: "*.kt" }, scope()))).toBe("No files match “*.kt” in the linked folder.");
    expect(text(await tools.call("list_code_files", { maxResults: 2 }, scope()))).toBe(
      "(skipped: may hold secrets) .env\n(skipped: may hold secrets) .env.local\n(Showing the first 2 files. Narrow it with path or pattern to see the rest.)",
    );
  });

  it("refuses files that may hold secrets, and hidden ones", async () => {
    await put(".env", "API_KEY=abc\n");
    await put("id_rsa", "key\n");
    await put("config/credentials.json", "{}");
    await put("App/GoogleService-Info.plist", "<plist/>");
    await put(".ssh/config", "Host x");
    await put(".prettierrc", "{}");
    await put("src/theme.ts", "API_KEY usage\n");
    const { tools } = await linkedTools();

    const env = await tools.call("read_code_file", { path: ".env" }, scope());
    expect(env.isError).toBe(true);
    expect(text(env)).toBe("Sonobe doesn't read “.env”: files like it can hold secrets. Look for theme or token files instead.");
    expect(text(await tools.call("read_code_file", { path: "id_rsa" }, scope()))).toBe("Sonobe doesn't read “id_rsa”: files like it can hold secrets. Look for theme or token files instead.");
    for (const secret of ["config/credentials.json", "App/GoogleService-Info.plist", ".ssh/config", "./.env"]) {
      expect(text(await tools.call("read_code_file", { path: secret }, scope())), secret).toMatch(/^Sonobe doesn't read “[^”]+”: files like it can hold secrets/);
    }
    expect(text(await tools.call("read_code_file", { path: ".prettierrc" }, scope()))).toBe(
      "Sonobe doesn't read hidden files or folders like “.prettierrc”: they can hold secrets. Look for theme or token files instead.",
    );
    // Searching never reads them either.
    expect(text(await tools.call("search_code", { query: "API_KEY" }, scope()))).toBe("src/theme.ts:1: API_KEY usage");
  });

  it.skipIf(!posix)("follows links to files inside the folder only, and never walks into a linked folder", async () => {
    await put("src/theme.ts", "export const accent = '#8B5CF6';\n");
    await put("outside.txt", "outside\n", dir);
    await put("theme.ts", "sibling\n", `${app}-evil`);
    await symlink(path.join(app, "src", "theme.ts"), path.join(app, "theme-link.ts"));
    await symlink(path.join(dir, "outside.txt"), path.join(app, "outside-link.txt"));
    await symlink(path.join(`${app}-evil`, "theme.ts"), path.join(app, "evil.ts"));
    await symlink(path.join(app, ".env"), path.join(app, "config.ts"));
    await put(".env", "X=1\n");
    await symlink(path.join(app, "src"), path.join(app, "src-link"));
    await symlink(dir, path.join(app, "up"));
    const { tools } = await linkedTools();

    expect(text(await tools.call("read_code_file", { path: "theme-link.ts" }, scope()))).toBe("theme-link.ts (lines 1–1 of 1)\nexport const accent = '#8B5CF6';");
    for (const link of ["outside-link.txt", "evil.ts"]) {
      const result = await tools.call("read_code_file", { path: link }, scope());
      expect(result.isError, link).toBe(true);
      expect(text(result)).toBe(`“${link}” links to a place outside the linked folder, so Sonobe won't read it. Paths are relative to its top, like “src/theme.ts”.`);
    }
    expect(text(await tools.call("read_code_file", { path: "config.ts" }, scope()))).toBe("Sonobe doesn't read “.env”: files like it can hold secrets. Look for theme or token files instead.");

    const listed = text(await tools.call("list_code_files", {}, scope()));
    expect(listed.split("\n")).toEqual(["(skipped: may hold secrets) .env", "(skipped: may hold secrets) config.ts", "theme-link.ts  33 B", "src/theme.ts  33 B"]);
    expect(text(await tools.call("search_code", { query: "sibling" }, scope()))).toBe("No matches for “sibling” in the linked folder.");
    expect(text(await tools.call("search_code", { query: "outside" }, scope()))).toBe("No matches for “outside” in the linked folder.");
  });

  it("keeps paths inside the folder: ../, absolute paths, NUL, and a sibling folder with the same prefix", async () => {
    await put("theme.ts", "sibling\n", `${app}-evil`);
    const { tools } = await linkedTools();
    const refused = async (p: string) => {
      const result = await tools.call("read_code_file", { path: p }, scope());
      expect(result.isError, p).toBe(true);
      return text(result);
    };
    expect(await refused("../x")).toBe("“../x” is outside the linked folder. Paths are relative to its top, like “src/theme.ts”.");
    expect(await refused("/etc/hosts")).toBe("“/etc/hosts” is outside the linked folder. Paths are relative to its top, like “src/theme.ts”.");
    expect(await refused("src/../../x")).toContain("is outside the linked folder");
    expect(await refused("../placemark-evil/theme.ts")).toContain("is outside the linked folder");
    expect(await refused("~/code/placemark/x")).toContain("is outside the linked folder");
    expect(await refused("src/\0theme.ts")).toBe("That path has a NUL character in it. Paths are relative to the folder's top, like “src/theme.ts”.");
    expect(await refused("src\\theme.ts")).toContain("uses backslashes");
    expect(await refused("src/missing.ts")).toBe("There's no “src/missing.ts” in the linked folder. Find paths with list_code_files.");
    expect(await refused("")).toContain("read_code_file reads one file");
    expect(text(await tools.call("list_code_files", { path: "../placemark-evil" }, scope()))).toContain("is outside the linked folder");
  });

  it("reads lines with a header, continues from an offset, and says when a file is empty", async () => {
    await put("src/tokens.css", Array.from({ length: 10 }, (_, i) => `--space-${i + 1}: ${(i + 1) * 4}px;`).join("\n") + "\n");
    await put("src/empty.ts", "");
    await put("src/crlf.ts", "a\r\nb\r\n");
    const { tools } = await linkedTools();
    expect(text(await tools.call("read_code_file", { path: "src/tokens.css", limit: 3 }, scope()))).toBe(
      "src/tokens.css (lines 1–3 of 10)\n--space-1: 4px;\n--space-2: 8px;\n--space-3: 12px;\n(7 more lines: pass offset 4 to continue.)",
    );
    expect(text(await tools.call("read_code_file", { path: "src/tokens.css", offset: 9 }, scope()))).toBe("src/tokens.css (lines 9–10 of 10)\n--space-9: 36px;\n--space-10: 40px;");
    const past = await tools.call("read_code_file", { path: "src/tokens.css", offset: 11 }, scope());
    expect(past.isError).toBe(true);
    expect(text(past)).toBe("“src/tokens.css” has 10 lines, so there's nothing at line 11.");
    expect(text(await tools.call("read_code_file", { path: "src/empty.ts" }, scope()))).toBe("src/empty.ts (empty)");
    expect(text(await tools.call("read_code_file", { path: "src/crlf.ts" }, scope()))).toBe("src/crlf.ts (lines 1–2 of 2)\na\nb");
    expect(text(await tools.call("read_code_file", { path: "src" }, scope()))).toBe("“src” is a folder. List it with list_code_files.");
  });

  it("redacts API keys and private keys, keeping line numbers", async () => {
    const keys = [
      'const anthropic = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";',
      'const openai = "sk-abcdefghijklmnopqrstuvwxyz0123";',
      'const aws = "AKIAABCDEFGHIJKLMNOP";',
      'const github = "ghp_abcdefghijklmnopqrstuvwxyz0123";',
      'const slack = "xoxb-1234567890-abcdefghij";',
      'const google = "AIzaSyA1234567890abcdefghijklmnopqrstuv";',
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEAabcdefghijklmnopqrstuvwxyz0123456789",
      "-----END RSA PRIVATE KEY-----",
      "export const accent = '#8B5CF6';",
    ];
    await put("src/config.ts", `${keys.join("\n")}\n`);
    const { tools } = await linkedTools();
    const read = text(await tools.call("read_code_file", { path: "src/config.ts" }, scope()));
    expect(read).toBe(
      [
        "src/config.ts (lines 1–10 of 10)",
        'const anthropic = "[redacted]";',
        'const openai = "[redacted]";',
        'const aws = "[redacted]";',
        'const github = "[redacted]";',
        'const slack = "[redacted]";',
        'const google = "[redacted]";',
        "[redacted]",
        "[redacted]",
        "[redacted]",
        "export const accent = '#8B5CF6';",
      ].join("\n"),
    );
    // Search runs over the redacted text, so it can't be used to guess a key.
    expect(text(await tools.call("search_code", { query: "api03" }, scope()))).toBe("No matches for “api03” in the linked folder.");
    expect(text(await tools.call("search_code", { query: "accent" }, scope()))).toBe("src/config.ts:10: export const accent = '#8B5CF6';");
    // An unfinished private key block is redacted to the end.
    await put("src/half.pem.txt", "a\n-----BEGIN PRIVATE KEY-----\nMIIE\n");
    expect(text(await tools.call("read_code_file", { path: "src/half.pem.txt" }, scope()))).toBe("src/half.pem.txt (lines 1–3 of 3)\na\n[redacted]\n[redacted]");
  });

  it("refuses binaries and files over 2 MB, and search skips them", async () => {
    await put("assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
    await put("dist-big.txt", "a".repeat(2 * 1024 * 1024 + 1));
    await put("big.css", `${"a".repeat(1024 * 1024)}\n--accent: red;\n`);
    await put("src/theme.css", "--accent: #8B5CF6;\n");
    const { tools } = await linkedTools();
    const binary = await tools.call("read_code_file", { path: "assets/logo.png" }, scope());
    expect(binary.isError).toBe(true);
    expect(text(binary)).toBe("“assets/logo.png” isn't a text file.");
    const large = await tools.call("read_code_file", { path: "dist-big.txt" }, scope());
    expect(large.isError).toBe(true);
    expect(text(large)).toBe("“dist-big.txt” is over 2 MB, so Sonobe won't read it. Look for a smaller theme or token file.");
    expect(text(await tools.call("search_code", { query: "--accent" }, scope()))).toBe("src/theme.css:1: --accent: #8B5CF6;\n(Skipped 2 files over 1 MB.)");
    expect(text(await tools.call("search_code", { query: "PNG" }, scope()))).toContain("No matches");
  });

  it.skipIf(!posix || process.getuid?.() === 0)("skips a file it can't open in a search, and says why when asked to read it", async () => {
    await put("src/a-theme.css", "--accent: red;\n");
    await put("src/locked.css", "--accent: blue;\n");
    await put("src/z-theme.css", "--accent: green;\n");
    await chmod(path.join(app, "src", "locked.css"), 0o000);
    const { tools } = await linkedTools();
    expect(text(await tools.call("search_code", { query: "--accent" }, scope()))).toBe("src/a-theme.css:1: --accent: red;\nsrc/z-theme.css:1: --accent: green;");
    expect(text(await tools.call("read_code_file", { path: "src/locked.css" }, scope()))).toBe("Sonobe can't open “src/locked.css”: the person's user account can't read it.");
  });

  it("searches for the literal text, not a regex", async () => {
    await put("src/a.ts", "const x = 1;\nconst y = a.b;\nconst z = axb;\nfn(a.b) + (c)\n");
    await put("src/b.swift", "let a.b = 2\n");
    const { tools } = await linkedTools();
    expect(text(await tools.call("search_code", { query: "a.b" }, scope()))).toBe("src/a.ts:2: const y = a.b;\nsrc/a.ts:4: fn(a.b) + (c)\nsrc/b.swift:1: let a.b = 2");
    expect(text(await tools.call("search_code", { query: "(c)" }, scope()))).toBe("src/a.ts:4: fn(a.b) + (c)");
    expect(text(await tools.call("search_code", { query: "a.b", pattern: "*.swift" }, scope()))).toBe("src/b.swift:1: let a.b = 2");
    expect(text(await tools.call("search_code", { query: "a.b", path: "src/a.ts", maxResults: 1 }, scope()))).toBe(
      "src/a.ts:2: const y = a.b;\n(Showing the first 1 match. Narrow it with path or pattern to see the rest.)",
    );
    expect(text(await tools.call("search_code", { query: "A.B" }, scope()))).toBe("No matches for “A.B” in the linked folder.");
  });

  it("holds the per-call, per-reply and per-chat budgets, and forget resets the chat's", async () => {
    await put("src/long.ts", Array.from({ length: 400 }, (_, i) => `export const token${String(i).padStart(3, "0")} = "value";`).join("\n"));
    const { tools } = await linkedTools({ callChars: 500, replyChars: 1_200, chatChars: 2_000 });
    const read = (run: string, offset = 1) => tools.call("read_code_file", { path: "src/long.ts", offset }, scope({ runId: run }));

    const first = await read("run-1");
    expect(text(first).length).toBeLessThanOrEqual(500);
    expect(text(first)).toMatch(/^src\/long\.ts \(lines 1–\d+ of 400\)\n/);
    expect(text(first)).toMatch(/more lines: pass offset \d+ to continue\.\)$/);

    let replyTotal = text(first).length;
    let result: ToolCallResult;
    for (;;) {
      result = await read("run-1");
      if (result.isError) break;
      replyTotal += text(result).length;
    }
    expect(replyTotal).toBeLessThanOrEqual(1_200);
    expect(text(result)).toBe("This reply has read 1,200 characters from the code folder, its limit for one reply. Design with what you've read so far.");

    let chatTotal = replyTotal;
    for (let run = 2; ; run++) {
      result = await read(`run-${run}`);
      if (result.isError && text(result).startsWith("This chat")) break;
      if (!result.isError) chatTotal += text(result).length;
    }
    expect(chatTotal).toBeLessThanOrEqual(2_000);
    expect(text(result)).toBe("This chat has read 2,000 characters from the code folder, its limit. Start a new chat to read more.");
    // A new chat (forget) starts over.
    tools.forget("1");
    expect((await read("run-99")).isError).toBeUndefined();
  });

  it("cuts long listings to whole lines and says why", async () => {
    for (let i = 0; i < 60; i++) await put(`src/components/Component${String(i).padStart(2, "0")}.tsx`, "x");
    const { tools } = await linkedTools({ callChars: 400 });
    const listed = text(await tools.call("list_code_files", {}, scope()));
    expect(listed.length).toBeLessThanOrEqual(400);
    expect(listed.split("\n").at(-1)).toBe("(Cut at 400 characters. Narrow it with path or pattern.)");
    expect(listed.split("\n").slice(0, -1).every((line) => /^src\/components\/Component\d\d\.tsx {2}1 B$/.test(line))).toBe(true);
  });

  it("stops at the deadline and when the person presses Stop", async () => {
    for (let i = 0; i < 1_000; i++) await put(`src/f${i}.ts`, `export const v${i} = ${i};\n`);
    const { store } = await linkedTools();
    const slow = createCodeTools(store, { deadlineMs: 1 });
    const timedOut = await slow.call("search_code", { query: "nothing like this" }, scope());
    expect(timedOut).toEqual({ content: [{ type: "text", text: "Reading the code folder took too long, so it stopped. Ask for a narrower folder or pattern." }], isError: true });

    const tools = createCodeTools(store);
    const stop = new AbortController();
    stop.abort();
    const stopped = await tools.call("search_code", { query: "nothing like this" }, scope({ signal: stop.signal }));
    expect(stopped.isError).toBe(true);
    expect(text(stopped)).toBe("Stopped: the person pressed Stop, so the code folder wasn't read.");

    const midway = new AbortController();
    const running = tools.call("search_code", { query: "nothing like this" }, scope({ signal: midway.signal }));
    setTimeout(() => midway.abort(), 1);
    expect(text(await running)).toBe("Stopped: the person pressed Stop, so the code folder wasn't read.");
    // With time to finish, the same search goes through.
    expect((await tools.call("search_code", { query: "v999 =" }, scope())).content[0]!.text).toBe("src/f999.ts:1: export const v999 = 999;");
  });

  it(`stops walking after looking at 5,000 entries`, async () => {
    await mkdir(path.join(app, "many"));
    for (let batch = 0; batch < 5_010; batch += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 5_010 - batch) }, (_, i) => writeFile(path.join(app, "many", `f${String(batch + i).padStart(4, "0")}.txt`), "")));
    }
    const { tools } = await linkedTools({ deadlineMs: 30_000 });
    const listed = text(await tools.call("list_code_files", { pattern: "*.md" }, scope()));
    expect(listed).toBe("No files match “*.md” in the linked folder.\n(Stopped after looking at 5,000 entries. Narrow it with path or pattern.)");
  }, 30_000);
});
