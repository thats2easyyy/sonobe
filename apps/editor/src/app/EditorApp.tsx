/**
 * The real editor: one EditorSession wired into the shell. Layers, viewer, canvas, patch editor,
 * inspector, HUD, Learn, and Connect Claude; toolbar bound to the document and runtime; document
 * commands, menu routing, and (inside the desktop app) the MCP bridge handlers.
 */

import { getDevicePreset, type Id } from "@sonobe/core";
import { FilePlus, FolderOpen, FolderSearch, Save, SaveAll } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getDesktopHostApi } from "../host/detect.ts";
import { CanvasPanel } from "../panels/canvas/CanvasPanel.tsx";
import { ConnectClaudeButton } from "../panels/connect/ConnectClaudeButton.tsx";
import { ConnectClaudeHost } from "../panels/connect/ConnectClaudeDialog.tsx";
import { connectClaudeStore } from "../panels/connect/connectStore.ts";
import { Hud } from "../panels/hud/Hud.tsx";
import { InspectorPanel } from "../panels/inspector/InspectorPanel.tsx";
import { LayersPanel } from "../panels/layers/LayersPanel.tsx";
import { LearnDrawer } from "../panels/learn/LearnDrawer.tsx";
import { PatchEditorBreadcrumbs } from "../panels/patch-editor/components/Chrome.tsx";
import { insertPatchOps } from "../panels/patch-editor/model/editOps.ts";
import { PatchEditor } from "../panels/patch-editor/PatchEditor.tsx";
import { devicePresetOps } from "../panels/viewer/viewerModel.ts";
import { ViewerPanel } from "../panels/viewer/ViewerPanel.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { layoutStore, useLayout } from "../shell/layoutStore.ts";
import { Panel } from "../shell/Panel.tsx";
import { EditorProvider, useDocument, useEditorSession, useRuntimeState } from "../state/EditorProvider.tsx";
import type { EditorSession } from "../state/session.ts";
import { useCommands } from "../ui/commands/CommandProvider.tsx";
import type { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import type { MenuEntry } from "../ui/Menu.tsx";
import { toast } from "../ui/Toast.tsx";
import { AppDialogs } from "./AppDialogs.tsx";
import { ExternalChangeBanner } from "./ExternalChangeBanner.tsx";
import { learnNav, useLearnNav } from "./learnStore.ts";
import { getAppSession } from "./session.ts";
import { installTestHook, shouldInstallTestHook } from "./testHook.ts";
import { useAppCommands } from "./useAppCommands.tsx";
import "./app.css";

export interface EditorAppProps {
  /** Default: the app-wide session. */
  session?: EditorSession;
}

/** Mount inside <CommandProvider> (and a Toaster). */
export function EditorApp({ session }: EditorAppProps) {
  const [value] = useState(() => session ?? getAppSession());
  return (
    <EditorProvider session={value}>
      <Workspace />
      <ConnectClaudeHost onOpenGuide={(slug) => learnNav.getState().open({ kind: "guide", slug })} />
      <AppDialogs />
    </EditorProvider>
  );
}

const FILE_MENU: readonly (readonly [id: string, icon: ReactNode] | "separator")[] = [
  ["file.new", <FilePlus size={14} />],
  ["file.open", <FolderOpen size={14} />],
  "separator",
  ["file.save", <Save size={14} />],
  ["file.saveAs", <SaveAll size={14} />],
  ["file.reveal", <FolderSearch size={14} />],
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

/** Where a patch added from outside the patch editor goes: to the right of the existing graph. */
export function insertPosition(patches: Readonly<Record<Id, { ui: { x: number; y: number } }>>): { x: number; y: number } {
  const nodes = Object.values(patches);
  if (nodes.length === 0) return { x: 40, y: 40 };
  return { x: Math.max(...nodes.map((n) => n.ui.x)) + 240, y: Math.min(...nodes.map((n) => n.ui.y)) };
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
  const learnView = useLearnNav((s) => s.view);
  const [titlebarInset] = useState(() => (getDesktopHostApi()?.platform === "darwin" ? 80 : 0));

  useAppCommands(session);
  useEffect(() => (shouldInstallTestHook() ? installTestHook(session) : undefined), [session]);

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
    const component = session.document.getState().doc.components[componentId];
    if (!component) return;
    const spec = session.registry.patches.get(type);
    const result = session.document.getState().apply(insertPatchOps(componentId, type, insertPosition(component.patches)), { label: `Insert ${spec?.name ?? type}`, defaultComponent: componentId });
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
      slots={{
        banner: <ExternalChangeBanner />,
        claude: <ConnectClaudeButton />,
        layers: <LayersPanel onCollapse={() => layout.toggleCollapsed("layers", true)} />,
        viewer: <ViewerPanel onCollapse={() => layout.toggleCollapsed("viewer", true)} />,
        canvas: <CanvasPanel />,
        patchEditor: (
          <Panel title="Patches" scope="patchEditor" surface="sunken" className="sb-app-patches" headerContent={<PatchEditorBreadcrumbs />}>
            <PatchEditor showBreadcrumbs={false} />
          </Panel>
        ),
        inspector: <InspectorPanel onCollapse={() => layout.toggleCollapsed("inspector", true)} onLearnMore={(type) => learnNav.getState().open({ kind: "patches", type })} />,
        hud: <Hud tab={hudTab} onTabChange={(tab) => layout.setHudTab(tab)} collapsed={hudCollapsed} onToggleCollapse={() => layout.toggleCollapsed("hud")} onConnectClaude={() => connectClaudeStore.getState().show()} />,
        learn: <LearnDrawer onClose={() => layout.setDrawer(null)} {...(learnView ? { view: learnView } : {})} onConnectClaude={() => connectClaudeStore.getState().show()} onInsertPatch={insertPatch} />,
      }}
    />
  );
}
