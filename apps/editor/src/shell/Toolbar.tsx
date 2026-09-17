import { DEVICE_PRESETS, type DevicePreset } from "@sonobe/core";
import { BookOpen, ChevronDown, Columns2, Monitor, Moon, Pause, Pencil, Play, RotateCcw, Rows2, Scaling, Search, Smartphone, SquareMousePointer, Sun, Tablet, Watch, Workflow } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTheme } from "../theme/ThemeProvider.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Menu, type MenuEntry } from "../ui/Menu.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../ui/Select.tsx";
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

function DocumentTitle({ title, dirty, onRename, menu }: { title: string; dirty: boolean; onRename?: ((name: string) => void) | undefined; menu?: MenuEntries | undefined }) {
  const [editing, setEditing] = useState(false);

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
    if (!onRename) return rest;
    const rename: MenuEntry = { id: "rename", label: "Rename…", icon: <Pencil size={14} />, onSelect: () => setEditing(true) };
    return rest.length ? [rename, { type: "separator" }, ...rest] : [rename];
  };

  return (
    <Menu aria-label="Prototype" entries={entries}>
      <button type="button" className="sb-toolbar__doc" title={dirty ? `${title} (unsaved changes)` : title} onDoubleClick={onRename ? () => setEditing(true) : undefined}>
        <span className="sb-toolbar__doc-title">{title}</span>
        {dirty && <span className="sb-toolbar__dirty" role="img" aria-label="Unsaved changes" />}
        <ChevronDown size={12} strokeWidth={2} className="sb-toolbar__doc-chevron" aria-hidden />
      </button>
    </Menu>
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

/** Title and device on the left; play, restart, and view mode in the middle; search, Claude, Learn, and theme on the right. */
export function Toolbar({ documentTitle, dirty = false, onRename, documentMenu, deviceId, onDeviceChange, playing, onTogglePlay, onRestart, onOpenPalette, claude }: ToolbarProps) {
  const viewMode = useLayout((s) => s.viewMode);
  const splitDirection = useLayout((s) => s.splitDirection);
  const drawer = useLayout((s) => s.drawer);
  const { setViewMode, toggleSplitDirection, toggleDrawer } = layoutStore.getState();
  const { theme, toggleTheme } = useTheme();

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
          icon={playing ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" strokeWidth={0} />}
          label={playing ? "Pause prototype" : "Play prototype"}
          shortcut="Mod+Alt+P"
          onClick={onTogglePlay}
        />
        <IconButton icon={<RotateCcw size={15} />} label="Restart prototype" shortcut="Mod+R" onClick={onRestart} />
        <span className="sb-toolbar__divider" aria-hidden />
        <SegmentedControl
          size="sm"
          aria-label="View mode"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "canvas", icon: <SquareMousePointer size={14} />, tooltip: "Canvas only", shortcut: "Alt+1" },
            { value: "split", icon: splitDirection === "rows" ? <Rows2 size={14} /> : <Columns2 size={14} />, tooltip: "Canvas and patches", shortcut: "Alt+2" },
            { value: "patches", icon: <Workflow size={14} />, tooltip: "Patches only", shortcut: "Alt+3" },
          ]}
        />
        <IconButton
          icon={splitDirection === "rows" ? <Columns2 size={15} /> : <Rows2 size={15} />}
          label={splitDirection === "rows" ? "Put patches beside the canvas" : "Put patches below the canvas"}
          disabled={viewMode !== "split"}
          onClick={toggleSplitDirection}
        />
      </div>

      <div className="sb-toolbar__right">
        <button type="button" className="sb-toolbar__search" onClick={onOpenPalette}>
          <Search size={13} strokeWidth={2} aria-hidden />
          <span className="sb-toolbar__search-label">Search commands</span>
          <Kbd shortcut="Mod+K" variant="plain" />
        </button>
        {claude}
        <span className="sb-toolbar__divider" aria-hidden />
        <IconButton icon={<BookOpen size={15} />} label="Learn" shortcut="Mod+/" active={drawer === "learn"} onClick={() => toggleDrawer("learn")} />
        <IconButton icon={theme === "dark" ? <Sun size={15} /> : <Moon size={15} />} label={theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={toggleTheme} />
      </div>
    </header>
  );
}
