/**
 * The sfsymbol helper as a SymbolRenderer (Node only, from "@sonobe/import/node"). The helper is a small
 * macOS program (apps/desktop/native/sfsymbol) that draws SF Symbols with SwiftUI; the Sonobe app ships
 * it, and headless servers find it through SONOBE_SFSYMBOL. One helper process draws a whole capture's
 * symbols: requests go in as JSON lines on stdin, and one answer per line comes back on stdout.
 */

import { spawn } from "node:child_process";
import type { SymbolOverflow, SymbolRenderer, SymbolResult } from "./symbols.ts";

/** Largest answer line accepted (a 3x PNG of a large symbol stays well under this). */
const MAX_LINE = 8 * 1024 * 1024;

interface HelperAnswer {
  id?: number;
  ok?: boolean;
  svg?: string;
  png?: string;
  width?: number;
  height?: number;
  overflow?: unknown;
  fallback?: string;
  restriction?: string;
  error?: string;
  suggestions?: string[];
}

const isOverflow = (v: unknown): v is SymbolOverflow => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);

function toResult(a: HelperAnswer): SymbolResult {
  if (a.ok && (a.svg || a.png) && typeof a.width === "number" && typeof a.height === "number") {
    return { ok: true, width: a.width, height: a.height, ...(isOverflow(a.overflow) && a.overflow.some((n) => n > 0) ? { overflow: a.overflow } : {}), ...(a.svg ? { svg: a.svg } : { png: a.png! }), ...(a.fallback ? { fallback: a.fallback } : {}), ...(a.restriction ? { restriction: a.restriction } : {}) };
  }
  return { ok: false, error: a.error ?? "The SF Symbols helper sent no drawing.", ...(a.suggestions?.length ? { suggestions: a.suggestions } : {}) };
}

/** Draw SF Symbols with the helper at `binary` (`sfsymbol --batch`). */
export function symbolHelper(binary: string): SymbolRenderer {
  return {
    render(requests, options = {}) {
      if (!requests.length) return Promise.resolve([]);
      return new Promise<SymbolResult[]>((resolve, reject) => {
        const results: (SymbolResult | undefined)[] = new Array(requests.length);
        let done = 0;
        let buffer = "";
        let stderr = "";
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          options.signal?.removeEventListener("abort", onAbort);
          if (err) reject(err);
          else resolve(results.map((r) => r ?? { ok: false, error: "The SF Symbols helper skipped it." }));
        };
        if (options.signal?.aborted) return reject(new Error("drawing was cancelled"));
        const child = spawn(binary, ["--batch"], { stdio: ["pipe", "pipe", "pipe"] });
        const onAbort = () => {
          child.kill();
          finish(new Error("drawing was cancelled"));
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        // Messages read inside "Sonobe couldn't draw SF Symbols (…)".
        child.on("error", (err: NodeJS.ErrnoException) => finish(new Error(err.code === "ENOENT" ? `the SF Symbols helper isn't at ${binary}` : `couldn't run the SF Symbols helper at ${binary}: ${err.code ?? err.message}`)));
        child.stdin.on("error", () => undefined);
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          if (stderr.length < 2000) stderr += chunk;
        });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          buffer += chunk;
          if (buffer.length > MAX_LINE && !buffer.includes("\n")) {
            child.kill();
            finish(new Error("the SF Symbols helper sent an answer that's too large"));
            return;
          }
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            let answer: HelperAnswer;
            try {
              answer = JSON.parse(line) as HelperAnswer;
            } catch {
              continue;
            }
            if (typeof answer.id !== "number" || answer.id < 0 || answer.id >= requests.length || results[answer.id]) continue;
            results[answer.id] = toResult(answer);
            options.onDrawn?.(++done, requests.length);
          }
        });
        child.on("close", (code, signal) => {
          if (settled) return;
          if (code === 0 || done === requests.length) finish();
          else finish(new Error(`the SF Symbols helper stopped (${signal ?? `exit code ${code}`})${stderr.trim() ? `: ${stderr.trim().split("\n")[0]}` : ""}`));
        });
        child.stdin.end(requests.map((r, id) => JSON.stringify({ id, name: r.name, size: r.size, weight: r.weight, scale: r.scale, colors: r.colors })).join("\n") + "\n");
      });
    },
  };
}
