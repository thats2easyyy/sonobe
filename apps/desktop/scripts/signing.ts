/**
 * How a desktop package is signed, decided from package.mjs's flags, the environment and the code
 * signing identities in the keychain. Nothing here runs a tool or reads a file, so the decision and
 * its refusals are unit tested (electron/signing.test.ts). package.mjs acts on the plan, and
 * verify-package.mjs reads signatures and entitlements with the same parsers.
 *
 *   local      the default: ad-hoc signed, for the Mac that built it. Credentials in the shell never
 *              change it.
 *   rehearsal  --identity "<name>": signed with a certificate from the keychain, never notarized, and
 *              named -rehearsal. For trying a real update between two signed builds; not distributable.
 *   release    --release: Developer ID, hardened runtime, notarized, DMG and zip with the update feed.
 *              It refuses anything less, because a build that only looks signed is worse than none.
 */

export type SigningMode = "local" | "rehearsal" | "release";
export type PackageArch = "arm64" | "x64" | "universal";

export interface SigningInput {
  platform: string;
  /** This machine's architecture, the default target outside a release. */
  hostArch: string;
  /** --release */
  release?: boolean;
  /** --identity <name> */
  identity?: string;
  /** --arch: arm64, x64, universal, or arm64,x64 */
  arch?: string;
  /** --dir */
  dir?: boolean;
  /** --skip-editor-build */
  skipEditorBuild?: boolean;
  env: Record<string, string | undefined>;
  /** Certificate names from `security find-identity -v -p codesigning`. */
  identities: readonly string[];
  fileExists: (file: string) => boolean;
}

/**
 * What the packaged app's package.json records under `sonobe`, so the app knows what it can do with
 * an update without running codesign: "install" replaces the app in place, which macOS allows only
 * between two builds signed by the same certificate; "notify" can only point to the download.
 */
export interface BuildInfo {
  signing: "none" | "adhoc" | "identity" | "developer-id";
  updates: "notify" | "install";
}

export interface SigningPlan {
  mode: SigningMode;
  /** One line for the build log. */
  label: string;
  /**
   * electron-builder's `mac.identity`: "-" signs ad-hoc, a name picks that certificate, and undefined
   * lets it search the temporary keychain it makes from CSC_LINK.
   */
  identity: string | undefined;
  /** The keychain certificate's full name, when the plan chose one. */
  certificate: string | undefined;
  hardenedRuntime: boolean;
  notarize: boolean;
  /** An ad-hoc signature has no Team ID, so the hardened runtime needs library validation off. */
  disableLibraryValidation: boolean;
  forceCodeSigning: boolean;
  /** No secure timestamp: the build works offline and asks Apple for nothing. */
  timestamp: boolean;
  build: BuildInfo;
  archs: PackageArch[];
  /** electron-builder targets, the same for every architecture. */
  targets: string[];
  /** A failed editor build, a missing SF Symbols helper or a skipped signature stops the build. */
  strict: boolean;
  /** Variables package.mjs deletes before building, so electron-builder can't act on them. */
  scrubEnv: string[];
  /** Variables package.mjs sets before building. */
  setEnv: Record<string, string>;
}

/** A refusal: `message` says what is wrong, `hint` what to do about it. */
export class SigningError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "SigningError";
    this.hint = hint;
  }
}

const DEVELOPER_ID = "Developer ID Application:";
/** electron-builder refuses an identity that starts with one of these: it adds the prefix itself. */
const APPLE_PREFIXES = [
  DEVELOPER_ID,
  "Developer ID Installer:",
  "3rd Party Mac Developer Application:",
  "3rd Party Mac Developer Installer:",
];
/**
 * What electron-builder reads when it signs. Outside a release they are removed: with CSC_LINK set
 * it imports that certificate into a temporary keychain even for an ad-hoc build.
 */
const CERTIFICATE_ENV = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_NAME",
  "CSC_KEYCHAIN",
  "CSC_INSTALLER_LINK",
  "CSC_INSTALLER_KEY_PASSWORD",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
];

const withoutPrefix = (name: string): string => {
  const prefix = APPLE_PREFIXES.find((candidate) => name.startsWith(candidate));
  return prefix ? name.slice(prefix.length).trim() : name;
};

const list = (names: readonly string[]): string =>
  names.length ? names.map((name) => `"${name}"`).join(", ") : "no code signing certificate at all";

