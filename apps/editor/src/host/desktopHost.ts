/** HostAdapter over the Electron preload API (`window.sonobeHost`). */

import { parseDocumentFiles } from "@sonobe/core";
import { assetBinaries, createAssetUrlCache, documentFiles, planProjectWrite, projectDisplayName } from "./projectFiles.ts";
import type { DesktopHostApi, HostAdapter } from "./types.ts";

type OpenWindow = { open?: (url?: string, target?: string, features?: string) => unknown };

export function createDesktopHost(api: DesktopHostApi): HostAdapter {
  /** Document files as last read or written, per project folder (drives minimal writes). */
  const known = new Map<string, Record<string, string>>();
  const assets = createAssetUrlCache();

  return {
    kind: "desktop",
    platform: api.platform,
    capabilities: { nativeMenus: true, nativeDialogs: true, watch: true, reveal: true, persistent: true },
    rpc: api.rpc,
    muted: api.muted === true,

    openProjectDialog: () => api.openProjectDialog(),
    saveProjectDialog: (defaultName) => api.saveProjectDialog(defaultName),

    async readProject(dir) {
      const { files, binaries } = await api.readProject(dir);
      const doc = parseDocumentFiles(files);
      known.set(dir, documentFiles(files));
      assets.setBinaries(dir, assetBinaries(binaries));
      return doc;
    },

    async writeProject(dir, doc, options = {}) {
      const plan = planProjectWrite(doc, known.get(dir));
      const from = options.copyAssetsFrom && options.copyAssetsFrom !== dir ? options.copyAssetsFrom : null;
      const binaries = assets.pending(dir, doc, from);
      if (from && !assets.hasProject(from) && Object.keys(doc.assets).length > 0) {
        const source = assetBinaries((await api.readProject(from)).binaries);
        for (const record of Object.values(doc.assets)) {
          const rel = `assets/${record.file}`;
          if (!binaries[rel] && source[rel]) binaries[rel] = source[rel];
        }
      }
      const hasBinaries = Object.keys(binaries).length > 0;
      await api.writeProject(dir, { files: plan.files, deleted: plan.deleted, ...(hasBinaries ? { binaries } : {}) });
      known.set(dir, plan.all);
      if (hasBinaries) assets.markWritten(dir, binaries);
      return { written: [...Object.keys(plan.files), ...Object.keys(binaries)], deleted: plan.deleted, unchanged: plan.unchanged };
    },

    watchProject(dir, cb) {
      return api.watchProject(dir, (change) => cb(change.paths));
    },
    revealInFinder: (path) => api.revealInFinder(path),
    recentProjects: () => api.recentProjects(),
    resolveAssetUrl: (path, file) => assets.resolve(path, file),
    putAssetBytes: (path, file, bytes) => assets.put(path, file, bytes),
    peekAssetBytes: (path, file) => assets.get(path, file),

    async readAssetBytes(path, file) {
      const held = assets.get(path, file);
      if (held || path === null) return held;
      const { binaries } = await api.readProject(path);
      const bytes = binaries[`assets/${file}`];
      if (bytes) assets.markWritten(path, { [`assets/${file}`]: bytes });
      return bytes;
    },

    async openExternal(url) {
      if (typeof api.openExternal === "function") {
        const opened = await api.openExternal(url);
        return opened !== false;
      }
      // The main process routes window.open of external links to the system browser.
      const win = typeof window === "undefined" ? undefined : (window as unknown as OpenWindow);
      if (typeof win?.open !== "function") return false;
      win.open(url, "_blank", "noopener,noreferrer");
      return true;
    },

    notifyDocumentChanged(revision) {
      try {
        api.notifyDocumentChanged?.(revision);
      } catch {
        // The bridge went away (window closing).
      }
    },

    onCommand: (cb) => api.onCommand(cb),
    onOpenProject: (cb) => api.onOpenProject(cb),
    setDocumentEdited: (edited) => api.setDocumentEdited(edited),
    setTitle: (title) => api.setTitle(title),
    displayName: projectDisplayName,
    dispose() {
      assets.dispose();
      known.clear();
    },
  };
}
