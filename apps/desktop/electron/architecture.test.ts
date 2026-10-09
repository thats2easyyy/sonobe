/** ARCHITECTURE.md's desktop sections (§9.1 env switches, §9.2 web player, §12 quality gates) match the desktop app. */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { syncUrl } from "../player/platform.ts";
import { previewUrl } from "./lan-preview.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const architecture = read("../../../ARCHITECTURE.md");

/** The lines from a heading that starts with `title` up to the next heading. */
function section(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.replace(/^#+ /, "").startsWith(title));
  if (start < 0) throw new Error(`ARCHITECTURE.md has no "${title}" heading`);
  const end = lines.findIndex((line, i) => i > start && /^#{2,4} /.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** A workflow file's jobs by name, each with its steps. */
function jobs(workflow: string): Record<string, string> {
  const parts = workflow.slice(workflow.indexOf("\njobs:\n") + 7).split(/^(?=  [a-z-]+:$)/m);
  return Object.fromEntries(parts.map((part) => [/^  ([a-z-]+):$/m.exec(part)![1]!, part]));
}
const runs = (job: string) => [...job.matchAll(/^\s*(?:- )?run: (.+)$/gm)].map((m) => m[1]!.trim());

const switches = (source: string) => new Set([...source.matchAll(/\bSONOBE_[A-Z_]+\b/g)].map((m) => m[0]).filter((name) => !name.startsWith("SONOBE_SMOKE_")));

describe("§9.1 env switches", () => {
  const documented = switches(section(architecture, "9.1"));

  it("lists every switch the desktop main process reads", () => {
    const read1 = switches(read("./env.ts"));
    expect(read1.size).toBeGreaterThanOrEqual(10);
    for (const name of read1) expect(documented, name).toContain(name);
  });

  it("lists the switches the CLI launcher and MCP guides read", () => {
    for (const name of switches(read("../scripts/build.mjs"))) expect(documented, name).toContain(name);
    for (const name of switches(read("../../../packages/mcp/src/guides.ts"))) expect(documented, name).toContain(name);
    for (const name of switches(read("../../../packages/mcp/src/examples.ts"))) expect(documented, name).toContain(name);
  });
});

describe("§12 quality gates", () => {
  const gates = section(architecture, "12.");
  const e2e = gates.split("\n").find((line) => line.startsWith("- `npm run e2e`"))!;

  it("doesn't claim npm run e2e drives Electron when Playwright only has a Chromium project", () => {
    const config = read("../../../playwright.config.ts");
    expect(e2e).toBeDefined();
    if (!config.includes("_electron")) expect(e2e).not.toMatch(/electron/i);
    expect(config).toMatch(/projects: \[\{ name: "chromium"/);
  });

  it("documents the Electron smoke run as its own command, outside CI", () => {
    const pkg = JSON.parse(read("../package.json")) as { name: string; scripts: Record<string, string> };
    expect(pkg.scripts.smoke).toBe("node tests/smoke.mjs");
    expect(gates).toContain(`\`npm run smoke -w ${pkg.name}\``);
    const ci = read("../../../.github/workflows/ci.yml");
    if (!ci.includes("smoke")) expect(gates).toMatch(/isn't part of `npm run e2e` or CI/);
    expect(read("../tests/smoke.mjs")).toContain("SONOBE_SMOKE_SKIP_EDITOR_BUILD");
  });

  it("documents package verification with every flag it takes, and keeps it off the keychain and the tracked screenshot", () => {
    const pkg = JSON.parse(read("../package.json")) as { name: string; scripts: Record<string, string> };
    expect(pkg.scripts["package:verify"]).toBe("node scripts/verify-package.mjs");
    const bullet = gates.split("\n").find((line) => line.startsWith(`- \`npm run package:verify -w ${pkg.name}\``))!;
    expect(bullet).toBeDefined();
    const verify = read("../scripts/verify-package.mjs");
    const flags = [...verify.matchAll(/^    "?([a-z-]+)"?: \{ type: "(?:boolean|string)"/gm)].map((m) => `--${m[1]}`);
    expect(flags).toEqual(expect.arrayContaining(["--dmg", "--release", "--static"]));
    const readme = read("../README.md");
    for (const flag of flags) {
      expect(bullet, flag).toContain(`\`${flag}`);
      expect(readme, flag).toContain(`\`${flag}`);
    }
    // The launch uses the test cipher (the real one is the login keychain), and writes no file in the repository unless asked.
    expect(verify).toContain('SONOBE_TEST: "1"');
    expect(bullet).toContain("`SONOBE_TEST=1`");
    expect(verify).not.toMatch(/root, "screenshots"/);
    expect(verify).toContain("lsregister");
  });

  it("runs in CI what the CI bullet says, and nothing that needs a person, Xcode or a Claude account", () => {
    const ci = read("../../../.github/workflows/ci.yml");
    const root = JSON.parse(read("../../../package.json")) as { scripts: Record<string, string> };
    const runs = [...ci.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1]!.trim());
    for (const gate of ["npm run typecheck", "npm test", "npm run e2e"]) {
      expect(runs, gate).toContain(gate);
      expect(root.scripts[gate.replace(/^npm (run )?/, "")], gate).toBeDefined();
      expect(gates, gate).toContain(`\`${gate}\``);
    }
    // The e2e run needs Playwright's Chromium before it starts.
    expect(runs.findIndex((run) => /^npx playwright install\b.*chromium/.test(run))).toBeLessThan(runs.indexOf("npm run e2e"));
    expect(ci).not.toMatch(/smoke|test:ios|evals\/run|secrets\./);
    const bullet = gates.split("\n").find((line) => line.startsWith("- CI "))!;
    expect(bullet).toContain("`.github/workflows/ci.yml`");
    expect(bullet).toContain(`Node ${/node-version: (\d+)/.exec(ci)![1]}`);
  });
});

describe("§12 packaging in CI and the release workflow", () => {
  const gates = section(architecture, "12.");
  const ci = read("../../../.github/workflows/ci.yml");
  const release = read("../../../.github/workflows/release.yml");
  const pkg = JSON.parse(read("../package.json")) as { name: string; scripts: Record<string, string> };
  const contributing = read("../../../CONTRIBUTING.md");
  const releasing = contributing.slice(contributing.indexOf("\n## Releasing\n"), contributing.indexOf("\n## UI rules\n"));

  it("builds and verifies the local package in CI, in a job of its own that has no credentials", () => {
    const { check, package: pack } = jobs(ci);
    expect(pkg.scripts.package).toBe("node scripts/package.mjs");
    expect(runs(pack!)).toEqual(["npm ci", `npm run package -w ${pkg.name}`, `npm run package:verify -w ${pkg.name}`, `npm run package:verify -w ${pkg.name} -- --dmg`]);
    // Beside the checks, not in front of them: the existing job doesn't wait for a package.
    expect(runs(check!).join()).not.toContain("package");
    expect(pack).not.toMatch(/needs:|--release|--identity/);
    // A pull request build has no certificate and still has to sign ad-hoc, or the app it verifies won't run.
    expect(read("../scripts/signing.ts")).toContain('setEnv: { CSC_FOR_PULL_REQUEST: "true" }');
    const bullet = gates.split("\n").find((line) => line.startsWith("- CI "))!;
    for (const run of runs(pack!).slice(1, 3)) expect(bullet, run).toContain(`\`${run}\``);
  });

  it("releases from a version tag: the version check, the checks, package.mjs --release, verification, then a draft", () => {
    expect(release).toMatch(/^on:\n  push:\n    tags: \["v\*"\]\n  workflow_dispatch:$/m);
    const { build, draft } = jobs(release);
    const steps = [
      'node scripts/set-version.ts --check "${GITHUB_REF_NAME#v}"',
      "npm ci",
      "npm run typecheck",
      "npm test",
      "node apps/desktop/scripts/package.mjs --release",
      "node apps/desktop/scripts/verify-package.mjs --release --arch arm64",
      "node apps/desktop/scripts/verify-package.mjs --release --arch arm64 --dmg",
      "node apps/desktop/scripts/verify-package.mjs --release --arch x64",
      "actions/upload-artifact",
    ];
    const at = steps.map((step) => build!.indexOf(step));
    expect(at.every((index) => index >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const script of ["scripts/set-version.ts", "apps/desktop/scripts/package.mjs", "apps/desktop/scripts/verify-package.mjs"]) expect(existsSync(fileURLToPath(new URL(`../../../${script}`, import.meta.url))), script).toBe(true);
    // The build never publishes. The draft job uploads what was verified, and a person publishes the draft.
    expect(release).not.toMatch(/--publish|gh release edit|--draft=false/);
    expect(draft).toContain("gh release create \"$TAG\" --draft --verify-tag");
    expect(draft).toMatch(/^    needs: build$/m);
    expect(draft).toMatch(/^    if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m);
    for (const name of ["`.github/workflows/release.yml`", "`package.mjs --release`", "`verify-package.mjs --release`", "draft"]) expect(gates, name).toContain(name);
  });

  it("gives the token that can write only to the job that drafts, which holds no secret and runs no code from the repository", () => {
    expect(release).toMatch(/^permissions:\n  contents: read$/m);
    expect(release.match(/contents: write/g)).toHaveLength(1);
    const { build, draft } = jobs(release);
    expect(draft).toMatch(/^    permissions:\n      contents: write$/m);
    expect(draft).not.toMatch(/secrets\.|actions\/checkout/);
    // Without a checkout, gh has to be told the repository.
    expect(draft).toContain("GH_REPO: ${{ github.repository }}");
    expect(build).not.toMatch(/gh release|GH_TOKEN|permissions:/);
    // Every action is pinned to a major version, as in ci.yml.
    const uses = [...`${ci}\n${release}`.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(6);
    for (const action of uses) expect(action).toMatch(/^actions\/[a-z-]+@v\d+$/);
  });

  it("uses exactly the secrets CONTRIBUTING's Releasing section explains, and hands package.mjs what its signing plan reads", () => {
    const used = [...new Set([...release.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]!))].sort();
    const documented = [...releasing.matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((m) => m[1]!).sort();
    expect(used).toEqual(["APPLE_API_ISSUER", "APPLE_API_KEY_ID", "APPLE_API_KEY_P8", "CSC_KEY_PASSWORD", "CSC_LINK"]);
    expect(documented).toEqual(used);
    // The package step's variables are the ones planSigning asks for; the key reaches it as a file's path.
    const step = jobs(release).build!.split(/^      - /m).find((part) => part.includes("package.mjs --release"))!;
    const names = [...new Set([...step.matchAll(/\b((?:CSC|APPLE)_[A-Z_]+)[:=]/g)].map((m) => m[1]!))].sort();
    expect(names).toEqual(["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_ID", "CSC_KEY_PASSWORD", "CSC_LINK"]);
    const signing = read("../scripts/signing.ts");
    for (const name of names) expect(signing, name).toContain(name);
    expect(step).toContain('APPLE_API_KEY="$RUNNER_TEMP/AuthKey.p8"');
    // The checklist names the commands and the things the first release freezes.
    for (const text of ["node scripts/set-version.ts", "`dev.sonobe.app`", "`thats2easyyy/sonobe`", "Confirm before the first release", "`latest-mac.yml`"]) expect(releasing, text).toContain(text);
    const yml = read("../electron-builder.yml");
    expect(yml).toMatch(/^appId: dev\.sonobe\.app$/m);
    expect(yml).toMatch(/^  owner: thats2easyyy\n  repo: sonobe$/m);
  });
});

describe("§9.2 web player", () => {
  it("promises the camera only on a secure page: Preview on Phone is plain http://, and Sonobe Viewer loads it from its own scheme", () => {
    expect(previewUrl("192.168.1.20", 8421, "t")).toMatch(/^http:\/\//);
    expect(read("../../ios/SonobeViewer/PlayerProxy.swift")).toContain('static let scheme = "sonobe-player"');
    expect(syncUrl("sonobe-player://192.168.1.20:8421/p/t/")).toBe("ws://192.168.1.20:8421/p/t/sync");
    expect(section(architecture, "9.2")).toContain("`sonobe-player://<host>:<port>/p/<token>/`");
    const claims = [
      section(architecture, "9.2").split("\n").find((line) => line.startsWith("- **Platform services.**")),
      read("../../../README.md").split("\n").find((line) => line.startsWith("- **Phone preview")),
      read("../../../ROADMAP.md").split("\n").find((line) => line.includes("Native iPhone preview")),
      read("../../ios/README.md").split("\n\n").find((paragraph) => paragraph.includes("reaches the phone")),
    ];
    for (const claim of claims) {
      expect(claim).toBeDefined();
      if (/\bcamera\b/.test(claim!)) expect(claim, claim!.slice(0, 80)).toMatch(/\bsecure\b/);
    }
  });
});