function planArchs(input: SigningInput, mode: SigningMode): PackageArch[] {
  const host: PackageArch = input.hostArch === "arm64" ? "arm64" : "x64";
  if (input.arch === undefined) return mode === "release" ? ["arm64", "x64"] : [host];
  const asked = input.arch.split(",").map((arch) => arch.trim());
  const known = asked.every((arch) => arch === "arm64" || arch === "x64" || arch === "universal");
  const alone = asked.length === 1 || (!asked.includes("universal") && new Set(asked).size === 2);
  if (!known || !alone) {
    throw new SigningError(
      `--arch must be arm64, x64, universal, or arm64,x64 (got ${input.arch}).`,
      "One run can build both Mac architectures: --arch arm64,x64 writes one update feed that lists both.",
    );
  }
  if (input.platform !== "darwin" && (asked.length > 1 || asked[0] === "universal")) {
    throw new SigningError(
      `--arch ${input.arch} is for macOS builds.`,
      "On Windows and Linux, build one architecture per run: --arch x64 or --arch arm64.",
    );
  }
  return asked as PackageArch[];
}

/** The notary credential a release will use, in the order electron-builder looks for them. */
function notaryCredential(input: SigningInput): string {
  const { env } = input;
  const missing = (names: string[]) => names.filter((name) => !env[name]);
  const partial = (set: string, names: string[]) =>
    new SigningError(
      `A release is notarized with ${set}, and ${missing(names).join(" and ")} ${missing(names).length > 1 ? "aren't" : "isn't"} set.`,
      `Set ${names.join(", ")} together, or unset them all to use another credential.`,
    );
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    const names = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
    if (missing(names).length) throw partial("an Apple ID", names);
    return "an Apple ID (APPLE_ID)";
  }
  if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) {
    const names = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
    if (missing(names).length) throw partial("an App Store Connect API key", names);
    if (!input.fileExists(env.APPLE_API_KEY!)) {
      throw new SigningError(
        "APPLE_API_KEY doesn't name a file that exists.",
        "Set APPLE_API_KEY to the path of the .p8 file (AuthKey_XXXXXXXXXX.p8), not to its contents.",
      );
    }
    return "an App Store Connect API key (APPLE_API_KEY)";
  }
  if (env.APPLE_KEYCHAIN_PROFILE) {
    return `the keychain profile "${env.APPLE_KEYCHAIN_PROFILE}" (APPLE_KEYCHAIN_PROFILE)`;
  }
  throw new SigningError(
    "A release must be notarized, and no notarization credentials are set.",
    "Set APPLE_API_KEY (the path to a .p8 file), APPLE_API_KEY_ID and APPLE_API_ISSUER; or run `xcrun notarytool store-credentials` once and set APPLE_KEYCHAIN_PROFILE to the profile's name; or set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.",
  );
}

/** The Developer ID certificate a release signs with: `identity` is undefined when CSC_LINK supplies it. */
function releaseCertificate(input: SigningInput): {
  identity: string | undefined;
  certificate: string | undefined;
} {
  // electron-builder then searches only the temporary keychain it makes from that certificate.
  if (input.env.CSC_LINK) return { identity: undefined, certificate: undefined };
  const wanted = input.env.CSC_NAME ? withoutPrefix(input.env.CSC_NAME.trim()) : "";
  const all = input.identities.filter((name) => name.startsWith(DEVELOPER_ID));
  const found = all.filter((name) => name.includes(wanted));
  if (found.length === 1) return { identity: withoutPrefix(found[0]!), certificate: found[0]! };
  if (found.length > 1) {
    throw new SigningError(
      `This Mac has ${found.length} Developer ID certificates (${list(found)}), and a release signs with exactly one.`,
      "Set CSC_NAME to the one to use, for example the team ID in its parentheses.",
    );
  }
  const others = input.identities.filter((name) => !name.startsWith(DEVELOPER_ID));
  const refused = all.length
    ? `CSC_NAME is "${input.env.CSC_NAME}", which matches none of this Mac's Developer ID certificates (${list(all)}).`
    : others.length
      ? `A release is signed with a "Developer ID Application" certificate, and this Mac's keychain has only ${list(others)}. Gatekeeper rejects an app signed with a development certificate on every other Mac, so a release refuses it.`
      : 'A release is signed with a "Developer ID Application" certificate, and this Mac\'s keychain has no code signing certificate.';
  throw new SigningError(
    refused,
    'Create a "Developer ID Application" certificate (the Apple Developer team\'s Account Holder can, at developer.apple.com/account/resources/certificates) and install it in this Mac\'s keychain; or set CSC_LINK (a .p12 file, or its base64) and CSC_KEY_PASSWORD; or build a rehearsal with --identity "<name>", which is signed but not distributable.',
  );
}

