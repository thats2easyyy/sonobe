/**
 * How a package is signed (scripts/signing.ts): the plan for each of package.mjs's modes and what a
 * release refuses, the parsers package.mjs and verify-package.mjs read signatures with, and the
 * committed entitlement files and electron-builder.yml they act on.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DISABLE_LIBRARY_VALIDATION,
  SigningError,
  buildInfoFor,
  checkArtifacts,
  checkHelper,
  checkSignature,
  entitlementKeys,
  helperArch,
  macSigningOptions,
  planSigning,
  readAssessment,
  readIdentities,
  readSignature,
  withLibraryValidationDisabled,
  type SigningInput,
} from "../scripts/signing.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const DEVELOPMENT = "Apple Development: Jane Appleseed (FGHIJ67890)";
const DEVELOPER_ID = "Developer ID Application: Example Co (ABCDE12345)";
const API_KEY = {
  APPLE_API_KEY: "/keys/AuthKey_ABC123.p8",
  APPLE_API_KEY_ID: "ABC123",
  APPLE_API_ISSUER: "issuer-uuid",
};

const PATHS = { app: "/repo/build/entitlements.mac.plist", inherit: "/repo/build/inherit.plist" };
/** Stands in for @electron/osx-sign's signAsync. */
const noSign = async () => {};

const plan = (input: Partial<SigningInput> = {}) =>
  planSigning({
    platform: "darwin",
    hostArch: "arm64",
    env: {},
    identities: [DEVELOPMENT],
    fileExists: (file) => file === API_KEY.APPLE_API_KEY,
    ...input,
  });

/** The refusal a plan throws, as the two lines package.mjs prints. */
function refusal(input: Partial<SigningInput>): { message: string; hint: string } {
  try {
    plan(input);
  } catch (err) {
    if (err instanceof SigningError) return { message: err.message, hint: err.hint };
    throw err;
  }
  throw new Error("expected planSigning to refuse");
}

describe("planSigning: a local build", () => {
  it("is ad-hoc signed for this machine with the hardened runtime, and can only notify about updates", () => {
    expect(plan()).toMatchObject({
      mode: "local",
      identity: "-",
      hardenedRuntime: true,
      notarize: false,
      disableLibraryValidation: true,
      forceCodeSigning: false,
      timestamp: false,
      strict: false,
      build: { signing: "adhoc", updates: "notify" },
      archs: ["arm64"],
      targets: ["dmg"],
    });
    expect(plan({ hostArch: "x64", dir: true })).toMatchObject({
      archs: ["x64"],
      targets: ["dir"],
    });
    expect(plan({ arch: "arm64,x64" }).archs).toEqual(["arm64", "x64"]);
    expect(plan({ platform: "win32", hostArch: "x64" })).toMatchObject({
      targets: ["nsis"],
      build: { signing: "none", updates: "notify" },
    });
    expect(plan({ platform: "linux", hostArch: "x64" }).targets).toEqual(["AppImage"]);
  });

  it("ignores every credential in the shell, and cuts electron-builder off from them", () => {
    const env = { CSC_LINK: "/certs/developer-id.p12", CSC_KEY_PASSWORD: "x", ...API_KEY };
    const local = plan({ env, identities: [DEVELOPMENT, DEVELOPER_ID] });
    expect(local).toMatchObject({ mode: "local", identity: "-", notarize: false });
    // electron-builder imports CSC_LINK into a temporary keychain even for an ad-hoc build.
    for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "CSC_KEYCHAIN"]) {
      expect(local.scrubEnv, name).toContain(name);
    }
    // It also skips every signature on a pull request unless told an ad-hoc one is safe there.
    expect(local.setEnv).toEqual({ CSC_FOR_PULL_REQUEST: "true" });
    const packageScript = read("../scripts/package.mjs");
    expect(packageScript).toContain("for (const name of plan.scrubEnv) delete process.env[name];");
    expect(packageScript).toContain("Object.assign(process.env, plan.setEnv);");
  });

  it("stays ad-hoc on a Mac whose keychain has a certificate with a hyphen in its name", async () => {
    // electron-builder looks "-" up as part of a name first, and would sign with either of these.
    const identities = ["gdb-cert", "Apple Development: Anne-Marie Example (FGHIJ67890)"];
    const local = plan({ identities });
    expect(local).toMatchObject({ mode: "local", identity: "-", certificate: undefined });
    const signed: Record<string, unknown>[] = [];
    const options = macSigningOptions(local, PATHS, async (opts) => void signed.push(opts));
    // What electron-builder hands a `sign` function: the certificate it found, by its SHA-1, with
    // the options it would have signed with.
    const optionsForFile = () => ({ hardenedRuntime: true, entitlements: PATHS.app });
    const found = {
      app: "/release/mac-arm64/Sonobe.app",
      identity: "0F".repeat(20),
      optionsForFile,
    };
    await (options.sign as (opts: typeof found) => Promise<void>)(found);
    expect(signed).toEqual([{ app: found.app, identity: "-", optionsForFile }]);
    // And the build's own gate passes the result, where a signature from that certificate wouldn't.
    expect(checkSignature(local, readSignature(ADHOC))).toBeNull();
    expect(checkSignature(local, readSignature(signedBy("gdb-cert", "not set", "")))?.message).toBe(
      'The local build has a signature from "gdb-cert", and a local build is ad-hoc signed.',
    );
    // A rehearsal or a release signs with the certificate it names, through electron-builder.
    const rehearsal = plan({ identity: "gdb-cert", identities });
    expect(rehearsal).toMatchObject({ identity: "gdb-cert", certificate: "gdb-cert" });
    expect(macSigningOptions(rehearsal, PATHS, noSign)).not.toHaveProperty("sign");
    const release = plan({
      release: true,
      env: API_KEY,
      identities: [...identities, DEVELOPER_ID],
    });
    expect(macSigningOptions(release, PATHS, noSign)).not.toHaveProperty("sign");
    expect(read("../scripts/package.mjs")).toContain(
      'createRequire(builderLib)("@electron/osx-sign")',
    );
  });

  it("names the architectures --arch takes", () => {
    expect(refusal({ arch: "ppc" }).message).toBe(
      "--arch must be arm64, x64, universal, or arm64,x64 (got ppc).",
    );
    expect(refusal({ arch: "universal,x64" }).message).toMatch(/^--arch must be/);
    expect(refusal({ platform: "win32", arch: "universal" }).message).toBe(
      "--arch universal is for macOS builds.",
    );
    expect(helperArch(["arm64"])).toBe("arm64");
    expect(helperArch(["universal"])).toBe("universal");
    expect(helperArch(["arm64", "x64"])).toBe("universal");
  });
});

