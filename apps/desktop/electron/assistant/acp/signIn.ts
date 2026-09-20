/**
 * Sign in to Claude, for the Assistant on the person's Claude subscription (experimental). Sonobe never
 * sees the login: on macOS it opens the adapter's own `--cli auth login --claudeai` (Claude Code's
 * login) in Terminal through a one-time script, like Open in Claude Code's, and Claude Code keeps the
 * credentials where it always does. Electron-free: main injects shell.openPath.
 */

import { openTerminalScript, shellQuote } from "../../claude-handoff.ts";
import { CLAUDE_AGENT_PACKAGE, type ClaudeAgentSpec, type OpenClaudeSignIn } from "./types.ts";

export const SIGN_IN_NOT_MAC = "Run claude-agent-acp --cli auth login in a terminal, then check again.";
/** The adapter hands everything after --cli to its Claude Code: `claude auth login --claudeai`. */
export const SIGN_IN_ARGS = ["--cli", "auth", "login", "--claudeai"];

/** The one-time Terminal script: it says what it's for, then runs the adapter's login as Sonobe would run the adapter. */
export function buildSignInScript(spec: ClaudeAgentSpec): string {
  // A JS entry runs with Electron's Node: the script is the adapter.
  const adapter = spec.env.ELECTRON_RUN_AS_NODE === "1" && spec.args[0] ? spec.args[0] : spec.command;
  const exports = Object.entries(spec.env)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`);
  return [
    "#!/bin/zsh -l",
    "# Sonobe's Sign in to Claude. It deletes itself as it starts.",
    'rm -f -- "$0"',
    `print -r -- ${shellQuote("Signing in to Claude for Sonobe's Assistant… When it's done, go back to Sonobe and choose Check again.")}`,
    `if [ ! -e ${shellQuote(adapter)} ]; then`,
    `  print -r -- ${shellQuote(`Claude's agent adapter isn't at ${spec.displayPath} anymore. In Terminal, run npm install -g ${CLAUDE_AGENT_PACKAGE}, then choose Check again in Sonobe.`)}`,
    "  exit 1",
    "fi",
    ...exports,
    `exec ${[spec.command, ...spec.args, ...SIGN_IN_ARGS].map(shellQuote).join(" ")}`,
    "",
  ].join("\n");
}

/** Open the adapter's Claude sign-in in Terminal (macOS). Resolves with teaching errors; never rejects for expected failures. */
export const openClaudeSignIn: OpenClaudeSignIn = async (spec, options) => {
  if (options.platform !== "darwin") return { ok: false, error: SIGN_IN_NOT_MAC };
  return openTerminalScript(buildSignInScript(spec), options);
};
