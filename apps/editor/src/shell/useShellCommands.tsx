import {
  BookOpen,
  Columns2,
  Command as CommandIcon,
  Gauge,
  LayoutTemplate,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Plug,
  Plus,
  RotateCcw,
  Smartphone,
  Sparkles,
  SquareMousePointer,
  SwatchBook,
  TriangleAlert,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { useTheme } from "../theme/ThemeProvider.tsx";
import { toast } from "../ui/Toast.tsx";
import { useRegisterCommands } from "../ui/commands/CommandProvider.tsx";
import type { Command } from "../ui/commands/commandRegistry.ts";
import { useLatest } from "../ui/lib/hooks.ts";
import { layoutStore } from "./layoutStore.ts";

export interface ShellCommandHandlers {
  openPalette: () => void;
  openPatchPicker: () => void;
  togglePlay: () => void;
  restart: () => void;
}

/** Registers the shell's commands (panels, view modes, drawers, prototype transport, theme). */
export function useShellCommands(handlers: ShellCommandHandlers): void {
  const latest = useLatest(handlers);
  const { toggleTheme } = useTheme();
  const latestToggleTheme = useLatest(toggleTheme);

  useRegisterCommands(() => {
    const layout = () => layoutStore.getState();
    const commands: Command[] = [
      { id: "app.commandPalette", title: "Show Command Palette", category: "General", shortcut: ["Mod+K", "Mod+Shift+P"], allowInInput: true, icon: CommandIcon, keywords: ["actions", "search"], run: () => latest.current.openPalette() },
      { id: "prototype.restart", title: "Restart Prototype", category: "Prototype", shortcut: "Mod+R", icon: RotateCcw, keywords: ["reload", "reset"], run: () => latest.current.restart() },
      { id: "prototype.togglePlay", title: "Play or Pause Prototype", category: "Prototype", shortcut: "Mod+Alt+P", icon: Play, keywords: ["stop", "freeze"], run: () => latest.current.togglePlay() },
      { id: "patch.insert", title: "Insert Patch…", category: "Patches", shortcut: "Alt+Enter", icon: Plus, keywords: ["add", "node", "library", "picker"], run: () => latest.current.openPatchPicker() },
      {
        id: "patch.tidyUp",
        title: "Tidy Up Patches",
        category: "Patches",
        shortcut: "Ctrl+T",
        scope: "patchEditor",
        icon: WandSparkles,
        keywords: ["arrange", "layout", "organize", "clean"],
        run: () => void toast({ title: "Tidied 9 patches", description: "Arranged left to right by data flow.", tone: "success" }),
      },
      { id: "view.toggleLayers", title: "Show or Hide Layers", category: "View", shortcut: "Mod+1", icon: PanelLeft, run: () => layout().toggleCollapsed("layers") },
      { id: "view.toggleViewer", title: "Show or Hide Viewer", category: "View", shortcut: "Mod+2", icon: Smartphone, run: () => layout().toggleCollapsed("viewer") },
      { id: "view.toggleInspector", title: "Show or Hide Inspector", category: "View", shortcut: "Mod+7", icon: PanelRight, run: () => layout().toggleCollapsed("inspector") },
      { id: "view.toggleHud", title: "Show or Hide Console", category: "View", shortcut: "Mod+J", icon: PanelBottom, keywords: ["hud", "logs", "bottom"], run: () => layout().toggleCollapsed("hud") },
      { id: "view.canvasOnly", title: "Canvas Only", category: "View", shortcut: "Alt+1", icon: SquareMousePointer, run: () => layout().setViewMode("canvas") },
      { id: "view.split", title: "Canvas and Patches", category: "View", shortcut: "Alt+2", icon: LayoutTemplate, keywords: ["split view"], run: () => layout().setViewMode("split") },
      { id: "view.patchesOnly", title: "Patches Only", category: "View", shortcut: "Alt+3", icon: Workflow, keywords: ["full patch graph"], run: () => layout().setViewMode("patches") },
      {
        id: "view.toggleSplitDirection",
        title: "Swap Split Direction",
        category: "View",
        icon: Columns2,
        keywords: ["vertical", "horizontal", "side by side"],
        when: () => layout().viewMode === "split",
        run: () => layout().toggleSplitDirection(),
      },
      { id: "view.showDiagnostics", title: "Show Diagnostics", category: "View", shortcut: "Mod+Shift+M", icon: TriangleAlert, keywords: ["problems", "warnings", "errors"], run: () => layout().setHudTab("diagnostics") },
      { id: "view.showPerformance", title: "Show Performance", category: "View", icon: Gauge, keywords: ["fps", "frame time"], run: () => layout().setHudTab("performance") },
      { id: "view.resetLayout", title: "Reset Panel Layout", category: "View", icon: PanelLeft, keywords: ["default", "restore"], run: () => layout().reset() },
      { id: "help.learn", title: "Open Learn", category: "Help", shortcut: "Mod+/", icon: BookOpen, keywords: ["tutorial", "lessons", "docs", "recipes"], run: () => layout().toggleDrawer("learn") },
      { id: "ai.assistant", title: "Open Assistant", category: "AI", shortcut: "Mod+L", icon: Sparkles, keywords: ["claude", "chat", "ask"], run: () => layout().toggleDrawer("assistant") },
      { id: "ai.connectClaude", title: "Connect Claude…", category: "AI", icon: Plug, keywords: ["mcp", "desktop", "code"], run: () => layout().setDrawer("assistant") },
      { id: "view.toggleTheme", title: "Toggle Light and Dark Theme", category: "Appearance", icon: Moon, keywords: ["dark mode", "light mode", "appearance"], run: () => latestToggleTheme.current() },
      {
        id: "help.gallery",
        title: "Open Widget Gallery",
        category: "Help",
        icon: SwatchBook,
        keywords: ["design system", "components"],
        run: () => {
          window.location.hash = "#gallery";
        },
      },
    ];
    return commands;
  }, [latest, latestToggleTheme]);
}
