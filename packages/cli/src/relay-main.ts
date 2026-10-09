#!/usr/bin/env node
/**
 * `sonobe mcp` as an entry of its own: the stdio relay to the running app and nothing else. Every
 * Claude session keeps one of these running, so it loads relay.ts alone instead of the whole CLI:
 * main.ts comes here for exactly `sonobe mcp`, and the desktop app ships it bundled as
 * Resources/cli/relay.mjs, which its launcher picks the same way. Every other form (`mcp --headless`,
 * `mcp --help`, a stray argument) goes through cli.ts, so its answers are the CLI's.
 */

import pkg from "../package.json" with { type: "json" };
import { runRelayCommand } from "./relay.ts";

try {
  process.exitCode = await runRelayCommand(
    {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      cwd: process.cwd(),
      fetch,
    },
    (pkg as { version?: string }).version ?? "0.0.0",
  );
} catch (err) {
  // What runCli says when a command throws.
  process.stderr.write(`sonobe mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
