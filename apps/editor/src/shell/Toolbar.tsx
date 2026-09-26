import { DEVICE_PRESETS, type DevicePreset } from "@sonobe/core";
import { BookOpen, ChevronDown, Columns2, MessageSquare, Monitor, Moon, PanelBottom, PanelRight, Pause, Pencil, Play, Redo2, RotateCcw, Rows2, Scaling, Search, Smartphone, SquareMousePointer, Sun, Tablet, Undo2, Watch, Workflow } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode, type RefObject } from "react";
import { getDesktopHostApi } from "../host/detect.ts";
import { ASSISTANT_COMMAND_ID } from "../panels/assistant/commands.ts";
import { useAssistant } from "../panels/assistant/assistantStore.ts";
import { useTheme } from "../theme/ThemeProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Menu, type MenuEntry } from "../ui/Menu.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../ui/Select.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { commandDisabledReason, commandTitle } from "../ui/commands/commandRegistry.ts";
import { useCommandList, useCommands, useOptionalCommands } from "../ui/commands/CommandProvider.tsx";
import { observeResize } from "../ui/lib/observeResize.ts";
import { SonobeMark } from "./icons.tsx";
import { layoutStore, useLayout } from "./layoutStore.ts";

const KIND_LABELS: Record<DevicePreset["kind"], string> = {
  phone: "Phones",
  tablet: "Tablets",
  computer: "Desktop",
  watch: "Watch",
  custom: "Custom",
};

const KIND_ICONS: Record<DevicePreset["kind"], typeof Smartphone> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Monitor,
  watch: Watch,
  custom: Scaling,
};

const DEVICE_OPTIONS: SelectOption[] = DEVICE_PRESETS.map((device) => {
  const Icon = KIND_ICONS[device.kind];
  return {
    value: device.id,
    label: device.name,
    group: KIND_LABELS[device.kind],
    icon: <Icon size={14} strokeWidth={1.75} />,
    trailing: `${device.size[0]}×${device.size[1]}`,
    keywords: [device.platform, device.kind],
  };
});

export function DevicePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <Select
      size="sm"
      variant="ghost"
      aria-label="Device"
      options={DEVICE_OPTIONS}
      value={value}
      onChange={onChange}
      searchable
      searchPlaceholder="Search devices…"
      menuWidth={272}
      className="sb-toolbar__device"
    />
  );
}

type MenuEntries = readonly MenuEntry[] | (() => readonly MenuEntry[]);

const UNDO_REDO = [
  { id: "edit.undo", icon: <Undo2 size={14} strokeWidth={1.75} /> },
  { id: "edit.redo", icon: <Redo2 size={14} strokeWidth={1.75} /> },
] as const;

/** The browser has no Edit menu, so the title menu carries Undo and Redo. */
function useUndoRedoEntries(): () => readonly MenuEntry[] {
  const commands = useOptionalCommands();
  return () => {
    if (!commands || getDesktopHostApi()) return [];
    const { registry } = commands;
    return UNDO_REDO.flatMap(({ id, icon }): MenuEntry[] => {
      const command = registry.get(id);
      if (!command) return [];
      const shortcut = typeof command.shortcut === "string" ? command.shortcut : command.shortcut?.[0];
      const enabled = registry.isEnabled(id);
      return [{ id, label: commandTitle(command), icon, ...(shortcut ? { shortcut } : {}), ...(enabled ? {} : { disabled: true, description: commandDisabledReason(command) }), onSelect: () => void registry.run(id) }];
    });
  };
}

interface DocButtonProps extends ComponentPropsWithRef<"button"> {
  title: string;
  dirty: boolean;
  titleRef: RefObject<HTMLSpanElement | null>;
  truncated: boolean;
}

/** The name button carries its own tooltip so keyboard focus shows the full name and the unsaved note. */
function DocButton({ title, dirty, titleRef, truncated, ...rest }: DocButtonProps) {
  return (
    <Tooltip content={truncated && dirty ? `${title} (unsaved changes)` : truncated ? title : "Unsaved changes. Save"} shortcut={dirty ? "Mod+S" : undefined} disabled={!truncated && !dirty}>
      <button type="button" className="sb-toolbar__doc" {...rest}>
        <span ref={titleRef} className="sb-toolbar__doc-title">
          {title}
        </span>
        <ChevronDown size={12} strokeWidth={2} className="sb-toolbar__doc-chevron" aria-hidden />
        {dirty && <span className="sb-toolbar__dirty" role="img" aria-label="Unsaved changes" />}
      </button>
    </Tooltip>
  );
}

