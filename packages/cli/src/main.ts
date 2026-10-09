#!/usr/bin/env node
/**
 * `sonobe` command entry: node packages/cli/src/main.ts <command>. Exactly `sonobe mcp` is the relay,
 * which a Claude session keeps running: it loads relay-main.ts alone. Everything else loads the CLI.
 */

// Nothing is imported statically, and top-level await needs a module.
export {};

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "mcp") {
  await import("./relay-main.ts");
} else {
  const { runCli } = await import("./cli.ts");
  process.exitCode = await runCli(args);
}
