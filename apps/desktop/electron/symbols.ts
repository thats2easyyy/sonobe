/**
 * SF Symbols for design imports. The sfsymbol helper (native/sfsymbol, compiled by scripts/build.mjs into
 * dist/bin and shipped in Resources/bin) draws them with SwiftUI on macOS 13 or later. Elsewhere the
 * renderer explains why it can't, and imports keep gray placeholders with that note. Headless servers
 * use the same helper through SONOBE_SFSYMBOL (packages/mcp/src/headless.ts).
 */

import path from "node:path";
import { unavailableSymbols, type SymbolRenderer } from "@sonobe/import";
import { symbolHelper } from "@sonobe/import/node";

export interface DesktopSymbolsOptions {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** `process.resourcesPath`, where packaged builds keep `bin/` (electron-builder extraResources). */
  resourcesPath: string;
  /** The folder the main bundle runs from; development builds write `bin/` beside it. */
  mainDir: string;
  platform: string;
  /** `process.getSystemVersion()`: "15.6.1" on macOS. */
  systemVersion: string;
  exists: (file: string) => boolean;
}

/** Where the helper lives: Resources/bin/sfsymbol when packaged, else dist/bin/sfsymbol. */
export function symbolHelperPath(options: Pick<DesktopSymbolsOptions, "packaged" | "resourcesPath" | "mainDir">): string {
  return path.join(options.packaged ? options.resourcesPath : options.mainDir, "bin", "sfsymbol");
}

/** The app's SF Symbols renderer, or one whose `unavailable` says why this Mac (or this system) can't draw them. */
export function desktopSymbols(options: DesktopSymbolsOptions): SymbolRenderer {
  if (options.platform !== "darwin") return unavailableSymbols("SF Symbols come with macOS, so Sonobe draws them only on a Mac.");
  const major = Number.parseInt(options.systemVersion, 10);
  if (!(major >= 13)) return unavailableSymbols(`Drawing SF Symbols needs macOS 13 or later, and this Mac has macOS ${options.systemVersion}.`);
  const helper = symbolHelperPath(options);
  if (!options.exists(helper)) {
    return unavailableSymbols(
      options.packaged
        ? `This copy of Sonobe is missing its SF Symbols helper (${helper}). Reinstall Sonobe.`
        : "The SF Symbols helper isn't built. Install Xcode's command line tools (xcode-select --install), then run node apps/desktop/scripts/build.mjs.",
    );
  }
  return symbolHelper(helper);
}
