/**
 * Builds the SF Symbols helper (native/sfsymbol/main.swift) on macOS with swiftc. build.mjs copies the
 * result to dist/bin/sfsymbol, and electron-builder ships it in Resources/bin. Compiled binaries are
 * cached by source, compiler and target in node_modules/.cache/sfsymbol, so builds after the first skip
 * swiftc. Elsewhere, or without Xcode's command line tools, there's no helper and imports keep SF
 * Symbol placeholders.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SFSYMBOL_SOURCE = path.join(root, "native", "sfsymbol", "main.swift");

export interface SymbolHelperBuild {
  /** Where the helper is now. */
  path?: string;
  /** It came from the cache, without running swiftc. */
  cached?: boolean;
  /** Why this machine can't build it. */
  skipped?: string;
}

/** Build the helper into `out` (a file path). Throws when swiftc fails on the source. */
export function buildSymbolHelper({ out, cacheDir = path.join(root, "node_modules", ".cache", "sfsymbol"), arch = process.arch }: { out: string; cacheDir?: string; arch?: string }): SymbolHelperBuild {
  if (process.platform !== "darwin") return { skipped: "SF Symbols need macOS" };
  // swiftc without the command line tools is a stub that opens an installer dialog, so ask xcode-select first.
  if (spawnSync("xcode-select", ["-p"], { stdio: "ignore" }).status !== 0) return { skipped: "Xcode's command line tools aren't installed (xcode-select --install)" };
  const target = `${arch === "x64" ? "x86_64" : "arm64"}-apple-macos12`;
  let compiler: string;
  try {
    compiler = execFileSync("swiftc", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return { skipped: "swiftc isn't available" };
  }
  const key = createHash("sha256").update(readFileSync(SFSYMBOL_SOURCE)).update(compiler).update(target).digest("hex").slice(0, 16);
  const cached = path.join(cacheDir, key, "sfsymbol");
  const hit = existsSync(cached);
  if (!hit) {
    mkdirSync(path.dirname(cached), { recursive: true });
    const temp = `${cached}.${process.pid}.tmp`;
    execFileSync("swiftc", ["-O", "-target", target, SFSYMBOL_SOURCE, "-o", temp], { stdio: ["ignore", "inherit", "inherit"] });
    renameSync(temp, cached);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  copyFileSync(cached, out);
  return { path: out, cached: hit };
}
