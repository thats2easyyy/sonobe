/**
 * The real editor: one EditorSession wired into the shell. Layers, viewer, canvas, patch editor,
 * inspector, HUD, Learn, and Connect Claude; toolbar bound to the document and runtime; document
 * commands, menu routing, the welcome screen, Settings and About, and (inside the desktop app) the
 * MCP bridge handlers behind the agent-permission guard.
 *
 * The patch editor (React Flow and ELK), the Learn drawer (guides, examples, lessons, patch reference),
 * the welcome screen, and the dialogs load on demand so the first paint stays small.
 */

import { getDevicePreset, type Op } from "@sonobe/core";
import { FilePlus, FolderOpen, FolderSearch, Save, SaveAll, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { getDesktopHostApi } from "../host/detect.ts";
import { registerRpcHandlers } from "../host/rpcHandlers.ts";
import { useAssistant } from "../panels/assistant/assistantStore.ts";
import { assistantCommand } from "../panels/assistant/commands.ts";
import { CanvasPanel } from "../panels/canvas/CanvasPanel.tsx";
import { ConnectClaudeButton } from "../panels/connect/ConnectClaudeButton.tsx";
import { connectClaudeStore, useConnectClaude } from "../panels/connect/connectStore.ts";
import { Hud } from "../panels/hud/Hud.tsx";
import { InspectorPanel } from "../panels/inspector/InspectorPanel.tsx";
import { LayersPanel } from "../panels/layers/LayersPanel.tsx";
import { lessonLayout, useLessonLayout } from "../panels/learn/lessons/lessonLayout.ts";
import { useLessons } from "../panels/learn/lessons/lessonStore.ts";
import { freeInsertPosition, PatchEditorBreadcrumbs } from "../panels/patch-editor/api.ts";
import { devicePresetOps } from "../panels/viewer/viewerModel.ts";
import { ViewerPanel } from "../panels/viewer/ViewerPanel.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { layoutStore, useLayout } from "../shell/layoutStore.ts";
import { Panel } from "../shell/Panel.tsx";
import { EditorProvider, useDocument, useEditorSession, useRuntimeState } from "../state/EditorProvider.tsx";
import type { EditorSession } from "../state/session.ts";
import { useCommands, useRegisterCommands } from "../ui/commands/CommandProvider.tsx";
import type { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import type { MenuEntry } from "../ui/Menu.tsx";
import { toast } from "../ui/Toast.tsx";
import { guardRpcRegistrar } from "./agentAccess.ts";
import { reportIssue } from "./appActions.ts";
import { AppDialogs } from "./AppDialogs.tsx";
import { appPanels, useAppPanels } from "./appPanels.ts";
import { ExternalChangeBanner } from "./ExternalChangeBanner.tsx";
import { useHudAutoOpen } from "./hudAutoOpen.ts";
import { learnNav, useLearnNav } from "./learnStore.ts";
import { ServiceDialogs } from "./ServiceDialogs.tsx";
import { ScriptTrustBanner } from "./ScriptTrustBanner.tsx";
import { getAppSession } from "./session.ts";
import { dialogsFor } from "./sessionServices.ts";
import { applyMotionPreference, settingsStore } from "./settings.ts";
import { installTestHook, shouldInstallTestHook } from "./testHook.ts";
import { useAppCommands } from "./useAppCommands.tsx";
import { hasSeenWelcome, shouldShowWelcomeOnLaunch, useWelcome, welcomeStore } from "./welcome/welcomeStore.ts";
import "./app.css";
import "./workspace.css";

const loadPatchEditor = () => import("../panels/patch-editor/PatchEditor.tsx");
const PatchEditor = lazy(() => loadPatchEditor().then((m) => ({ default: m.PatchEditor })));
const LearnDrawer = lazy(() => import("../panels/learn/LearnDrawer.tsx").then((m) => ({ default: m.LearnDrawer })));
const ConnectClaudeHost = lazy(() => import("../panels/connect/ConnectClaudeDialog.tsx").then((m) => ({ default: m.ConnectClaudeHost })));
const WelcomeScreen = lazy(() => import("./welcome/WelcomeScreen.tsx").then((m) => ({ default: m.WelcomeScreen })));
const SettingsDialog = lazy(() => import("./SettingsDialog.tsx").then((m) => ({ default: m.SettingsDialog })));
const AboutDialog = lazy(() => import("./AboutDialog.tsx").then((m) => ({ default: m.AboutDialog })));
const KeyboardShortcutsDialog = lazy(() => import("./KeyboardShortcutsDialog.tsx").then((m) => ({ default: m.KeyboardShortcutsDialog })));
const AssistantHost = lazy(() => import("../panels/assistant/AssistantHost.tsx").then((m) => ({ default: m.AssistantHost })));

export interface EditorAppProps {
  /** Default: the app-wide session. */
  session?: EditorSession;
}

/** Mount inside <CommandProvider> (and a Toaster). */
export function EditorApp({ session }: EditorAppProps) {
  const [value] = useState(() => session ?? getAppSession());

  // The MCP bridge, with writes refused while Settings → Claude is "Read only".
  useEffect(() => {
    const rpc = value.host?.rpc;
    return rpc ? registerRpcHandlers(value, { rpc: guardRpcRegistrar(rpc, () => settingsStore.getState().agentPermission) }) : undefined;
  }, [value]);

  return (
    <EditorProvider session={value} rpc={false}>
      <Workspace />
      <Overlays />
      <AppDialogs />
      <ServiceDialogs store={dialogsFor(value)} />
    </EditorProvider>
  );
}

/** Dialogs and screens that load on first use. */
function Overlays() {
  const session = useEditorSession();
  const connectOpen = useConnectClaude((s) => s.open);
  const [connectLoaded, setConnectLoaded] = useState(connectOpen);
  const welcomeOpen = useWelcome((s) => s.open);
  const welcomeReason = useWelcome((s) => s.reason);
  const panel = useAppPanels((s) => s.open);
  const assistantOpen = useAssistant((s) => s.open);
  const [assistantLoaded, setAssistantLoaded] = useState(assistantOpen);

  useEffect(() => {
    if (connectOpen) setConnectLoaded(true);
  }, [connectOpen]);

  useEffect(() => {
    if (assistantOpen) setAssistantLoaded(true);
  }, [assistantOpen]);

  return (
    <Suspense fallback={null}>
      {connectLoaded && <ConnectClaudeHost onOpenGuide={(slug) => learnNav.getState().open({ kind: "guide", slug })} />}
      {assistantLoaded && <AssistantHost onConnectClaude={() => connectClaudeStore.getState().show()} />}
      {welcomeOpen && <WelcomeScreen open reason={welcomeReason} onClose={() => welcomeStore.getState().hide()} />}
      {panel === "settings" && <SettingsDialog open onOpenChange={(open) => !open && appPanels.getState().hide()} />}
      {panel === "about" && <AboutDialog open onOpenChange={(open) => !open && appPanels.getState().hide()} onReportIssue={() => reportIssue(session)} />}
      {panel === "shortcuts" && <KeyboardShortcutsDialog open onOpenChange={(open) => !open && appPanels.getState().hide()} />}
    </Suspense>
  );
}

const FILE_MENU: readonly (readonly [id: string, icon: ReactNode] | "separator")[] = [
  ["file.new", <FilePlus size={14} />],
  ["file.open", <FolderOpen size={14} />],
  "separator",
  ["file.save", <Save size={14} />],
  ["file.saveAs", <SaveAll size={14} />],
  ["file.reveal", <FolderSearch size={14} />],
  "separator",
  ["file.close", <X size={14} />],
];

/** Menu items for registered commands (titles, shortcuts, and enabled state from the registry). */
export function commandMenuEntries(registry: CommandRegistry, items: typeof FILE_MENU = FILE_MENU): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const item of items) {
    if (item === "separator") {
      if (entries.length && entries.at(-1)?.type !== "separator") entries.push({ type: "separator" });
      continue;
    }
    const [id, icon] = item;
    const command = registry.get(id);
    if (!command) continue;
    const enabled = registry.isEnabled(id);
    if (!enabled && id === "file.reveal") continue;
    const shortcut = typeof command.shortcut === "string" ? command.shortcut : command.shortcut?.[0];
    entries.push({ id, label: command.title, icon, ...(shortcut ? { shortcut } : {}), disabled: !enabled, onSelect: () => void registry.run(id) });
  }
  if (entries.at(-1)?.type === "separator") entries.pop();
  return entries;
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="sb-app-loading" role="status">
      <span className="sb-app-loading__dot" aria-hidden />
      {label}
    </div>
  );
}