describe("planSigning: a release", () => {
  const release = (input: Partial<SigningInput> = {}) => plan({ release: true, ...input });

  it("refuses this Mac's development certificate by name, and says how to get a Developer ID", () => {
    const { message, hint } = refusal({ release: true, env: { APPLE_KEYCHAIN_PROFILE: "sonobe" } });
    expect(message).toContain(`"${DEVELOPMENT}"`);
    expect(message).toContain('"Developer ID Application" certificate');
    expect(message).toContain("Gatekeeper rejects");
    expect(hint).toMatch(/CSC_LINK .* and CSC_KEY_PASSWORD/);
    expect(hint).toContain("--identity");
    expect(refusal({ release: true, env: API_KEY, identities: [] }).message).toContain(
      "has no code signing certificate",
    );
  });

  it("refuses to build without complete notarization credentials", () => {
    const withId = { identities: [DEVELOPER_ID], release: true };
    expect(refusal({ ...withId }).message).toBe(
      "A release must be notarized, and no notarization credentials are set.",
    );
    expect(refusal({ ...withId }).hint).toContain("APPLE_KEYCHAIN_PROFILE");
    expect(refusal({ ...withId, env: { APPLE_API_KEY_ID: "ABC123" } }).message).toBe(
      "A release is notarized with an App Store Connect API key, and APPLE_API_KEY and APPLE_API_ISSUER aren't set.",
    );
    expect(refusal({ ...withId, env: { APPLE_ID: "me@example.com" } }).message).toBe(
      "A release is notarized with an Apple ID, and APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID aren't set.",
    );
    const pem = { ...API_KEY, APPLE_API_KEY: "-----BEGIN PRIVATE KEY-----\nMIG…" };
    expect(refusal({ ...withId, env: pem })).toEqual({
      message: "APPLE_API_KEY doesn't name a file that exists.",
      hint: "Set APPLE_API_KEY to the path of the .p8 file (AuthKey_XXXXXXXXXX.p8), not to its contents.",
    });
  });

  it("signs with the one Developer ID in the keychain, named so no other certificate can match", () => {
    const built = release({ env: API_KEY, identities: [DEVELOPMENT, DEVELOPER_ID] });
    expect(built).toMatchObject({
      mode: "release",
      // electron-builder adds the prefix itself, and refuses a name that has it.
      identity: "Example Co (ABCDE12345)",
      certificate: DEVELOPER_ID,
      hardenedRuntime: true,
      notarize: true,
      disableLibraryValidation: false,
      forceCodeSigning: true,
      timestamp: true,
      strict: true,
      build: { signing: "developer-id", updates: "install" },
      archs: ["arm64", "x64"],
      targets: ["dmg", "zip"],
      scrubEnv: [],
      setEnv: {},
    });
    expect(built.label).toContain(DEVELOPER_ID);
    expect(
      release({ env: { APPLE_KEYCHAIN_PROFILE: "sonobe" }, identities: [DEVELOPER_ID] }).label,
    ).toContain('the keychain profile "sonobe"');
    expect(release({ env: API_KEY, identities: [DEVELOPER_ID], arch: "arm64" }).archs).toEqual([
      "arm64",
    ]);
  });

  it("asks which certificate when the keychain has two Developer IDs, and takes CSC_NAME's", () => {
    const other = "Developer ID Application: Other Co (ZYXWV98765)";
    const identities = [DEVELOPER_ID, other];
    expect(refusal({ release: true, env: API_KEY, identities })).toMatchObject({
      message: expect.stringContaining("has 2 Developer ID certificates"),
      hint: expect.stringContaining("CSC_NAME"),
    });
    const picked = release({ env: { ...API_KEY, CSC_NAME: "ZYXWV98765" }, identities });
    expect(picked.identity).toBe("Other Co (ZYXWV98765)");
    expect(
      refusal({ release: true, env: { ...API_KEY, CSC_NAME: "Nobody" }, identities }).message,
    ).toContain('CSC_NAME is "Nobody"');
  });

  it("says a name can't choose between two certificates that share one, and what can", () => {
    // A renewed certificate installed beside the old one.
    const identities = [DEVELOPER_ID, DEVELOPER_ID];
    for (const env of [API_KEY, { ...API_KEY, CSC_NAME: "ABCDE12345" }]) {
      expect(refusal({ release: true, env, identities })).toEqual({
        message: `This Mac has 2 Developer ID certificates named "${DEVELOPER_ID}", and a release signs with exactly one.`,
        hint: "CSC_NAME can't choose between them. Delete the one you don't sign with in Keychain Access (the expiry dates tell them apart), or pass the certificate as a file with CSC_LINK and CSC_KEY_PASSWORD.",
      });
    }
    expect(refusal({ identity: "Jane", identities: [DEVELOPMENT, DEVELOPMENT] })).toEqual({
      message: `--identity "Jane" matches 2 certificates with the same name, "${DEVELOPMENT}".`,
      hint: "Delete the one you don't sign with in Keychain Access (the expiry dates tell them apart), then build again.",
    });
    // One certificate that sits in two keychains is one certificate: `security` lists it twice.
    const listed = [
      `  1) ${"AB".repeat(20)} "${DEVELOPER_ID}"`,
      `  2) ${"CD".repeat(20)} "${DEVELOPMENT}"`,
      `  3) ${"AB".repeat(20)} "${DEVELOPER_ID}"`,
      "     3 valid identities found",
    ].join("\n");
    expect(readIdentities(listed)).toEqual([DEVELOPER_ID, DEVELOPMENT]);
    expect(readIdentities("     0 valid identities found\n")).toEqual([]);
    expect(release({ env: API_KEY, identities: readIdentities(listed) }).certificate).toBe(
      DEVELOPER_ID,
    );
    expect(read("../scripts/package.mjs")).toContain('readIdentities(found.stdout ?? "")');
  });

  it("leaves the identity to electron-builder when CSC_LINK supplies the certificate", () => {
    const ci = release({
      env: { ...API_KEY, CSC_LINK: "base64…", CSC_KEY_PASSWORD: "x" },
      identities: [],
    });
    expect(ci).toMatchObject({
      identity: undefined,
      notarize: true,
      forceCodeSigning: true,
      build: { signing: "developer-id", updates: "install" },
    });
    expect(ci.label).toContain("CSC_LINK");
    expect(macSigningOptions(ci, PATHS, noSign)).not.toHaveProperty("identity");
  });

  it("refuses flags that would make it less than a release, and other platforms", () => {
    const env = API_KEY;
    const identities = [DEVELOPER_ID];
    expect(refusal({ release: true, identity: "Example", env, identities }).message).toBe(
      "--release and --identity don't go together.",
    );
    expect(refusal({ release: true, dir: true, env, identities }).message).toMatch(
      /--dir doesn't apply/,
    );
    expect(refusal({ release: true, skipEditorBuild: true, env, identities }).message).toMatch(
      /--skip-editor-build doesn't apply/,
    );
    expect(refusal({ release: true, platform: "win32", env, identities }).message).toBe(
      "--release builds are macOS only for now.",
    );
    expect(refusal({ identity: "Example", platform: "linux" }).message).toBe(
      "--identity builds are macOS only for now.",
    );
  });
});

