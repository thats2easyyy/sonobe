import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodeFolderStore, type CodeFolderKey } from "./assistant/codeFolder.ts";
import {
  buildHandoffScript,
  HANDOFF_NOT_MAC,
  HANDOFF_PROMPT_LIMIT,
  handoffFolder,
  handoffMcpConfig,
  MANAGED_MCP_CONFIG,
  MANAGED_WITHOUT_SONOBE,
  openInClaudeCode,
  readManagedMcp,
  shellQuote,
  type HandoffFolder,
  type HandoffOptions,
  type ManagedMcp,
} from "./claude-handoff.ts";

const posix = process.platform !== "win32";
const zsh = posix && existsSync("/bin/zsh");

/** Text a shell would read as something else if it weren't quoted exactly. */
const TRICKY = [
  "it's Tyler's app",
  'say "hi" and "bye"',
  "$HOME, ${PATH} and $(id)",
  "`id` in backticks",
  "back\\slash, \\n and \\\\",
  "line one\nline two\n",
  "!! and !event, which history would expand",
  "-p --dangerously-skip-permissions, a leading dash",
  "'",
  "''",
  "a'''b",
  "é, 😀 and “curly quotes”",
  "%s %n %d, like a printf format",
  "* ? [a] ~ {a,b}, like globs",
  "; rm -rf ~ && echo | > <",
];

const SERVER = { command: "/Applications/Sonobe.app/Contents/Resources/cli/sonobe", args: ["mcp"] };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-handoff-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("shellQuote", () => {
  it.skipIf(!posix)("quotes text that sh and zsh read back byte for byte", () => {
    const shells: [string, string[]][] = [["/bin/sh", ["-c"]], ...(zsh ? ([["/bin/zsh", ["-f", "-c"]], ["/bin/zsh", ["-f", "-o", "rcquotes", "-c"]]] as [string, string[]][]) : [])];
    for (const value of [...TRICKY, TRICKY.join("\n"), ""]) {
      for (const [shell, args] of shells) {
        expect(execFileSync(shell, [...args, `printf %s ${shellQuote(value)}`], { encoding: "utf8" }), `${shell} ${JSON.stringify(value)}`).toBe(value);
      }
    }
  });

  it("refuses NUL, which no argument can hold", () => {
    expect(() => shellQuote("a\0b")).toThrow("NUL");
    expect(() => buildHandoffScript({ folder: "/Users/me/app", prompt: "a\0b", mcpConfig: "{}" })).toThrow("NUL");
    expect(() => buildHandoffScript({ folder: "/Users/me/a\0pp", prompt: "a screen", mcpConfig: "{}" })).toThrow("NUL");
  });
});

