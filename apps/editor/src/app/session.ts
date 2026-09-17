/**
 * The app's EditorSession: the desktop host inside Electron, otherwise the browser host with in-app
 * dialogs for naming and picking prototypes. Starts on the Photo Zoom demo until a project opens.
 */

import { createBrowserHost, type BrowserHostOptions } from "../host/browserHost.ts";
import { createDesktopHost } from "../host/desktopHost.ts";
import { getDesktopHostApi } from "../host/detect.ts";
import type { HostAdapter } from "../host/types.ts";
import { createEditorSession, setDefaultSession, type EditorSession, type EditorSessionOptions } from "../state/session.ts";
import { toast } from "../ui/Toast.tsx";
import { appDialogs, type AppDialogStore } from "./dialogs.ts";

export interface AppSessionOptions extends Omit<EditorSessionOptions, "host" | "confirmDiscard"> {
  /** Default: detected (desktop or browser). */
  host?: HostAdapter | null;
  dialogs?: AppDialogStore;
}

/** A browser host whose dialogs are the app's, and whose Open explains when nothing is saved yet. */
export function createAppBrowserHost(dialogs: AppDialogStore = appDialogs, options: Omit<BrowserHostOptions, "dialogs"> = {}): HostAdapter {
  const host = createBrowserHost({ ...options, dialogs: { pickProject: (names) => dialogs.pickProject(names), promptName: (name) => dialogs.promptName(name) } });
  const openProjectDialog = host.openProjectDialog.bind(host);
  host.openProjectDialog = async () => {
    const path = await openProjectDialog();
    if (path === null && !host.capabilities.nativeDialogs && (await host.listProjects()).length === 0) {
      toast({ title: "No saved prototypes yet", description: "Save this one with ⌘S, then open it here later.", tone: "neutral" });
    }
    return path;
  };
  return host;
}

export function createAppSession(options: AppSessionOptions = {}): EditorSession {
  const dialogs = options.dialogs ?? appDialogs;
  const { dialogs: _dialogs, host: hostOption, ...rest } = options;
  const api = getDesktopHostApi();
  const host = hostOption !== undefined ? hostOption : api ? createDesktopHost(api) : createAppBrowserHost(dialogs);
  return createEditorSession({ ...rest, host, confirmDiscard: (info) => dialogs.confirmDiscard(info) });
}

let appSession: EditorSession | null = null;

/** The app-wide session (created once, outside React, so StrictMode doesn't create two runtimes). */
export function getAppSession(): EditorSession {
  if (!appSession) {
    appSession = createAppSession();
    setDefaultSession(appSession);
  }
  return appSession;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    appSession?.dispose();
    appSession = null;
    setDefaultSession(null);
  });
}
