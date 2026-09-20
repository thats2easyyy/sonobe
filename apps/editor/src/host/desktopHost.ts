/** HostAdapter over the Electron preload API (`window.sonobeHost`). */

import { parseDocumentFiles } from "@sonobe/core";
import { assetBinaries, createAssetUrlCache, createDraftFiles, digestFiles, documentFiles, draftBaseChanged, planProjectWrite, projectDisplayName, readDraftContents } from "./projectFiles.ts";
import type { DesktopDraftReply, DesktopDraftsApi, DesktopHostApi, DesktopViewerWindowStatus, HostAdapter, HostDrafts } from "./types.ts";

type OpenWindow = { open?: (url?: string, target?: string, features?: string) => unknown };

export function createDesktopHost(api: DesktopHostApi): HostAdapter {
  /** Document files as last read or written, per project folder (drives minimal writes). */
  const known = new Map<string, Record<string, string>>();
  const assets = createAssetUrlCache();
  const draftFiles = createDraftFiles(assets);

  /** A failed draft reply as an error with its code. */
  const unwrap = <T extends object>(reply: DesktopDraftReply<T>): T => {
    if (!reply.ok) throw Object.assign(new Error(reply.message), { code: reply.code });
    return reply;
  };

  /** Drafts in the app's data folder, written through the main process (apps/desktop/electron/drafts.ts). */
  const desktopDrafts = (draftsApi: DesktopDraftsApi): HostDrafts => ({
    async write(id, doc, meta) {
      const plan = draftFiles.plan(id, doc, meta.projectPath);
      const base = meta.projectPath ? known.get(meta.projectPath) : undefined;
      const hasBinaries = Object.keys(plan.binaries).length > 0;
      unwrap(await draftsApi.write(id, { files: plan.files, deleted: plan.deleted, ...(hasBinaries ? { binaries: plan.binaries } : {}) }, { ...meta, ...(base ? { base: digestFiles(base) } : {}) }));
      draftFiles.wrote(id, plan);
    },
    async remove(id) {
      unwrap(await draftsApi.remove(id));
      draftFiles.forget(id);
    },
    list: () => draftsApi.list(),
    async open(id) {
      const { info, manifest, files, binaries } = unwrap(await draftsApi.read(id));
      const recovered = readDraftContents(info, manifest, files, binaries);
      draftFiles.read(id, documentFiles(files), Object.keys(recovered.binaries));
      return recovered;
    },
    diskChanged: (projectPath, draft) => draftBaseChanged(known.get(projectPath), draft.base),
    reveal: (id) => draftsApi.reveal(id),
  });

  return {
    kind: "desktop",
    platform: api.platform,
    capabilities: { nativeMenus: true, nativeDialogs: true, watch: true, reveal: true, persistent: true },
    rpc: api.rpc,
    muted: api.muted === true,
    ...(api.drafts ? { drafts: desktopDrafts(api.drafts) } : {}),

    openProjectDialog: () => api.openProjectDialog(),
    saveProjectDialog: (defaultName) => api.saveProjectDialog(defaultName),

    async readProject(dir) {
      const { files, binaries } = await api.readProject(dir);
      // Record what's really on disk before parsing: when a file is invalid (a merge conflict, a typo),
      // the next save then sees it differs from the document and rewrites it.
      known.set(dir, documentFiles(files));
      assets.setBinaries(dir, assetBinaries(binaries));
      return parseDocumentFiles(files);
    },

    async writeProject(dir, doc, options = {}) {
      let previous = known.get(dir);
      if (!previous) {
        // A folder this window never read (Save As onto an existing prototype the person chose to
        // replace): diff against what's there, so the old project's components and scripts go away.
        try {
          const existing = api.readProjectIfExists ? await api.readProjectIfExists(dir) : await api.readProject(dir);
          previous = existing ? documentFiles(existing.files) : undefined;
        } catch {
          previous = undefined; // A new folder.
        }
      }
      const plan = planProjectWrite(doc, previous);
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

    notifyDocumentChanged(revision, history) {
      try {
        api.notifyDocumentChanged?.(revision, history);
      } catch {
        // The bridge went away (window closing).
      }
    },

    notifyPrototypeRestarted() {
      try {
        api.notifyPrototypeRestarted?.();
      } catch {
        // The bridge went away (window closing).
      }
    },

    ...(api.getViewerWindowStatus ? { getViewerWindowStatus: () => api.getViewerWindowStatus!() } : {}),
    ...(api.onViewerWindowStatus ? { onViewerWindowStatus: (cb: (status: DesktopViewerWindowStatus) => void) => api.onViewerWindowStatus!(cb) } : {}),

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