describe("buildHandoffScript", () => {
  it("runs a login zsh that deletes itself, and always passes Sonobe's relay, then the prompt after --", () => {
    const script = buildHandoffScript({ folder: "/Users/me/code/noddit", display: "~/code/noddit", prompt: "Design a checkout", mcpConfig: handoffMcpConfig(SERVER) });
    expect(script.split("\n")).toEqual([
      "#!/bin/zsh -l",
      "# Sonobe's Open in Claude Code. It deletes itself as it starts.",
      'rm -f -- "$0"',
      "cd -- '/Users/me/code/noddit' || { print -r -- 'Sonobe couldn'\\''t open ~/code/noddit. Check that it'\\''s still there, then try Open in Claude Code again.'; exit 1; }",
      "if ! command -v claude >/dev/null 2>&1; then",
      "  print -r -- 'Claude Code isn'\\''t installed, or isn'\\''t on your PATH. Install it from https://claude.com/claude-code, then try Open in Claude Code again.'",
      "  exit 1",
      "fi",
      `exec claude --mcp-config '{"mcpServers":{"sonobe":{"command":"/Applications/Sonobe.app/Contents/Resources/cli/sonobe","args":["mcp"]}}}' -- 'Design a checkout'`,
      "",
    ]);
  });

  it("leaves the relay out under an organization's managed MCP config, and says first when it lists no sonobe", () => {
    const plain = { folder: "/Users/me/code/noddit", display: "~/code/noddit", prompt: "Design a checkout", mcpConfig: handoffMcpConfig(SERVER) };
    const lines = (managed: ManagedMcp) => buildHandoffScript({ ...plain, managed }).split("\n");
    const head = buildHandoffScript(plain).split("\n").slice(0, -2);
    expect(lines(null)).toEqual(buildHandoffScript(plain).split("\n"));
    expect(lines({ sonobe: true })).toEqual([...head, "exec claude -- 'Design a checkout'", ""]);
    expect(lines({ sonobe: false })).toEqual([...head, `print -r -- ${shellQuote(MANAGED_WITHOUT_SONOBE)}`, "exec claude -- 'Design a checkout'", ""]);
    expect(MANAGED_WITHOUT_SONOBE).toBe(
      "Your organization manages Claude Code's MCP servers (/Library/Application Support/ClaudeCode/managed-mcp.json), and Sonobe's isn't one of them, so this session can't reach your canvas. Ask your admin to add a server named sonobe that runs Sonobe's `sonobe mcp`, then try Open in Claude Code again.",
    );
  });

  it("adds Sonobe's relay for the session as an mcpServers entry", () => {
    expect(JSON.parse(handoffMcpConfig(SERVER))).toEqual({ mcpServers: { sonobe: SERVER } });
    expect(JSON.parse(handoffMcpConfig({ command: "/Users/me/My \"Apps\"/it's/sonobe", args: ["mcp"] })).mcpServers.sonobe.command).toBe("/Users/me/My \"Apps\"/it's/sonobe");
  });

  it.skipIf(!zsh)("writes a script zsh parses, whatever the prompt and folder", async () => {
    const file = path.join(dir, "check.command");
    for (const prompt of [...TRICKY, TRICKY.join("\n")]) {
      await writeFile(file, buildHandoffScript({ folder: `/Users/me/My App's "Folder" $x`, prompt, mcpConfig: handoffMcpConfig({ command: "/Users/me/it's/sonobe", args: ["mcp"] }) }));
      const parsed = spawnSync("/bin/zsh", ["-n", file], { encoding: "utf8" });
      expect(parsed.status, `${JSON.stringify(prompt)}: ${parsed.stderr}`).toBe(0);
    }
  });

  describe.skipIf(!zsh)("run for real, with a stand-in claude", () => {
    let folder: string;
    let bin: string;
    let out: string;
    const mcpConfig = handoffMcpConfig({ command: "/Users/me/it's \"here\"/sonobe", args: ["mcp"] });
    const PROMPTS = [
      `Redesign “Card”: it's "quoted", 'single' and ''`,
      "Keep $HOME, ${PATH}, $(id) and $1 as written",
      "Name it `id` and ``, in backticks",
      "Line one\nline two\n\nline four\n",
      `Redesign “Card”:\n${TRICKY.join("\n")}`,
    ];
    /** What `claude mcp get sonobe` prints (abridged) and exits with in Claude Code 2.1.278, for each place a sonobe server can come from. */
    const CONFIGURED = {
      none: { exit: 1, out: 'No MCP server named "sonobe". Run `claude mcp add` to add one.', mcpJson: false },
      user: { exit: 0, out: "sonobe:\n  Scope: User config (available in all your projects)\n  Status: ✓ Connected", mcpJson: false },
      local: { exit: 0, out: "sonobe:\n  Scope: Local config (private to you in this project)\n  Status: ✓ Connected", mcpJson: false },
      "the folder's .mcp.json, pending": { exit: 0, out: "sonobe:\n  Scope: Project config (shared via .mcp.json)\n  Status: ⏸ Pending approval (run `claude` to approve)", mcpJson: true },
      "the folder's .mcp.json, rejected": { exit: 0, out: "sonobe:\n  Scope: Project config (shared via .mcp.json)\n  Status: ✘ Rejected (see disabledMcpjsonServers in settings)", mcpJson: true },
    };

    beforeEach(async () => {
      folder = path.join(dir, `My App's "Folder" $HOME`);
      bin = path.join(dir, "bin");
      out = path.join(dir, "claude-calls");
      await mkdir(folder, { recursive: true });
      await mkdir(bin);
      // For every call, appends its argument count, working folder and arguments, NUL-separated.
      // `claude mcp …` answers like Claude Code would for $MCP_GET and $MCP_EXIT; anything else is a session, which this stand-in doesn't start.
      await writeFile(path.join(bin, "claude"), `#!/bin/sh\nprintf '%s\\0' "$#" "$(pwd -P)" "$@" >> "$OUT"\nif [ "$1" = mcp ]; then printf '%s\\n' "$MCP_GET"; exit "$MCP_EXIT"; fi\n`);
      await chmod(path.join(bin, "claude"), 0o755);
    });

    /** Each call the stand-in got: its working folder, then its arguments. */
    const calls = async (): Promise<string[][] | null> => {
      if (!existsSync(out)) return null;
      const fields = (await readFile(out, "utf8")).split("\0").slice(0, -1);
      const found: string[][] = [];
      for (let i = 0; i < fields.length; i += Number(fields[i]) + 2) found.push(fields.slice(i + 1, i + 2 + Number(fields[i])));
      return found;
    };

    /** Run the script as Terminal would, minus the person's shell profile (-f instead of -l). */
    const run = async (options: { prompt?: string; configured?: keyof typeof CONFIGURED; withClaude?: boolean; into?: string; managed?: ManagedMcp } = {}) => {
      const configured = CONFIGURED[options.configured ?? "none"];
      await rm(path.join(folder, ".mcp.json"), { force: true });
      if (configured.mcpJson) await writeFile(path.join(folder, ".mcp.json"), JSON.stringify({ mcpServers: { sonobe: { command: "/bin/sh", args: ["-c", "echo not Sonobe"] } } }));
      const script = path.join(dir, "run.command");
      await writeFile(script, buildHandoffScript({ folder: options.into ?? folder, display: "~/code/noddit", prompt: options.prompt ?? PROMPTS[0]!, mcpConfig, managed: options.managed ?? null }), { mode: 0o700 });
      const result = spawnSync("/bin/zsh", ["-f", script], {
        encoding: "utf8",
        env: { PATH: `${options.withClaude === false ? "" : `${bin}:`}/usr/bin:/bin`, OUT: out, MCP_GET: configured.out, MCP_EXIT: String(configured.exit), HOME: dir },
      });
      const got = await calls();
      await rm(out, { force: true });
      return { ...result, calls: got, scriptLeft: existsSync(script) };
    };

    it("starts claude once, in the folder, with Sonobe's relay and the exact prompt, whatever sonobe server is configured", async () => {
      const cwd = await realpath(folder);
      for (const configured of Object.keys(CONFIGURED) as (keyof typeof CONFIGURED)[]) {
        for (const prompt of PROMPTS) {
          const result = await run({ prompt, configured });
          const label = `${configured}: ${JSON.stringify(prompt)}`;
          expect(result.status, `${label}\n${result.stderr}`).toBe(0);
          // One call, the session: the script never asks `claude mcp get`, so a repo's own "sonobe" can't take the relay's place.
          expect(result.calls, label).toEqual([[cwd, "--mcp-config", mcpConfig, "--", prompt]]);
          expect(result.scriptLeft, label).toBe(false);
        }
      }
    });

    it("starts claude with the organization's servers under a managed MCP config, saying first when Sonobe's isn't one", async () => {
      const cwd = await realpath(folder);
      for (const prompt of PROMPTS) {
        const listed = await run({ prompt, managed: { sonobe: true } });
        expect(listed.status, `${JSON.stringify(prompt)}\n${listed.stderr}`).toBe(0);
        expect(listed.stdout).toBe("");
        expect(listed.calls).toEqual([[cwd, "--", prompt]]);
      }
      const missing = await run({ managed: { sonobe: false } });
      expect(missing.status).toBe(0);
      expect(missing.stdout).toBe(`${MANAGED_WITHOUT_SONOBE}\n`);
      expect(missing.calls).toEqual([[cwd, "--", PROMPTS[0]]]);
      expect(missing.scriptLeft).toBe(false);
    });

    it("says how to install Claude Code when it isn't on the PATH", async () => {
      const result = await run({ withClaude: false });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("Claude Code isn't installed, or isn't on your PATH. Install it from https://claude.com/claude-code, then try Open in Claude Code again.\n");
      expect(result.calls).toBeNull();
    });

    it("stops when the folder is gone", async () => {
      const result = await run({ into: path.join(dir, "gone") });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("Sonobe couldn't open ~/code/noddit. Check that it's still there, then try Open in Claude Code again.\n");
      expect(result.calls).toBeNull();
      expect(result.scriptLeft).toBe(false);
    });
  });
});

