import { DEVICE_PRESETS, type DevicePreset } from "@sonobe/core";
import {
  BookOpen,
  ChevronDown,
  Columns2,
  Copy,
  Download,
  FolderOpen,
  Monitor,
  Moon,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Rows2,
  Scaling,
  Search,
  Share2,
  Smartphone,
  Sparkles,
  SquareMousePointer,
  Sun,
  Tablet,
  Watch,
  Workflow,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTheme } from "../theme/ThemeProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Menu } from "../ui/Menu.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../ui/Select.tsx";
import { toast } from "../ui/Toast.tsx";
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

function DocumentMenu({ title, onRename }: { title: string; onRename: () => void }) {
  return (
    <Menu
      aria-label="Document"
      entries={[
        { id: "rename", label: "Rename…", icon: <Pencil size={14} />, onSelect: onRename },
        { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, shortcut: "Mod+Shift+S", onSelect: () => toast({ title: `Duplicated “${title}”`, tone: "success" }) },
        { type: "separator" },
        {
          id: "export",
          label: "Export",
          icon: <Download size={14} />,
          submenu: [
            { id: "export_video", label: "Video…", description: "MP4 at device resolution" },
            { id: "export_gif", label: "Animated GIF…" },
            { type: "separator" },
            { id: "export_bundle", label: "Project bundle (.sonobez)" },
          ],
        },
        { id: "reveal", label: "Show in Folder", icon: <FolderOpen size={14} /> },
      ]}
    >
      <button type="button" className="sb-toolbar__doc">
        <span className="sb-toolbar__doc-title">{title}</span>
        <ChevronDown size={12} strokeWidth={2} className="sb-toolbar__doc-chevron" aria-hidden />
      </button>
    </Menu>
  );
}

function DocumentTitle({ title }: { title: string }) {
  const [name, setName] = useState(title);
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="sb-toolbar__doc-input"
        aria-label="Document name"
        defaultValue={name}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          setName(event.currentTarget.value.trim() || name);
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.stopPropagation();
            event.currentTarget.value = name;
            event.currentTarget.blur();
          }
        }}
      />
    );
  }
  return <DocumentMenu title={name} onRename={() => setEditing(true)} />;
}

function PresenceAndShare({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  return (
    <>
      <button type="button" className="sb-presence" onClick={onOpenAssistant} aria-label="Claude is connected. Open the assistant">
        <span className="sb-presence__avatar" aria-hidden>
          <Sparkles size={11} strokeWidth={2} />
        </span>
        <span className="sb-presence__label">Claude</span>
        <span className="sb-presence__dot" aria-hidden />
      </button>
      <Button
        size="sm"
        variant="primary"
        icon={<Share2 size={13} strokeWidth={2} />}
        onClick={() => toast({ title: "Preview link copied", description: "Open it on a phone on the same Wi-Fi to try the prototype.", tone: "success" })}
      >
        Share
      </Button>
    </>
  );
}

export interface ToolbarProps {
  documentTitle: string;
  deviceId: string;
  onDeviceChange: (id: string) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  onOpenPalette: () => void;
  /** Replaces the device picker. */
  devicePicker?: ReactNode;
  /** Replaces the Claude presence and Share button. */
  share?: ReactNode;
}

export function Toolbar({ documentTitle, deviceId, onDeviceChange, playing, onTogglePlay, onRestart, onOpenPalette, devicePicker, share }: ToolbarProps) {
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
        <DocumentTitle title={documentTitle} />
        <span className="sb-toolbar__divider" aria-hidden />
        {devicePicker ?? <DevicePicker value={deviceId} onChange={onDeviceChange} />}
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
        {share ?? <PresenceAndShare onOpenAssistant={() => toggleDrawer("assistant")} />}
        <span className="sb-toolbar__divider" aria-hidden />
        <IconButton icon={<BookOpen size={15} />} label="Learn" shortcut="Mod+/" active={drawer === "learn"} onClick={() => toggleDrawer("learn")} />
        <IconButton icon={<Sparkles size={15} />} label="Assistant" shortcut="Mod+L" active={drawer === "assistant"} onClick={() => toggleDrawer("assistant")} />
        <IconButton
          icon={theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          onClick={toggleTheme}
        />
      </div>
    </header>
  );
}
