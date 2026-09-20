import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSignInScript, openClaudeSignIn, SIGN_IN_ARGS, SIGN_IN_NOT_MAC } from "./signIn.ts";
import type { ClaudeAgentSpec, ClaudeSignInOptions } from "./types.ts";

const zsh = process.platform !== "win32" && existsSync("/bin/zsh");
const FAKE = fileURLToPath(new URL("../../../tests/fake-claude-agent.mjs", import.meta.url));

/** A JS entry, run with Electron's Node, both in folders with spaces and a quote. */
const JS: ClaudeAgentSpec = {
  command: "/Applications/Sonobe Beta.app/Contents/MacOS/Sonobe",
  args: ["/Users/me/Tyler's Tools/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"],
  env: { ELECTRON_RUN_AS_NODE: "1" },
  displayPath: "~/Tyler's Tools/bin/claude-agent-acp",
  version: "0.79.0",
  source: "path",
};
const DIRECT: ClaudeAgentSpec = { command: "/usr/local/bin/claude-agent-acp", args: [], env: {}, displayPath: "/usr/local/bin/claude-agent-acp", version: null, source: "path" };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-sign-in-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function options(over: Partial<ClaudeSignInOptions> = {}) {
  const opened: string[] = [];
  const signIn: ClaudeSignInOptions = {
    platform: "darwin",
    dir: path.join(dir, "userData", "handoff"),
    openPath: async (file) => {
      opened.push(file);
      return "";
    },
    ...over,
  };
  return { signIn, opened };
}

/** Run a sign-in script as Terminal would, minus the person's shell profile. */
async function run(spec: ClaudeAgentSpec) {
  const file = path.join(dir, "sign-in.command");
  await writeFile(file, buildSignInScript(spec), { mode: 0o700 });
  const result = spawnSync("/bin/zsh", ["-f", file], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: dir } });
  return { ...result, scriptLeft: existsSync(file) };
}

describe("buildSignInScript", () => {
  it("says what it's for, then runs the adapter's login with Electron's Node, every word quoted", () => {
    expect(buildSignInScript(JS).split("\n")).toEqual([
      "#!/bin/zsh -l",
      "# Sonobe's Sign in to Claude. It deletes itself as it starts.",
      'rm -f -- "$0"',
      `print -r -- 'Signing in to Claude for Sonobe'\\''s Assistant… When it'\\''s done, go back to Sonobe and choose Check again.'`,
      `if [ ! -e '/Users/me/Tyler'\\''s Tools/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js' ]; then`,
      `  print -r -- 'Claude'\\''s agent adapter isn'\\''t at ~/Tyler'\\''s Tools/bin/claude-agent-acp anymore. In Terminal, run npm install -g @agentclientprotocol/claude-agent-acp, then choose Check again in Sonobe.'`,
      "  exit 1",
      "fi",
      "export ELECTRON_RUN_AS_NODE='1'",
      `exec '/Applications/Sonobe Beta.app/Contents/MacOS/Sonobe' '/Users/me/Tyler'\\''s Tools/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js' '--cli' 'auth' 'login' '--claudeai'`,
      "",
    ]);
    expect(SIGN_IN_ARGS).toEqual(["--cli", "auth", "login", "--claudeai"]);
  });

  it("runs an executable adapter as it is, with nothing exported", () => {
    const lines = buildSignInScript(DIRECT).split("\n");
    expect(lines.some((line) => line.startsWith("export "))).toBe(false);
    expect(lines).toContain("if [ ! -e '/usr/local/bin/claude-agent-acp' ]; then");
    expect(lines.at(-2)).toBe("exec '/usr/local/bin/claude-agent-acp' '--cli' 'auth' 'login' '--claudeai'");
  });

  describe.skipIf(!zsh)("run by zsh", () => {
    it("passes the login's arguments and ELECTRON_RUN_AS_NODE exactly, through paths with spaces, and deletes itself", async () => {
      const folder = path.join(dir, "Sonobe Beta.app", "Contents", "MacOS");
      await mkdir(folder, { recursive: true });
      const out = path.join(dir, "calls");
      const stand = path.join(folder, "Sonobe");
      await writeFile(stand, `#!/bin/sh\nprintf '%s\\n' "ELECTRON_RUN_AS_NODE=$ELECTRON_RUN_AS_NODE" "$@" > '${out}'\n`);
      await chmod(stand, 0o755);
      const entry = path.join(dir, "Tyler's Tools", "dist", "index.js");
      await mkdir(path.dirname(entry), { recursive: true });
      await writeFile(entry, "");
      const result = await run({ ...JS, command: stand, args: [entry] });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("Signing in to Claude for Sonobe's Assistant… When it's done, go back to Sonobe and choose Check again.\n");
      expect((await readFile(out, "utf8")).split("\n").slice(0, -1)).toEqual(["ELECTRON_RUN_AS_NODE=1", entry, "--cli", "auth", "login", "--claudeai"]);
      expect(result.scriptLeft).toBe(false);
    });

    it("runs the fake adapter's login with this Node", async () => {
      const result = await run({ ...JS, command: process.execPath, args: [FAKE] });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.split("\n").slice(1)).toEqual(["fake claude login", ""]);
    });

    it("says how to reinstall the adapter when it's gone", async () => {
      const result = await run({ ...JS, command: process.execPath, args: [path.join(dir, "gone", "index.js")] });
      expect(result.status).toBe(1);
      expect(result.stdout.split("\n")[1]).toBe("Claude's agent adapter isn't at ~/Tyler's Tools/bin/claude-agent-acp anymore. In Terminal, run npm install -g @agentclientprotocol/claude-agent-acp, then choose Check again in Sonobe.");
      expect(result.scriptLeft).toBe(false);
    });
  });
});