function DocumentTitle({ title, dirty, onRename, menu }: { title: string; dirty: boolean; onRename?: ((name: string) => void) | undefined; menu?: MenuEntries | undefined }) {
  const [editing, setEditing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const undoRedo = useUndoRedoEntries();

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    return observeResize([el], measure);
  }, [title, editing]);

  if (editing && onRename) {
    return (
      <input
        className="sb-toolbar__doc-input"
        aria-label="Prototype name"
        defaultValue={title}
        autoFocus
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          setEditing(false);
          if (next && next !== title) onRename(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.stopPropagation();
            event.currentTarget.value = title;
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  const entries = (): readonly MenuEntry[] => {
    const rest = typeof menu === "function" ? menu() : (menu ?? []);
    const history = undoRedo();
    const tail: readonly MenuEntry[] = history.length ? [...(rest.length ? [{ type: "separator" } as const] : []), ...history] : [];
    if (!onRename) return [...rest, ...tail];
    const rename: MenuEntry = { id: "rename", label: "Rename…", icon: <Pencil size={14} strokeWidth={1.75} />, onSelect: () => setEditing(true) };
    return rest.length || tail.length ? [rename, { type: "separator" }, ...rest, ...tail] : [rename];
  };

  return (
    <Menu aria-label="Prototype" entries={entries}>
      <DocButton title={title} dirty={dirty} titleRef={titleRef} truncated={truncated} onDoubleClick={onRename ? () => setEditing(true) : undefined} />
    </Menu>
  );
}

/** Opens and closes the Assistant sheet (desktop only, where the Assistant lives). */
function AssistantButton() {
  const { registry } = useCommands();
  useCommandList();
  const open = useAssistant((s) => s.open);
  const pending = useAssistant((s) => s.items.some((item) => item.kind === "confirm" && item.status === "pending"));
  const shortcut = registry.get(ASSISTANT_COMMAND_ID)?.shortcut;
  return (
    <Tooltip content={pending ? "Assistant is waiting for your answer" : "Chat with Claude in the editor"} shortcut={shortcut}>
      <Button
        variant="ghost"
        className="sb-toolbar__assistant"
        icon={
          <>
            <MessageSquare size={16} strokeWidth={1.75} />
            {pending && <span className="sb-toolbar__pending" />}
          </>
        }
        aria-label={pending ? "Assistant, waiting for your answer" : "Assistant"}
        aria-pressed={open}
        data-active={open || undefined}
        onClick={() => void registry.run(ASSISTANT_COMMAND_ID)}
      >
        Assistant
      </Button>
    </Tooltip>
  );
}

export interface ToolbarProps {
  documentTitle: string;
  /** Shows the unsaved-changes dot. */
  dirty?: boolean;
  /** Rename the prototype. Without it the title can't be edited. */
  onRename?: (name: string) => void;
  /** Items after "Rename…" in the title menu (New, Open, Save...). */
  documentMenu?: MenuEntries;
  deviceId: string;
  onDeviceChange: (id: string) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  onOpenPalette: () => void;
  /** The Claude button. */
  claude?: ReactNode;
}

/** Title and device on the left; play, restart, and view mode in the middle; search, Claude, Assistant, Learn, and theme on the right. */
export function Toolbar({ documentTitle, dirty = false, onRename, documentMenu, deviceId, onDeviceChange, playing, onTogglePlay, onRestart, onOpenPalette, claude }: ToolbarProps) {
  const viewMode = useLayout((s) => s.viewMode);
  const splitDirection = useLayout((s) => s.splitDirection);
  const drawer = useLayout((s) => s.drawer);
  const { setViewMode, toggleSplitDirection, toggleDrawer } = layoutStore.getState();
  const { theme, toggleTheme } = useTheme();
  const beside = splitDirection === "columns";

  return (
    <header className="sb-toolbar">
      <div className="sb-toolbar__left">
        <span className="sb-toolbar__mark">
          <SonobeMark size={20} />
        </span>
        <DocumentTitle title={documentTitle} dirty={dirty} onRename={onRename} menu={documentMenu} />
        <span className="sb-toolbar__divider" aria-hidden />
        <DevicePicker value={deviceId} onChange={onDeviceChange} />
      </div>

      <div className="sb-toolbar__center" role="toolbar" aria-label="Prototype and view">
        <IconButton
          icon={playing ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
          label={playing ? "Pause prototype" : "Play prototype"}
          shortcut="Mod+Alt+P"
          onClick={onTogglePlay}
        />
        <IconButton icon={<RotateCcw size={16} strokeWidth={1.75} />} label="Restart prototype" shortcut="Mod+R" onClick={onRestart} />
        <span className="sb-toolbar__divider" aria-hidden />
        <SegmentedControl
          size="sm"
          aria-label="View mode"
          className="sb-toolbar__view"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "canvas", label: "Canvas", "aria-label": "Canvas only", icon: <SquareMousePointer size={16} strokeWidth={1.75} />, tooltip: "Canvas only", shortcut: "Alt+1" },
            { value: "split", label: "Split", "aria-label": "Canvas and patches", icon: beside ? <Columns2 size={16} strokeWidth={1.75} /> : <Rows2 size={16} strokeWidth={1.75} />, tooltip: "Canvas and patches", shortcut: "Alt+2" },
            { value: "patches", label: "Patches", "aria-label": "Patches only", icon: <Workflow size={16} strokeWidth={1.75} />, tooltip: "Patches only", shortcut: "Alt+3" },
          ]}
        />
        <IconButton
          icon={beside ? <PanelBottom size={16} strokeWidth={1.75} /> : <PanelRight size={16} strokeWidth={1.75} />}
          label={beside ? "Put patches below the canvas" : "Put patches beside the canvas"}
          tooltip={viewMode === "split" ? undefined : "Switch to Canvas and patches to change this"}
          disabled={viewMode !== "split"}
          onClick={toggleSplitDirection}
        />
      </div>

      <div className="sb-toolbar__right">
        <button type="button" className="sb-toolbar__search" onClick={onOpenPalette}>
          <Search size={14} strokeWidth={1.75} aria-hidden />
          <span className="sb-toolbar__search-label">Search commands</span>
          <Kbd shortcut="Mod+K" variant="plain" />
        </button>
        {claude}
        {getDesktopHostApi() && <AssistantButton />}
        <span className="sb-toolbar__divider" aria-hidden />
        <Tooltip content="Lessons and guides" shortcut="Mod+/">
          <Button
            variant="ghost"
            className="sb-toolbar__learn"
            icon={<BookOpen size={16} strokeWidth={1.75} />}
            aria-label="Learn"
            aria-pressed={drawer === "learn"}
            data-active={drawer === "learn" || undefined}
            onClick={() => toggleDrawer("learn")}
          >
            Learn
          </Button>
        </Tooltip>
        <IconButton icon={theme === "dark" ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />} label={theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={toggleTheme} />
      </div>
    </header>
  );
}