/** The plan for one package.mjs run, or a SigningError that says why it can't be built. */
export function planSigning(input: SigningInput): SigningPlan {
  const mac = input.platform === "darwin";
  const mode: SigningMode = input.release
    ? "release"
    : input.identity !== undefined
      ? "rehearsal"
      : "local";
  if (input.release && input.identity !== undefined) {
    throw new SigningError(
      "--release and --identity don't go together.",
      "A release finds its Developer ID certificate itself (CSC_NAME picks among several). --identity alone builds a rehearsal: signed, not notarized, not distributable.",
    );
  }
  if (mode !== "local" && !mac) {
    throw new SigningError(
      `${mode === "release" ? "--release" : "--identity"} builds are macOS only for now.`,
      "Windows and Linux packages are unsigned local builds: run this without the flag.",
    );
  }
  const archs = planArchs(input, mode);
  const strict = mode !== "local";

  if (mode === "local") {
    const target = mac ? "dmg" : input.platform === "win32" ? "nsis" : "AppImage";
    return {
      mode,
      label: mac
        ? "local build: ad-hoc signed with the hardened runtime, for this Mac only (not notarized, can't install updates)"
        : "local build: unsigned",
      identity: "-",
      certificate: undefined,
      hardenedRuntime: true,
      notarize: false,
      disableLibraryValidation: true,
      forceCodeSigning: false,
      timestamp: false,
      build: { signing: mac ? "adhoc" : "none", updates: "notify" },
      archs,
      targets: [input.dir ? "dir" : target],
      strict,
      scrubEnv: CERTIFICATE_ENV,
      // An ad-hoc signature uses no secret, so a pull request build may sign: electron-builder
      // otherwise skips every signature there and leaves a bundle macOS won't run.
      setEnv: { CSC_FOR_PULL_REQUEST: "true" },
    };
  }

  if (mode === "rehearsal") {
    const asked = input.identity!.trim();
    const exact = input.identities.filter((name) => name === asked);
    const found = exact.length
      ? exact
      : input.identities.filter((name) => asked !== "" && name.includes(asked));
    if (found.length !== 1) {
      throw new SigningError(
        found.length
          ? `--identity "${asked}" matches ${found.length} certificates: ${list(found)}.`
          : `--identity "${asked}" matches no code signing certificate in this Mac's keychain.`,
        `This Mac has ${list(input.identities)}. Pass enough of one name to match it alone (\`security find-identity -v -p codesigning\` lists them).`,
      );
    }
    const certificate = found[0]!;
    return {
      mode,
      label: `rehearsal build: signed with "${certificate}" for rehearsal, not notarized: do not distribute`,
      identity: withoutPrefix(certificate),
      certificate,
      hardenedRuntime: true,
      notarize: false,
      disableLibraryValidation: false,
      forceCodeSigning: true,
      timestamp: false,
      build: {
        signing: certificate.startsWith(DEVELOPER_ID) ? "developer-id" : "identity",
        updates: "install",
      },
      archs,
      targets: input.dir ? ["dir"] : ["dmg", "zip"],
      strict,
      scrubEnv: CERTIFICATE_ENV,
      setEnv: { CSC_FOR_PULL_REQUEST: "true" },
    };
  }

  if (input.dir) {
    throw new SigningError(
      "A release builds the DMG, the zip and the update feed, so --dir doesn't apply.",
      "Drop --dir, or drop --release to build an unpacked local app.",
    );
  }
  if (input.skipEditorBuild) {
    throw new SigningError(
      "A release always builds the editor, so --skip-editor-build doesn't apply.",
      "Drop --skip-editor-build: a release must never package an apps/editor/dist from an earlier commit.",
    );
  }
  const credential = notaryCredential(input);
  const { identity, certificate } = releaseCertificate(input);
  return {
    mode,
    label: `release build: ${certificate ? `signed with "${certificate}"` : "signed with the Developer ID certificate in CSC_LINK"}, hardened runtime, notarized with ${credential}`,
    identity,
    certificate,
    hardenedRuntime: true,
    notarize: true,
    disableLibraryValidation: false,
    forceCodeSigning: true,
    timestamp: true,
    build: { signing: "developer-id", updates: "install" },
    archs,
    targets: ["dmg", "zip"],
    strict,
    scrubEnv: [],
    setEnv: {},
  };
}

/**
 * electron-builder's `mac` signing options for a plan. The entitlement files must be absolute paths:
 * electron-builder hands them to codesign as written, which resolves them against wherever
 * package.mjs was started from.
 */
export function macSigningOptions(
  plan: SigningPlan,
  entitlements: { app: string; inherit: string },
): Record<string, unknown> {
  for (const file of [entitlements.app, entitlements.inherit]) {
    if (!/^(\/|[A-Za-z]:[\\/])/.test(file)) {
      throw new Error(`the entitlements path must be absolute (got ${file})`);
    }
  }
  return {
    // Left out when undefined, so electron-builder searches the keychain CSC_LINK makes.
    ...(plan.identity === undefined ? {} : { identity: plan.identity }),
    hardenedRuntime: plan.hardenedRuntime,
    notarize: plan.notarize,
    entitlements: entitlements.app,
    entitlementsInherit: entitlements.inherit,
    ...(plan.timestamp ? {} : { timestamp: "none" }),
  };
}