describe("openInClaudeCode", () => {
  const PROMPT = "In my open Sonobe prototype “Noddit”, design a new screen for “Main”: a checkout";

  function options(over: Partial<HandoffOptions> = {}) {
    const opened: string[] = [];
    const asked: number[] = [];
    const handoff: HandoffOptions = {
      platform: "darwin",
      dir: path.join(dir, "userData", "handoff"),
      folder: async (): Promise<HandoffFolder> => {
        asked.push(1);
        return { root: "/Users/me/code/noddit", path: "~/code/noddit" };
      },
      server: () => SERVER,
      openPath: async (file) => {
        opened.push(file);
        return "";
      },
      name: () => "a1b2c3",
      managedMcp: async () => null,
      ...over,
    };
    return { handoff, opened, asked };
  }

  it("writes a 0700 script in userData/handoff and opens it in Terminal", async () => {
    const { handoff, opened } = options();
    expect(await openInClaudeCode({ prompt: PROMPT }, handoff)).toEqual({ ok: true, folder: "~/code/noddit" });
    const file = path.join(dir, "userData", "handoff", "a1b2c3.command");
    expect(opened).toEqual([file]);
    expect((await stat(file)).mode & 0o777).toBe(0o700);
    expect(await readFile(file, "utf8")).toBe(buildHandoffScript({ folder: "/Users/me/code/noddit", display: "~/code/noddit", prompt: PROMPT, mcpConfig: handoffMcpConfig(SERVER) }));
  });

  it("writes the script for an organization's managed MCP config", async () => {
    for (const managed of [{ sonobe: true }, { sonobe: false }]) {
      const { handoff } = options({ managedMcp: async () => managed });
      expect(await openInClaudeCode({ prompt: PROMPT }, handoff)).toEqual({ ok: true, folder: "~/code/noddit" });
      const file = path.join(handoff.dir, "a1b2c3.command");
      expect(await readFile(file, "utf8")).toBe(buildHandoffScript({ folder: "/Users/me/code/noddit", display: "~/code/noddit", prompt: PROMPT, mcpConfig: handoffMcpConfig(SERVER), managed }));
      await rm(file);
    }
  });

  it("works on macOS only, and says what to do instead", async () => {
    for (const platform of ["win32", "linux"]) {
      const { handoff, opened, asked } = options({ platform });
      expect(await openInClaudeCode({ prompt: PROMPT }, handoff)).toEqual({ ok: false, error: HANDOFF_NOT_MAC });
      expect(HANDOFF_NOT_MAC).toBe("Open in Claude Code works on macOS for now. Copy the prompt instead, and paste it into Claude Code in your app's folder.");
      expect([opened, asked]).toEqual([[], []]);
    }
  });

  it("refuses prompts it can't pass on, before asking for a folder", async () => {
    const { handoff, opened, asked } = options();
    const refused = async (request: unknown) => {
      const result = await openInClaudeCode(request, handoff);
      expect(result.ok).toBe(false);
      return result.ok ? "" : result.error;
    };
    for (const request of [undefined, null, "a screen", {}, { prompt: 7 }, { prompt: "  \n" }]) expect(await refused(request)).toBe("There's no request to hand to Claude Code yet. Describe the screen in the box first.");
    expect(await refused({ prompt: `a ${"x".repeat(HANDOFF_PROMPT_LIMIT)}` })).toBe("The prompt is over 20,000 characters, too long to hand to Claude Code. Shorten the request, or copy the prompt instead.");
    expect(await refused({ prompt: "a\0screen" })).toBe("The prompt has a NUL character, which Terminal can't pass on. Remove it and try again.");
    // `claude -- update` would update Claude Code instead of starting a session.
    expect(await refused({ prompt: "update" })).toBe("A one-word prompt could be one of Claude Code's own commands, like “update”. Describe the screen in a few words.");
    expect([opened, asked.length]).toEqual([[], 0]);
    expect(existsSync(handoff.dir)).toBe(false);
    expect(await openInClaudeCode({ prompt: `a ${"x".repeat(HANDOFF_PROMPT_LIMIT - 2)}` }, handoff)).toMatchObject({ ok: true });
  });

  it("passes on a cancelled dialog and a folder that can't be linked, writing nothing", async () => {
    const cancelled = options({ folder: async () => ({ cancelled: true }) });
    expect(await openInClaudeCode({ prompt: PROMPT }, cancelled.handoff)).toEqual({ ok: false, cancelled: true });
    const refused = options({ folder: async () => ({ error: "Pick your app's folder, not your whole home folder." }) });
    expect(await openInClaudeCode({ prompt: PROMPT }, refused.handoff)).toEqual({ ok: false, error: "Pick your app's folder, not your whole home folder." });
    expect([cancelled.opened, refused.opened]).toEqual([[], []]);
    expect(existsSync(cancelled.handoff.dir)).toBe(false);
  });

  it("removes the script when Terminal doesn't open it", async () => {
    const failing = options({ openPath: async () => "No application knows how to open this file." });
    expect(await openInClaudeCode({ prompt: PROMPT }, failing.handoff)).toEqual({ ok: false, error: "Terminal didn't open: No application knows how to open this file." });
    const throwing = options({ openPath: async () => Promise.reject(new Error("The file couldn't be opened.")) });
    expect(await openInClaudeCode({ prompt: PROMPT }, throwing.handoff)).toEqual({ ok: false, error: "Terminal didn't open: The file couldn't be opened." });
    expect(await readdir(failing.handoff.dir)).toEqual([]);
  });

  it("says so when the script can't be written", async () => {
    await writeFile(path.join(dir, "userData"), "a file where the folder goes");
    const { handoff, opened } = options();
    const result = await openInClaudeCode({ prompt: PROMPT }, handoff);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Sonobe couldn't write the script for Terminal: /) });
    expect(opened).toEqual([]);
  });

  it("clears out day-old scripts Terminal never ran", async () => {
    const handoffDir = path.join(dir, "userData", "handoff");
    await mkdir(handoffDir, { recursive: true });
    const now = Date.now();
    for (const [name, age] of [["old.command", 25], ["recent.command", 1], ["notes.txt", 48]] as const) {
      await writeFile(path.join(handoffDir, name), "");
      const when = new Date(now - age * 60 * 60 * 1000);
      await utimes(path.join(handoffDir, name), when, when);
    }
    const { handoff } = options({ now: () => now });
    await openInClaudeCode({ prompt: PROMPT }, handoff);
    expect((await readdir(handoffDir)).sort()).toEqual(["a1b2c3.command", "notes.txt", "recent.command"]);
  });
});