describe("planSigning: a rehearsal", () => {
  it("signs with the one certificate the name matches, never notarizes, and says it isn't distributable", () => {
    const rehearsal = plan({
      identity: "Apple Development: Jane Appleseed",
      env: { ...API_KEY, CSC_LINK: "x" },
    });
    expect(rehearsal).toMatchObject({
      mode: "rehearsal",
      identity: DEVELOPMENT,
      certificate: DEVELOPMENT,
      hardenedRuntime: true,
      notarize: false,
      disableLibraryValidation: false,
      forceCodeSigning: true,
      timestamp: false,
      strict: true,
      build: { signing: "identity", updates: "install" },
      archs: ["arm64"],
      targets: ["dmg", "zip"],
    });
    expect(rehearsal.label).toContain("not notarized: do not distribute");
    // With CSC_LINK left in the environment electron-builder would search only that certificate's keychain.
    expect(rehearsal.scrubEnv).toContain("CSC_LINK");
    expect(plan({ identity: "Jane", dir: true, arch: "arm64,x64" })).toMatchObject({
      targets: ["dir"],
      archs: ["arm64", "x64"],
    });
    const developerId = plan({ identity: "ABCDE12345", identities: [DEVELOPMENT, DEVELOPER_ID] });
    expect(developerId).toMatchObject({
      identity: "Example Co (ABCDE12345)",
      notarize: false,
      build: { signing: "developer-id", updates: "install" },
    });
  });

  it("takes a stand-in version and the variables its Info.plist sets, for the two builds an update is tried between", () => {
    const rehearsal = plan({
      identity: "Jane",
      out: "/tmp/rehearsal/n1",
      version: "0.1.1",
      launchEnv: ["SONOBE_USER_DATA=/tmp/rehearsal/userData", "SONOBE_UPDATE_FEED=http://127.0.0.1:5250/?a=b"],
    });
    expect(rehearsal).toMatchObject({
      mode: "rehearsal",
      version: "0.1.1",
      launchEnv: { SONOBE_USER_DATA: "/tmp/rehearsal/userData", SONOBE_UPDATE_FEED: "http://127.0.0.1:5250/?a=b" },
    });
    // Without them a rehearsal builds the tree's version and bakes nothing in, so it runs like any app.
    expect(plan({ identity: "Jane" })).toMatchObject({ version: undefined, launchEnv: {} });
    expect(plan()).toMatchObject({ version: undefined, launchEnv: {} });
  });

  it("refuses a version that isn't three numbers, and a variable that isn't one of Sonobe's", () => {
    expect(refusal({ identity: "Jane", version: "0.1.1-beta.1" })).toEqual({
      message: "--version must be three numbers, like 0.1.1 (got 0.1.1-beta.1).",
      hint: "The update feed is stable-only, so a version has no -beta or build suffix.",
    });
    for (const entry of ["PATH=/usr/bin", "SONOBE_HOME", "SONOBE_HOME=", "sonobe_home=/tmp/h"]) {
      const refused = refusal({ identity: "Jane", launchEnv: [entry] });
      expect(refused.message, entry).toBe(`--launch-env takes SONOBE_NAME=value (got ${entry}).`);
      expect(refused.hint).toContain("--launch-env SONOBE_USER_DATA=");
    }
  });

  it("keeps them out of a release and out of a local build", () => {
    const release = { release: true, env: API_KEY, identities: [DEVELOPER_ID] };
    expect(refusal({ ...release, version: "0.1.1" })).toEqual({
      message: "--version is for a rehearsal build, and this is a release build.",
      hint: "A release takes its version from the tree (node scripts/set-version.ts) and carries no environment of its own. Drop the flag.",
    });
    expect(refusal({ ...release, launchEnv: ["SONOBE_HOME=/tmp/h"] }).message).toBe(
      "--launch-env is for a rehearsal build, and this is a release build.",
    );
    expect(refusal({ version: "0.1.1", launchEnv: ["SONOBE_HOME=/tmp/h"] })).toEqual({
      message: "--version and --launch-env are for a rehearsal build, and this is a local build.",
      hint: 'Add --identity "<name>" to build a rehearsal: signed with that certificate, not notarized, not distributable.',
    });
    // A release empties its output folder first, so it only ever builds into apps/desktop/release.
    expect(refusal({ ...release, out: "/Users/me/Desktop" }).message).toMatch(/--out doesn't apply/);
    expect(plan({ out: "/tmp/local" }).mode).toBe("local");
  });

  it("lists the keychain's certificates when the name matches none or several", () => {
    expect(refusal({ identity: "Nobody" })).toEqual({
      message: '--identity "Nobody" matches no code signing certificate in this Mac\'s keychain.',
      hint: `This Mac has "${DEVELOPMENT}". Pass enough of one name to match it alone (\`security find-identity -v -p codesigning\` lists them).`,
    });
    const several = refusal({ identity: "e", identities: [DEVELOPMENT, DEVELOPER_ID] });
    expect(several.message).toContain("matches 2 certificates");
    expect(several.hint).toContain(DEVELOPER_ID);
    expect(refusal({ identity: "Jane", identities: [] }).hint).toContain(
      "no code signing certificate at all",
    );
  });
});

// `codesign -dv --verbose=4`, trimmed to the lines that differ between builds. The ad-hoc sample is a
// local build's; the other two follow the same report for a keychain certificate.
const ADHOC = `Executable=/tmp/release/mac-arm64/Sonobe.app/Contents/MacOS/Sonobe
Identifier=dev.sonobe.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=431 flags=0x10002(adhoc,runtime) hashes=3+7 location=embedded
Signature=adhoc
Info.plist entries=33
TeamIdentifier=not set
Runtime Version=26.0.0
Sealed Resources version=2 rules=13 files=31
`;
const UNHARDENED = ADHOC.replace("flags=0x10002(adhoc,runtime)", "flags=0x2(adhoc)");
const signedBy = (
  authority: string,
  team: string,
  timestamp: string,
) => `Executable=/tmp/release/mac-arm64/Sonobe.app/Contents/MacOS/Sonobe
Identifier=dev.sonobe.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=431 flags=0x10000(runtime) hashes=3+7 location=embedded
Signature size=9046
Authority=${authority}
Authority=Apple Worldwide Developer Relations Certification Authority
Authority=Apple Root CA
${timestamp}Info.plist entries=33
TeamIdentifier=${team}
Runtime Version=26.0.0
`;
const APPLE_DEVELOPMENT = signedBy(
  DEVELOPMENT,
  "KLMNO24680",
  "Signed Time=Oct 8, 2026 at 10:00:00 PM\n",
);
const DEVELOPER_ID_SIGNED = signedBy(
  DEVELOPER_ID,
  "ABCDE12345",
  "Timestamp=Oct 8, 2026 at 10:00:00 PM\n",
);

describe("reading a signature back", () => {
  it("tells ad-hoc, a development certificate and a Developer ID apart, with the hardened runtime flag", () => {
    expect(readSignature(ADHOC)).toEqual({
      kind: "adhoc",
      authority: undefined,
      teamId: undefined,
      hardened: true,
      timestamped: false,
    });
    expect(readSignature(UNHARDENED)).toMatchObject({ kind: "adhoc", hardened: false });
    expect(readSignature(APPLE_DEVELOPMENT)).toEqual({
      kind: "other",
      authority: DEVELOPMENT,
      teamId: "KLMNO24680",
      hardened: true,
      timestamped: false,
    });
    expect(readSignature(DEVELOPER_ID_SIGNED)).toEqual({
      kind: "developer-id",
      authority: DEVELOPER_ID,
      teamId: "ABCDE12345",
      hardened: true,
      timestamped: true,
    });
    // An unsigned bundle: codesign prints only "code object is not signed at all".
    expect(readSignature("Sonobe.app: code object is not signed at all\n")).toMatchObject({
      kind: "other",
      authority: undefined,
      hardened: false,
    });
  });

  it("holds each build to its plan before anything is packaged for download", () => {
    const env = API_KEY;
    const release = plan({ release: true, env, identities: [DEVELOPER_ID] });
    expect(checkSignature(release, readSignature(DEVELOPER_ID_SIGNED))).toBeNull();
    // electron-builder's Developer ID lookup falls back to a development certificate, and skips
    // signing altogether on a pull request, without failing the build.
    expect(checkSignature(release, readSignature(APPLE_DEVELOPMENT))).toMatchObject({
      message: `The release build has a signature from "${DEVELOPMENT}", not one from a Developer ID Application certificate.`,
      hint: expect.stringContaining("nothing was packaged for download"),
    });
    expect(checkSignature(release, readSignature(ADHOC))?.message).toContain("an ad-hoc signature");

    const rehearsal = plan({ identity: "Jane" });
    expect(checkSignature(rehearsal, readSignature(APPLE_DEVELOPMENT))).toBeNull();
    expect(checkSignature(rehearsal, readSignature(ADHOC))?.message).toBe(
      `The rehearsal build has an ad-hoc signature, not one from "${DEVELOPMENT}".`,
    );
    expect(checkSignature(rehearsal, readSignature(DEVELOPER_ID_SIGNED))).toBeInstanceOf(
      SigningError,
    );

    const local = plan();
    expect(checkSignature(local, readSignature(ADHOC))).toBeNull();
    expect(checkSignature(local, readSignature(UNHARDENED))?.message).toBe(
      "The local build doesn't have the hardened runtime flag, and it should.",
    );
    expect(checkSignature(local, readSignature(DEVELOPER_ID_SIGNED))?.message).toContain(
      "a local build is ad-hoc signed",
    );
  });
});

describe("what a release or rehearsal must hold", () => {
  const release = plan({ release: true, env: API_KEY, identities: [DEVELOPER_ID] });
  const rehearsal = plan({ identity: "Jane" });

  it("has the SF Symbols helper for every architecture it packages; a local build goes without", () => {
    expect(checkHelper(release, ["x86_64", "arm64"])).toBeNull();
    expect(checkHelper(release, ["arm64"])).toMatchObject({
      message:
        "The SF Symbols helper was built for arm64 only, without x86_64, and a release build never ships without it.",
      hint: expect.stringContaining("xcode-select --install"),
    });
    expect(checkHelper(rehearsal, [])?.message).toBe(
      "The SF Symbols helper wasn't built, and a rehearsal build never ships without it.",
    );
    expect(checkHelper(rehearsal, ["arm64"])).toBeNull();
    const universal = plan({ identity: "Jane", arch: "universal" });
    expect(checkHelper(universal, ["x86_64"])?.message).toContain("without arm64");
    expect(checkHelper(plan(), [])).toBeNull();
    expect(read("../scripts/package.mjs")).toContain("checkHelper(plan, slices)");
  });

  it("has each architecture's DMG, zip and blockmap, and a feed that lists every zip", () => {
    const files = (arch: string, suffix = "") => [
      `Sonobe-0.2.0-mac-${arch}${suffix}.dmg`,
      `Sonobe-0.2.0-mac-${arch}${suffix}.zip`,
      `Sonobe-0.2.0-mac-${arch}${suffix}.zip.blockmap`,
    ];
    const both = [...files("arm64"), ...files("x64"), "latest-mac.yml", "mac-arm64", "mac"];
    const feed = "files:\n  - url: Sonobe-0.2.0-mac-arm64.zip\n  - url: Sonobe-0.2.0-mac-x64.zip\n";
    expect(checkArtifacts(release, "0.2.0", both, feed)).toBeNull();
    // A second electron-builder run overwrites the first's feed: one that lists a single zip.
    expect(
      checkArtifacts(release, "0.2.0", both, feed.replace(/  - url: \S+x64\.zip\n/, "")),
    ).toMatchObject({
      message:
        "The release build is incomplete: release/ has no Sonobe-0.2.0-mac-x64.zip in latest-mac.yml.",
      hint: expect.stringContaining("upload nothing from this run"),
    });
    const noBlockmap = both.filter((name) => name !== "Sonobe-0.2.0-mac-arm64.zip.blockmap");
    expect(checkArtifacts(release, "0.2.0", noBlockmap, feed)?.message).toBe(
      "The release build is incomplete: release/ has no Sonobe-0.2.0-mac-arm64.zip.blockmap.",
    );
    expect(checkArtifacts(release, "0.2.0", [], "")?.message).toContain(
      "Sonobe-0.2.0-mac-arm64.dmg, Sonobe-0.2.0-mac-arm64.zip, Sonobe-0.2.0-mac-arm64.zip.blockmap, Sonobe-0.2.0-mac-arm64.zip in latest-mac.yml, Sonobe-0.2.0-mac-x64.dmg",
    );
    // A rehearsal's files are named so, and it builds this machine's architecture alone.
    const rehearsed = files("arm64", "-rehearsal");
    const rehearsedFeed = "files:\n  - url: Sonobe-0.2.0-mac-arm64-rehearsal.zip\n";
    expect(checkArtifacts(rehearsal, "0.2.0", rehearsed, rehearsedFeed)).toBeNull();
    expect(checkArtifacts(rehearsal, "0.2.0", files("arm64"), feed)?.message).toContain(
      "The rehearsal build is incomplete",
    );
    expect(read("../scripts/package.mjs")).toContain(
      "checkArtifacts(plan, version, readdirSync(release), feed)",
    );
  });
});

describe("what verify-package.mjs holds a build to", () => {
  it("expects the update capability each plan records, from the signature alone", () => {
    const env = API_KEY;
    const built = [
      [plan(), ADHOC],
      [plan({ identity: "Jane" }), APPLE_DEVELOPMENT],
      [plan({ identity: "Example Co", identities: [DEVELOPER_ID] }), DEVELOPER_ID_SIGNED],
      [plan({ release: true, env, identities: [DEVELOPER_ID] }), DEVELOPER_ID_SIGNED],
    ] as const;
    for (const [planned, codesign] of built) {
      expect(buildInfoFor(readSignature(codesign)), planned.mode).toEqual(planned.build);
    }
    expect(buildInfoFor(readSignature(ADHOC))).toEqual({ signing: "adhoc", updates: "notify" });
  });

  it("reads Gatekeeper's verdict, and knows when Gatekeeper is off and says nothing", () => {
    // spctl --assess --type execute -vv, as captured from a notarized app and from a local build.
    expect(
      readAssessment(
        "/Applications/Sonobe.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Example Co (ABCDE12345)\n",
      ),
    ).toEqual({ accepted: true, source: "Notarized Developer ID", gatekeeperOff: false });
    expect(readAssessment("/tmp/release/mac-arm64/Sonobe.app: rejected\n")).toEqual({
      accepted: false,
      source: undefined,
      gatekeeperOff: false,
    });
    // Not captured here (no Developer ID build exists yet): a signed build that was never notarized,
    // and any app after `spctl --master-disable`, which accepts everything whatever its signature.
    expect(
      readAssessment(
        "/tmp/release/mac-arm64/Sonobe.app: rejected\nsource=Unnotarized Developer ID\n",
      ),
    ).toMatchObject({ accepted: false, source: "Unnotarized Developer ID" });
    expect(
      readAssessment("/tmp/release/mac-arm64/Sonobe.app: accepted\noverride=security disabled\n"),
    ).toEqual({ accepted: true, source: undefined, gatekeeperOff: true });
  });
});

describe("the entitlements", () => {
  const files = ["../build/entitlements.mac.plist", "../build/entitlements.mac.inherit.plist"];
  const NEEDED = [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.device.camera",
    "com.apple.security.device.audio-input",
  ];

  it("are the JIT, camera and microphone ones, for the app and for everything inside it", () => {
    for (const file of files) {
      const text = read(file);
      expect(entitlementKeys(text), file).toEqual(NEEDED);
      // Exactly these: nothing for unsigned executable memory, library validation, debugging,
      // location or Apple Events.
      expect(text.match(/<key>/g), file).toHaveLength(NEEDED.length);
    }
  });

  it("gain library validation off, and nothing else, for an ad-hoc build", () => {
    for (const file of files) {
      const text = read(file);
      const adhoc = withLibraryValidationDisabled(text);
      expect(entitlementKeys(adhoc), file).toEqual([...NEEDED, DISABLE_LIBRARY_VALIDATION]);
      expect(adhoc.replace(`  <key>${DISABLE_LIBRARY_VALIDATION}</key>\n  <true/>\n`, "")).toBe(
        text,
      );
      expect(withLibraryValidationDisabled(adhoc)).toBe(adhoc);
    }
  });

  it("reach electron-builder as absolute paths, with the plan's signing options", () => {
    expect(macSigningOptions(plan(), PATHS, noSign)).toEqual({
      identity: "-",
      hardenedRuntime: true,
      notarize: false,
      entitlements: PATHS.app,
      entitlementsInherit: PATHS.inherit,
      timestamp: "none",
      // An ad-hoc build is signed here, not by electron-builder's certificate lookup.
      sign: expect.any(Function),
    });
    const release = plan({ release: true, env: API_KEY, identities: [DEVELOPER_ID] });
    expect(macSigningOptions(release, PATHS, noSign)).toEqual({
      identity: "Example Co (ABCDE12345)",
      hardenedRuntime: true,
      notarize: true,
      entitlements: PATHS.app,
      entitlementsInherit: PATHS.inherit,
    });
    // electron-builder passes a relative path to codesign as written, so it would depend on the
    // folder package.mjs was started from.
    expect(() =>
      macSigningOptions(plan(), { ...PATHS, app: "build/entitlements.mac.plist" }, noSign),
    ).toThrow(/must be absolute/);
  });
});

describe("electron-builder.yml", () => {
  const yml = read("../electron-builder.yml");
  const setting = (key: string) => new RegExp(`^\\s*${key}:`, "m");

  it("leaves signing to package.mjs: a value set there couldn't be unset from the script", () => {
    for (const key of [
      "identity",
      "hardenedRuntime",
      "notarize",
      "entitlements",
      "entitlementsInherit",
    ]) {
      expect(yml, key).not.toMatch(setting(key));
    }
    expect(yml).not.toMatch(setting("forceCodeSigning"));
    const packageScript = read("../scripts/package.mjs");
    expect(packageScript).toContain("mac: { ...macSigningOptions(plan, entitlements, signAsync),");
    expect(packageScript).toContain('publish: "never"');
    expect(packageScript).not.toMatch(/publish: "(always|onTag|onTagOrDraft)"/);
  });

  it("ships Sonobe's own permission wording, English only on macOS, the licenses, and no editor source maps", () => {
    const usage = (key: string) => new RegExp(`^    ${key}: (.+)$`, "m").exec(yml)?.[1] ?? "";
    expect(usage("NSCameraUsageDescription")).toMatch(/Camera patch/);
    expect(usage("NSMicrophoneUsageDescription")).toMatch(/Microphone patch/);
    // Electron's own strings start "This app needs access to".
    for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription"]) {
      expect(usage(key), key).not.toMatch(/^This app needs/);
    }
    // Under mac only: at the top level the same list would delete en-US.pak on Windows and Linux.
    expect(yml).toMatch(/^mac:\n(?:(?:  .*|#.*)?\n)*?  electronLanguages:\n    - en\n/m);
    expect(yml).not.toMatch(/^electronLanguages:/m);
    expect(yml).toMatch(
      /- from: \.\.\/editor\/dist\s+to: editor\s+filter:\s+- "\*\*\/\*"\s+- "!\*\*\/\*\.map"/,
    );
    expect(yml).toMatch(/- from: dist\/licenses\s+to: licenses/);
    expect(yml).toContain('- "!dist/licenses/**"');
    expect(read("../scripts/package.mjs")).toContain('"--licenses"');
  });

  it("names the release feed and builds what an update downloads, while nothing publishes from a build", () => {
    expect(yml).toMatch(/^publish:\n  provider: github\n  owner: thats2easyyy\n  repo: sonobe\n/m);
    expect(yml).toMatch(
      /^  target:\n    - target: dmg\n      arch: \[arm64, x64\]\n    - target: zip\n/m,
    );
    const packageScript = read("../scripts/package.mjs");
    // What the build can do with an update, for the app to read from its packaged package.json, under the
    // name that makes the update cache folder sonobe-updater (electron-builder derives it from the name).
    expect(packageScript).toContain('extraMetadata: { name: "sonobe", sonobe: plan.build, ...(plan.version ? { version: plan.version } : {}) }');
    expect(read("../scripts/verify-package.mjs")).toContain("/^updaterCacheDirName: sonobe-updater$/m");
    // A rehearsal's variables reach Info.plist, and the build refuses to run without them.
    expect(packageScript).toContain("extendInfo: { LSEnvironment: plan.launchEnv }");
    expect(packageScript).toContain('["--require-env", launchEnvNames.join(",")]');
    expect(read("../scripts/build.mjs")).toContain('__SONOBE_LAUNCH_ENV__: JSON.stringify(requiredEnv.join(","))');
    expect(read("./main.ts")).toContain('launchEnvProblem(__SONOBE_LAUNCH_ENV__.split(",").filter(Boolean), process.env)');
    expect(packageScript).toContain(
      'rmSync(path.join(resources, "default_app.asar"), { force: true });',
    );
  });
});