/** The SF Symbols helper one run needs: a single architecture's, or both slices in one file. */
export function helperArch(archs: readonly PackageArch[]): PackageArch {
  return archs.length === 1 ? archs[0]! : "universal";
}

export interface Signature {
  kind: "adhoc" | "developer-id" | "other";
  /** The signing certificate's name, the first Authority line; undefined for an ad-hoc signature. */
  authority: string | undefined;
  teamId: string | undefined;
  /** The hardened runtime flag. */
  hardened: boolean;
  timestamped: boolean;
}

/** Reads what `codesign -dv --verbose=4 <path>` prints (on stderr). */
export function readSignature(codesignText: string): Signature {
  const field = (name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(codesignText)?.[1]?.trim();
  const flags =
    /^CodeDirectory .*\bflags=\S*\(([^)]*)\)/m.exec(codesignText)?.[1]?.split(",") ?? [];
  const authority = field("Authority");
  const team = field("TeamIdentifier");
  const adhoc = field("Signature") === "adhoc" || flags.includes("adhoc");
  return {
    kind: adhoc ? "adhoc" : authority?.startsWith(DEVELOPER_ID) ? "developer-id" : "other",
    authority: adhoc ? undefined : authority,
    teamId: team && team !== "not set" ? team : undefined,
    hardened: flags.includes("runtime"),
    timestamped: /^Timestamp=/m.test(codesignText),
  };
}

/** The entitlements set to true in what `codesign -d --entitlements - --xml <path>` prints. */
export function entitlementKeys(xml: string): string[] {
  return [...xml.matchAll(/<key>([^<]+)<\/key>\s*<true\s*\/>/g)].map((match) => match[1]!);
}

export const DISABLE_LIBRARY_VALIDATION = "com.apple.security.cs.disable-library-validation";

/** An entitlements plist with library validation off as well, for ad-hoc builds. */
export function withLibraryValidationDisabled(plistText: string): string {
  const end = plistText.lastIndexOf("</dict>");
  if (end < 0) throw new Error("the entitlements file has no <dict>");
  if (plistText.includes(DISABLE_LIBRARY_VALIDATION)) return plistText;
  return `${plistText.slice(0, end)}  <key>${DISABLE_LIBRARY_VALIDATION}</key>\n  <true/>\n${plistText.slice(end)}`;
}

/**
 * Whether a signed app carries the signature its plan asked for. package.mjs runs it on every app
 * it builds, and in a release before any DMG or zip exists: electron-builder skips signing, or
 * signs with whatever certificate it finds, without failing the build.
 */
export function checkSignature(plan: SigningPlan, signature: Signature): SigningError | null {
  const has =
    signature.kind === "adhoc"
      ? "an ad-hoc signature"
      : `a signature from "${signature.authority ?? "an unknown certificate"}"`;
  if (plan.mode === "release" && signature.kind !== "developer-id") {
    return new SigningError(
      `The release build has ${has}, not one from a Developer ID Application certificate.`,
      "Gatekeeper rejects this app on every other Mac, so nothing was packaged for download. Check that CSC_LINK holds the Developer ID Application certificate with its private key, or install that certificate in this Mac's keychain.",
    );
  }
  if (plan.mode === "rehearsal") {
    const wanted = plan.certificate ?? "";
    if (signature.kind === "adhoc" || signature.authority !== wanted) {
      return new SigningError(
        `The rehearsal build has ${has}, not one from "${wanted}".`,
        "Unlock the keychain that holds the certificate and its private key (`security find-identity -v -p codesigning` must list it), then build again.",
      );
    }
  }
  if (plan.mode === "local" && signature.kind !== "adhoc") {
    return new SigningError(
      `The local build has ${has}, and a local build is ad-hoc signed.`,
      'electron-builder matched the ad-hoc identity "-" against a certificate whose name has a hyphen. Build a rehearsal with --identity "<name>" if a signed build is what you want.',
    );
  }
  if (signature.hardened !== plan.hardenedRuntime) {
    return new SigningError(
      `The ${plan.mode} build ${signature.hardened ? "has" : "doesn't have"} the hardened runtime flag, and it ${plan.hardenedRuntime ? "should" : "shouldn't"}.`,
      "Either electron-builder skipped signing (its log above says why), or electron-builder.yml sets hardenedRuntime: scripts/package.mjs passes it with the other `mac` signing options, so the yml must not.",
    );
  }
  return null;
}
