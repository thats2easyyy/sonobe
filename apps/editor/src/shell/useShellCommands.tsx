import { BookOpen, Columns2, Command as CommandIcon, Gauge, LayoutTemplate, Moon, PanelBottom, PanelLeft, PanelRight, Smartphone, SquareMousePointer, SwatchBook, TriangleAlert, Workflow } from "lucide-react";
import { useTheme } from "../theme/ThemeProvider.tsx";
import { useRegisterCommands } from "../ui/commands/CommandProvider.tsx";
import type { Command } from "../ui/commands/commandRegistry.ts";
import { useLatest } from "../ui/lib/hooks.ts";
import { layoutStore } from "./layoutStore.ts";

export interface ShellCommandHandlers {
  openPalette: () => void;
}

/** Registers the shell's own commands: the palette, panels, view modes, the Learn drawer, and theme. */
export function useShellCommands(handlers: ShellCommandHandlers): void {
  const latest = useLatest(handlers);
  const { toggleTheme } = useTheme();
  const latestToggleTheme = useLatest(toggleTheme);

  useRegisterCommands(() => {
    const layout = () => layoutStore.getState();
    const commands: Command[] = [
      // Hidden: listing the palette inside itself only adds noise (the toolbar shows ⌘K).
      { id: "app.commandPalette", title: "Show Command Palette", category: "General", shortcut: ["Mod+K", "Mod+Shift+P"], allowInInput: true, hidden: true, icon: CommandIcon, keywords: ["actions", "search"], run: () => latest.current.openPalette() },
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
        keywords: ["vertical", "horizontal", "side by side", "orientation"],
        when: () => layout().viewMode === "split",
        run: () => layout().toggleSplitDirection(),
      },
      { id: "view.showDiagnostics", title: "Show Diagnostics", category: "View", shortcut: "Mod+Shift+M", icon: TriangleAlert, keywords: ["problems", "warnings", "errors"], run: () => layout().setHudTab("diagnostics") },
      { id: "view.showPerformance", title: "Show Performance", category: "View", icon: Gauge, keywords: ["fps", "frame time"], run: () => layout().setHudTab("performance") },
      { id: "view.resetLayout", title: "Reset Panel Layout", category: "View", icon: PanelLeft, keywords: ["default", "restore"], run: () => layout().reset() },
      { id: "help.learn", title: "Open Learn", category: "Help", shortcut: "Mod+/", icon: BookOpen, keywords: ["tutorial", "lessons", "docs", "guides"], run: () => layout().toggleDrawer("learn") },
      { id: "view.toggleTheme", title: "Toggle Light and Dark Theme", category: "View", icon: Moon, keywords: ["dark mode", "light mode", "appearance"], run: () => latestToggleTheme.current() },
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
