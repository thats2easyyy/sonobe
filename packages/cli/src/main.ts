#!/usr/bin/env node
/** `sonobe` command entry: node packages/cli/src/main.ts <command>. */

import { runCli } from "./cli.ts";

process.exitCode = await runCli(process.argv.slice(2));
