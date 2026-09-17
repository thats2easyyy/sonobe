/**
 * Motion that runs on its own must not repaint the page. Chromium composites only transform and
 * opacity animations; anything else (box-shadow, filter, width...) repaints and re-layerizes the
 * whole document every frame, and with a large patch graph on screen that alone drops the editor
 * below 60 fps.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** `@keyframes name { ... }` bodies by name. */
function keyframes(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.set(m[1]!, css.slice(re.lastIndex, i - 1));
  }
  return out;
}

/** Declaration blocks (selector → body) outside at-rule preludes, one level deep inside @media. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(stripped); m; m = re.exec(stripped)) out.push({ selector: m[1]!.trim().replace(/^@media[^{]*\{/, "").trim(), body: m[2]! });
  return out;
}

const files = cssFiles(SRC).map((file) => ({ file: path.relative(SRC, file), css: readFileSync(file, "utf8") }));
const allKeyframes = new Map<string, { file: string; body: string }>();
for (const { file, css } of files) for (const [name, body] of keyframes(css)) allKeyframes.set(name, { file, body });

describe("editor animations", () => {
  it("animates only transform and opacity in infinite animations", () => {
    const problems: string[] = [];
    for (const { file, css } of files) {
      for (const { selector, body } of rules(css)) {
        for (const m of body.matchAll(/animation\s*:\s*([^;]+)/g)) {
          for (const part of m[1]!.split(",")) {
            if (!/\binfinite\b/.test(part)) continue;
            const name = part.trim().split(/\s+/).find((token) => allKeyframes.has(token));
            if (!name) continue;
            const props = [...allKeyframes.get(name)!.body.matchAll(/([\w-]+)\s*:/g)].map((p) => p[1]!);
            const bad = props.filter((p) => p !== "transform" && p !== "opacity");
            if (bad.length) problems.push(`${file} ${selector}: ${name} animates ${[...new Set(bad)].join(", ")}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("doesn't transition box-shadow on patch editor nodes", () => {
    const css = files.find((f) => f.file.endsWith(path.join("patch-editor", "patch-editor.css")))!.css;
    const offenders = rules(css).filter(({ selector, body }) => /\.sb-pe-node\b/.test(selector) && /transition[^;]*box-shadow/.test(body));
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });
});