describe("openClaudeSignIn", () => {
  it("writes a 0700 script into userData/handoff and opens it in Terminal", async () => {
    const { signIn, opened } = options();
    expect(await openClaudeSignIn(JS, signIn)).toEqual({ ok: true });
    const [name] = await readdir(signIn.dir);
    expect(name).toMatch(/^[0-9a-f]{32}\.command$/);
    const file = path.join(signIn.dir, name!);
    expect(opened).toEqual([file]);
    expect((await stat(file)).mode & 0o777).toBe(0o700);
    expect((await stat(signIn.dir)).mode & 0o777).toBe(0o700);
    expect(await readFile(file, "utf8")).toBe(buildSignInScript(JS));
  });

  it("works on macOS only, and says what to run instead", async () => {
    for (const platform of ["win32", "linux"] as const) {
      const { signIn, opened } = options({ platform });
      expect(await openClaudeSignIn(JS, signIn)).toEqual({ ok: false, error: SIGN_IN_NOT_MAC });
      expect(opened).toEqual([]);
      expect(existsSync(signIn.dir)).toBe(false);
    }
    expect(SIGN_IN_NOT_MAC).toBe("Run claude-agent-acp --cli auth login in a terminal, then check again.");
  });

  it("removes the script when Terminal doesn't open it", async () => {
    const failing = options({ openPath: async () => "No application knows how to open this file." });
    expect(await openClaudeSignIn(JS, failing.signIn)).toEqual({ ok: false, error: "Terminal didn't open: No application knows how to open this file." });
    const throwing = options({ openPath: async () => Promise.reject(new Error("The file couldn't be opened.")) });
    expect(await openClaudeSignIn(JS, throwing.signIn)).toEqual({ ok: false, error: "Terminal didn't open: The file couldn't be opened." });
    expect(await readdir(failing.signIn.dir)).toEqual([]);
  });

  it("says so when the script can't be written", async () => {
    await writeFile(path.join(dir, "userData"), "a file where the folder goes");
    const { signIn, opened } = options();
    expect(await openClaudeSignIn(JS, signIn)).toMatchObject({ ok: false, error: expect.stringMatching(/^Sonobe couldn't write the script for Terminal: /) });
    expect(opened).toEqual([]);
  });
});
