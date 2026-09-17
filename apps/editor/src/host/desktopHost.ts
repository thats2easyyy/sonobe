/** HostAdapter over the Electron preload API (`window.sonobeHost`). */

import { parseDocumentFiles } from "@sonobe/core";
import { assetBinaries, createAssetUrlCache, documentFiles, planProjectWrite, projectDisplayName } from "./projectFiles.ts";
import type { DesktopHostApi, HostAdapter } from "./types.ts";

export function createDesktopHost(api: DesktopHostApi): HostAdapter {
  /** Document files as last read or written, per project folder (drives minimal writes). */
  const known = new Map<string, Record<string, string>>();
  const assets = createAssetUrlCache();

  return {
    kind: "desktop",
    platform: api.platform,
    capabilities: { nativeMenus: true, nativeDialogs: true, watch: true, reveal: true, persistent: true },
    rpc: api.rpc,

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
      let binaries: Record<string, ArrayBuffer> | undefined;
      const from = options.copyAssetsFrom;
      if (from && from !== dir && Object.keys(doc.assets).length > 0) {
        const source = assets.getBinaries(from) ?? assetBinaries((await api.readProject(from)).binaries);
        const wanted = new Set(Object.values(doc.assets).map((a) => `assets/${a.file}`));
        binaries = Object.fromEntries(Object.entries(source).filter(([path]) => wanted.has(path)));
      }
      await api.writeProject(dir, { files: plan.files, deleted: plan.deleted, ...(binaries && Object.keys(binaries).length ? { binaries } : {}) });
      known.set(dir, plan.all);
      if (binaries) assets.setBinaries(dir, { ...(assets.getBinaries(dir) ?? {}), ...binaries });
      return { written: [...Object.keys(plan.files), ...Object.keys(binaries ?? {})], deleted: plan.deleted, unchanged: plan.unchanged };
    },

    watchProject(dir, cb) {
      return api.watchProject(dir, (change) => cb(change.paths));
    },
    revealInFinder: (path) => api.revealInFinder(path),
    recentProjects: () => api.recentProjects(),
    resolveAssetUrl: (path, file) => assets.resolve(path, file),
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