describe("readManagedMcp", () => {
  it("reads Claude Code's managed MCP config from its macOS path, the way Claude Code counts it", async () => {
    expect(MANAGED_MCP_CONFIG).toBe("/Library/Application Support/ClaudeCode/managed-mcp.json");
    const file = path.join(dir, "managed-mcp.json");
    expect(await readManagedMcp(file)).toBeNull();
    await writeFile(path.join(dir, "a-file"), "");
    expect(await readManagedMcp(path.join(dir, "a-file", "managed-mcp.json"))).toBeNull();
    const configs: [unknown, boolean][] = [
      [{ mcpServers: { sonobe: { command: "/Applications/Sonobe.app/Contents/Resources/cli/sonobe", args: ["mcp"] } } }, true],
      [{ mcpServers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/" } } }, false],
      [{ mcpServers: {} }, false],
      [{ servers: { sonobe: {} } }, false],
      [null, false],
    ];
    for (const [config, sonobe] of configs) {
      await writeFile(file, JSON.stringify(config));
      expect(await readManagedMcp(file), JSON.stringify(config)).toEqual({ sonobe });
    }
    // One that doesn't parse, or isn't a file, still keeps control, and lists no servers.
    await writeFile(file, "{ not json");
    expect(await readManagedMcp(file)).toEqual({ sonobe: false });
    await rm(file);
    await mkdir(file);
    expect(await readManagedMcp(file)).toEqual({ sonobe: false });
  });
});

describe("handoffFolder", () => {
  let home: string;
  let app: string;
  const key: CodeFolderKey = { projectPath: null, windowId: "1" };

  beforeEach(async () => {
    home = path.join(dir, "home");
    app = path.join(home, "code", "noddit");
    await mkdir(app, { recursive: true });
  });

  const store = () => createCodeFolderStore({ file: path.join(dir, "userData", "assistant-code-folders.json"), home });
  const picker = (...answers: (string | null)[]) => {
    const calls: number[] = [];
    return { calls, pick: async () => (calls.push(1), answers.shift() ?? null) };
  };

  it("links the folder the person picks in the dialog when none is linked", async () => {
    const folders = store();
    const dialog = picker(app);
    expect(await handoffFolder(folders, key, dialog.pick)).toEqual({ root: await realpath(app), path: "~/code/noddit" });
    expect(dialog.calls).toHaveLength(1);
    expect(await folders.status(key)).toEqual({ linked: { name: "noddit", path: "~/code/noddit", persisted: false }, missing: false });

    // Linked now, so the next hand-off opens there without asking.
    expect(await handoffFolder(folders, key, dialog.pick)).toEqual({ root: await realpath(app), path: "~/code/noddit" });
    expect(dialog.calls).toHaveLength(1);
  });

  it("passes on a cancel, and refuses what Match my code… refuses", async () => {
    const folders = store();
    expect(await handoffFolder(folders, key, picker(null).pick)).toEqual({ cancelled: true });
    expect(await handoffFolder(folders, key, picker(home).pick)).toEqual({ error: "Pick your app's folder, not your whole home folder." });
    expect(await handoffFolder(folders, key, picker("/").pick)).toEqual({ error: "Pick your app's folder, not your whole home folder." });
    expect(await folders.status(key)).toEqual({ linked: null, missing: false });
  });

  it("asks again when the linked folder is missing", async () => {
    const folders = store();
    await folders.link(key, app);
    await rm(app, { recursive: true });
    const moved = path.join(home, "code", "noddit-2");
    await mkdir(moved);
    const dialog = picker(moved);
    expect(await handoffFolder(folders, key, dialog.pick)).toEqual({ root: await realpath(moved), path: "~/code/noddit-2" });
    expect(dialog.calls).toHaveLength(1);
  });
});
