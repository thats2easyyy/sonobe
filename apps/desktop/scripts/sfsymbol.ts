/**
 * Builds the SF Symbols helper (native/sfsymbol/main.swift) on macOS with swiftc. build.mjs copies the
 * result to dist/bin/sfsymbol, and electron-builder ships it in Resources/bin. The helper is built for
 * the architecture the app is built for: arm64, x64, or "universal" (both slices merged with lipo).
 * Compiled binaries are cached by source, compiler and target in node_modules/.cache/sfsymbol, so builds
 * after the first skip swiftc. Elsewhere, or without Xcode's command line tools, there's no helper and
 * imports keep SF Symbol placeholders.
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

export type SymbolHelperArch = "arm64" | "x64" | "universal";

/** Build the helper into `out` (a file path). Throws when swiftc fails on the source. */
export function buildSymbolHelper({ out, cacheDir = path.join(root, "node_modules", ".cache", "sfsymbol"), arch = process.arch === "x64" ? "x64" : "arm64" }: { out: string; cacheDir?: string; arch?: SymbolHelperArch }): SymbolHelperBuild {
  if (process.platform !== "darwin") return { skipped: "SF Symbols need macOS" };
  // swiftc without the command line tools is a stub that opens an installer dialog, so ask xcode-select first.
  if (spawnSync("xcode-select", ["-p"], { stdio: "ignore" }).status !== 0) return { skipped: "Xcode's command line tools aren't installed (xcode-select --install)" };
  let compiler: string;
  try {
    compiler = execFileSync("swiftc", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return { skipped: "swiftc isn't available" };
  }
  const source = readFileSync(SFSYMBOL_SOURCE);
  /** One architecture's helper in the cache, compiled when it isn't there yet. */
  const buildSlice = (sliceArch: "arm64" | "x64"): { key: string; file: string; cached: boolean } => {
    const target = `${sliceArch === "x64" ? "x86_64" : "arm64"}-apple-macos12`;
    const key = createHash("sha256").update(source).update(compiler).update(target).digest("hex").slice(0, 16);
    const file = path.join(cacheDir, key, "sfsymbol");
    const cached = existsSync(file);
    if (!cached) {
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      execFileSync("swiftc", ["-O", "-target", target, SFSYMBOL_SOURCE, "-o", temp], { stdio: ["ignore", "inherit", "inherit"] });
      renameSync(temp, file);
    }
    return { key, file, cached };
  };
  let built: { file: string; cached: boolean };
  if (arch === "universal") {
    // Both slices in one file: the same helper runs in an arm64 app, an x64 app and a universal one.
    const slices = [buildSlice("arm64"), buildSlice("x64")];
    const key = createHash("sha256").update(slices.map((slice) => slice.key).join("+")).digest("hex").slice(0, 16);
    const file = path.join(cacheDir, key, "sfsymbol");
    const cached = existsSync(file);
    if (!cached) {
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      execFileSync("lipo", ["-create", ...slices.map((slice) => slice.file), "-output", temp], { stdio: ["ignore", "inherit", "inherit"] });
      renameSync(temp, file);
    }
    built = { file, cached };
  } else {
    built = buildSlice(arch);
  }
  mkdirSync(path.dirname(out), { recursive: true });
  copyFileSync(built.file, out);
  return { path: out, cached: built.cached };
}