function Workspace() {
  const session = useEditorSession();
  const { registry } = useCommands();
  const name = useDocument((s) => s.doc.project.name);
  const dirty = useDocument((s) => s.dirty);
  const devicePreset = useDocument((s) => s.doc.project.device.preset);
  const playing = useRuntimeState((s) => s.playing);
  const hudTab = useLayout((s) => s.hudTab);
  const hudCollapsed = useLayout((s) => s.collapsed.hud);
  const drawer = useLayout((s) => s.drawer);
  const requestedLearnView = useLearnNav((s) => s.view);
  const lessonActive = useLessons((s) => s.active !== null);
  // A lesson on screen (its practice prototype open) docks the drawer and uses the lesson layout.
  const lessonDocked = useLessonLayout((s) => s.active);
  const [patchTools, setPatchTools] = useState<HTMLDivElement | null>(null);
  const [titlebarInset] = useState(() => (getDesktopHostApi()?.platform === "darwin" ? 80 : 0));

  // The in-app Assistant claims "ai.assistant" before useAppCommands, which skips ids already registered.
  useRegisterCommands(() => [assistantCommand()], []);
  useAppCommands(session);
  useHudAutoOpen(session, () => layoutStore.getState());
  useEffect(() => (shouldInstallTestHook() ? installTestHook(session) : undefined), [session]);

  // Motion preference (Settings → Motion) on <html data-motion>.
  useEffect(() => {
    let release = applyMotionPreference(settingsStore.getState().motion);
    const unsubscribe = settingsStore.subscribe((s, previous) => {
      if (s.motion === previous.motion) return;
      release();
      release = applyMotionPreference(s.motion);
    });
    return () => {
      release();
      unsubscribe();
    };
  }, []);

  // The welcome screen on the first launch (or every launch, when Settings asks for it).
  useEffect(() => {
    if (shouldShowWelcomeOnLaunch(hasSeenWelcome(), settingsStore.getState().showWelcomeOnLaunch)) welcomeStore.getState().show("launch");
  }, []);

  // A project opened from the OS, Open Recent, or Claude replaces whatever the welcome screen offered.
  useEffect(
    () =>
      session.document.subscribe((s, previous) => {
        if (s.projectPath && s.projectPath !== previous.projectPath) welcomeStore.getState().hide();
      }),
    [session],
  );

  // A lesson layout saved before a reload, with no lesson left to show: put the normal layout back.
  useEffect(() => {
    if (drawer !== "learn" || !lessonActive) lessonLayout.releaseStale();
  }, [drawer, lessonActive]);

  // The patch editor is on screen in split mode; fetch it even when the canvas is showing alone.
  useEffect(() => {
    const timer = setTimeout(() => void loadPatchEditor().catch(() => undefined), 1200);
    return () => clearTimeout(timer);
  }, []);

  const layout = layoutStore.getState();

  const rename = (next: string) => {
    const result = session.document.getState().apply([{ op: "setProject", changes: { name: next } }], { label: `Rename prototype to “${next}”` });
    if (!result.ok) toast({ title: result.errors[0]?.message ?? "Couldn't rename the prototype.", tone: "warn" });
  };

  const changeDevice = (id: string) => {
    const current = session.document.getState().doc.project.device;
    if (current.preset === id) return;
    session.document.getState().apply(devicePresetOps(current, id), { label: `Change device to ${getDevicePreset(id).name}` });
  };

  const insertPatch = (type: string) => {
    const componentId = session.currentComponentId();
    const doc = session.document.getState().doc;
    if (!doc.components[componentId]) return;
    const spec = session.registry.patches.get(type);
    // Free space below the graph, so it never lands on another patch or straddles a comment frame.
    const position = freeInsertPosition(doc, componentId, session.registry, type);
    const ops: Op[] = [{ op: "addPatch", component: componentId, patch: { ref: "inserted", type, ui: { x: Math.round(position.x), y: Math.round(position.y) } } }];
    const result = session.document.getState().apply(ops, { label: `Insert ${spec?.name ?? type}`, defaultComponent: componentId });
    const id = result.idMap.inserted;
    if (!result.ok || !id) {
      toast({ title: result.errors[0]?.message ?? `Couldn't add ${spec?.name ?? type}.`, tone: "warn" });
      return;
    }
    if (layout.viewMode === "canvas") layout.setViewMode("split");
    session.selection.getState().select({ patches: [id] });
    session.selection.getState().requestReveal(componentId, [id]);
    toast({ title: `Added ${spec?.name ?? type}`, description: "It's selected in the patch editor.", tone: "success" });
  };

  return (
    <AppShell
      documentTitle={name}
      dirty={dirty}
      onRenameDocument={rename}
      documentMenu={() => commandMenuEntries(registry)}
      deviceId={devicePreset}
      onDeviceChange={changeDevice}
      playing={playing}
      onTogglePlay={() => session.runtime.togglePlay()}
      onRestart={() => session.runtime.restart()}
      titlebarInset={titlebarInset}
      drawerDocked={lessonDocked}
      slots={{
        banner: (
          <>
            <ExternalChangeBanner />
            <ScriptTrustBanner />
          </>
        ),
        claude: <ConnectClaudeButton />,
        layers: <LayersPanel onCollapse={() => layout.toggleCollapsed("layers", true)} />,
        viewer: <ViewerPanel onCollapse={() => layout.toggleCollapsed("viewer", true)} />,
        canvas: <CanvasPanel />,
        patchEditor: (
          <Panel
            title="Patches"
            scope="patchEditor"
            surface="sunken"
            className="sb-app-patches"
            headerContent={<PatchEditorBreadcrumbs />}
            // The patch editor docks its toolbar here, so it never covers node headers.
            actions={<div ref={setPatchTools} className="sb-app-patches__tools" />}
          >
            <Suspense fallback={<PanelLoading label="Loading the patch editor…" />}>
              <PatchEditor showBreadcrumbs={false} toolbarContainer={patchTools} />
            </Suspense>
          </Panel>
        ),
        inspector: <InspectorPanel onCollapse={() => layout.toggleCollapsed("inspector", true)} onLearnMore={(type) => learnNav.getState().open({ kind: "patches", type })} />,
        hud: <Hud tab={hudTab} onTabChange={(tab) => layout.setHudTab(tab)} collapsed={hudCollapsed} onToggleCollapse={() => layout.toggleCollapsed("hud")} onConnectClaude={() => connectClaudeStore.getState().show()} />,
        learn: (
          <Suspense fallback={<PanelLoading label="Loading Learn…" />}>
            <LearnDrawer onClose={() => layout.setDrawer(null)} {...(requestedLearnView ? { view: requestedLearnView } : {})} onConnectClaude={() => connectClaudeStore.getState().show()} onInsertPatch={insertPatch} />
          </Suspense>
        ),
      }}
    />
  );
}
