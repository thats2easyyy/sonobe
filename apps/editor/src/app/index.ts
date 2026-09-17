/** The editor app: root, session, commands, dialogs, settings, the welcome screen, and the test hook. */

export { Root } from "./Root.tsx";
export { commandMenuEntries, EditorApp, insertPosition, type EditorAppProps } from "./EditorApp.tsx";
export { createAppBrowserHost, createAppSession, getAppSession, type AppSessionOptions } from "./session.ts";
export { appCommands, runInPatchEditor, runWhenRegistered, useAppCommands, zoomTarget, type AppCommandOptions } from "./useAppCommands.tsx";
export { alignSelection, closePrototype, insertLayer, renameSelection, reportIssue, toggleViewerFullscreen, useAsMask, type Notify } from "./appActions.ts";
export { alignOps, alignPatchRects, estimatePatchSize, flowZoom, patchRects, type AlignEdge, type PatchRect } from "./alignPatches.ts";
export { clipParentPlan, INSERTED_LAYER_REF, insertableLayerTypes, insertLayerOps, insertParentFor, layerPickItems, prototypeSize, type ClipPlan } from "./layerActions.ts";
export { AppDialogs } from "./AppDialogs.tsx";
export { ServiceDialogs } from "./ServiceDialogs.tsx";
export { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog.tsx";
export { AboutDialog, type AboutDialogProps } from "./AboutDialog.tsx";
export { APP_NAME, CREDITS, EDITOR_VERSION, ISSUES_URL, issueUrl, type Credit, type IssueContext } from "./about.ts";
export { appDialogs, createAppDialogStore, useAppDialogs, type AppDialogInput, type AppDialogRequest, type AppDialogState, type AppDialogStore } from "./dialogs.ts";
export { appPanels, createAppPanelsStore, useAppPanels, type AppPanel, type AppPanelsState } from "./appPanels.ts";
export { dialogsFor, trustServiceFor, type ProjectTrustService } from "./sessionServices.ts";
export { applyMotionPreference, createSettingsStore, DEFAULT_SETTINGS, pickSettings, sanitizeSettings, SETTINGS_STORAGE_KEY, settingsStore, shouldReduceMotion, useSettings, type AgentPermission, type AppSettings, type MotionPreference, type SettingsState } from "./settings.ts";
export { AGENT_READ_ONLY_CODE, AGENT_WRITE_METHODS, guardRpcRegistrar, isAgentWrite, READ_ONLY_MESSAGE } from "./agentAccess.ts";
export { createHudAutoOpener, hudTabForNewErrors, useHudAutoOpen, type ErrorCounts, type HudAutoOpener } from "./hudAutoOpen.ts";
export { createWelcomeStore, hasSeenWelcome, shouldShowWelcomeOnLaunch, useWelcome, WELCOME_SEEN_KEY, welcomeStore, type WelcomeReason, type WelcomeState } from "./welcome/welcomeStore.ts";
export { createLearnNavStore, learnNav, useLearnNav, type LearnNavState } from "./learnStore.ts";
export { ExternalChangeBanner } from "./ExternalChangeBanner.tsx";
export { installTestHook, shouldInstallTestHook, type SonobeTestHook } from "./testHook.ts";
