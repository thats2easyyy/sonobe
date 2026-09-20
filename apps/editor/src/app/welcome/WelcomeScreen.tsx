import { DEVICE_PRESETS, getDevicePreset, type DevicePreset } from "@sonobe/core";
import { ArrowRight, Check, Clock, FilePlus, FolderOpen, GraduationCap, Monitor, Plug, Scaling, Smartphone, Sparkles, Tablet, Watch, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { openExample, type ExampleProject } from "../../panels/learn/examples.ts";
import { LESSONS } from "../../panels/learn/lessons/catalog.ts";
import { useLessons } from "../../panels/learn/lessons/lessonStore.ts";
import { connectClaudeStore } from "../../panels/connect/connectStore.ts";
import { SonobeMark } from "../../shell/icons.tsx";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { useCommands } from "../../ui/commands/CommandProvider.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { learnNav } from "../learnStore.ts";
import { settingsStore, useSettings } from "../settings.ts";
import { RecoveredDrafts } from "./RecoveredDrafts.tsx";
import { getTemplates, thumbnailFor } from "./templates.ts";
import type { WelcomeReason } from "./welcomeStore.ts";
import "./welcome.css";

const KIND_ICONS: Record<DevicePreset["kind"], typeof Smartphone> = { phone: Smartphone, tablet: Tablet, computer: Monitor, watch: Watch, custom: Scaling };
const KIND_LABELS: Record<DevicePreset["kind"], string> = { phone: "Phones", tablet: "Tablets", computer: "Desktop", watch: "Watch", custom: "Custom" };

const DEVICE_OPTIONS: SelectOption[] = DEVICE_PRESETS.map((d) => {
  const Icon = KIND_ICONS[d.kind];
  return { value: d.id, label: d.name, group: KIND_LABELS[d.kind], icon: <Icon size={14} strokeWidth={1.75} />, trailing: `${d.size[0]}×${d.size[1]}`, keywords: [d.platform, d.kind] };
});

export interface WelcomeScreenProps {
  open: boolean;
  reason: WelcomeReason;
  onClose: () => void;
}

/**
 * The start screen: New Blank with a device, Open, recent prototypes, templates with thumbnails,
 * the lesson path, and Connect Claude. Shown on the first launch, from File → New, and after Close.
 */
export function WelcomeScreen({ open, reason, onClose }: WelcomeScreenProps) {
  const titleId = useId();
  const createRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} aria-labelledby={titleId} width="min(1120px, calc(100vw - 48px))" className="sb-welcome" modalScope="welcome" initialFocusRef={createRef} style={{ maxHeight: "min(800px, calc(100vh - 48px))" }}>
      <WelcomeContent titleId={titleId} reason={reason} onClose={onClose} createRef={createRef} />
    </Dialog>
  );
}

interface ContentProps {
  titleId: string;
  reason: WelcomeReason;
  onClose: () => void;
  createRef: React.RefObject<HTMLButtonElement | null>;
}

function WelcomeContent({ titleId, reason, onClose, createRef }: ContentProps) {
  const session = useEditorSession();
  const { registry } = useCommands();
  const docName = useDocument((s) => s.doc.project.name);
  const defaultDevice = useSettings((s) => s.defaultDevice);
  const showOnLaunch = useSettings((s) => s.showWelcomeOnLaunch);
  const completed = useLessons((s) => s.completed);
  const [device, setDevice] = useState(defaultDevice);
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const templates = useMemo(() => getTemplates(), []);
  const canOpen = registry.isEnabled("file.open");

  useEffect(() => {
    let cancelled = false;
    void session.host
      ?.recentProjects()
      .then((paths) => {
        if (!cancelled) setRecent(paths.slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);

  const newBlank = async () => {
    setBusy("blank");
    try {
      if (!(await session.confirmDiscardChanges("new"))) return;
      session.document.getState().newDocument({ device });
      session.selection.getState().setComponentPath([session.document.getState().doc.project.root]);
      if (device !== defaultDevice) settingsStore.getState().update({ defaultDevice: device });
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const openTemplate = async (example: ExampleProject) => {
    setBusy(example.folder);
    try {
      const result = await openExample(session, example);
      if (result.ok) {
        onClose();
        toast.success(`Opened “${example.name}”`, { description: "It's a copy. Save it to keep your changes." });
      } else if (result.error) {
        toast.error(`Couldn't open “${example.name}”`, { description: result.error });
      }
    } finally {
      setBusy(null);
    }
  };

  const openRecent = async (path: string) => {
    setBusy(path);
    try {
      const result = await session.openProject(path);
      if (result.ok) onClose();
      else if (!result.cancelled) toast.error("Couldn't open the prototype", { description: result.error ?? "It may have moved or been deleted." });
    } finally {
      setBusy(null);
    }
  };

  const openFile = () => {
    onClose();
    requestAnimationFrame(() => registry.run("file.open"));
  };

  const openLesson = (id: string) => {
    onClose();
    learnNav.getState().open({ kind: "lesson", id });
  };

  const connect = () => {
    onClose();
    connectClaudeStore.getState().show();
  };

  const preset = getDevicePreset(device);
  const canKeepWorking = reason === "launch" || reason === "menu";

  return (
    <div className="sb-welcome__frame">
      <header className="sb-welcome__header">
        <span className="sb-welcome__mark" aria-hidden>
          <SonobeMark size={26} />
        </span>
        <div className="sb-welcome__heading">
          <h2 className="sb-welcome__title" id={titleId}>
            {reason === "launch" ? "Welcome to Sonobe" : "Start something new"}
          </h2>
          <p className="sb-welcome__subtitle">Make interactive prototypes by connecting patches. No code needed, and every idea teaches you how it works.</p>
        </div>
        <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
      </header>

      <div className="sb-welcome__body sb-scroll">
        <aside className="sb-welcome__side" aria-label="Start">
          <section className="sb-welcome__card sb-welcome__blank" aria-labelledby={`${titleId}-blank`}>
            <div className="sb-welcome__blank-preview" data-kind={preset.kind} aria-hidden>
              <span className="sb-welcome__blank-screen" style={{ aspectRatio: `${preset.size[0]} / ${preset.size[1]}` }} />
            </div>
            <h3 className="sb-welcome__card-title" id={`${titleId}-blank`}>
              New blank prototype
            </h3>
            <Select aria-label="Device for the new prototype" options={DEVICE_OPTIONS} value={device} onChange={setDevice} searchable menuWidth={272} />
            <Button ref={createRef} variant="primary" icon={<FilePlus size={13} />} fullWidth loading={busy === "blank"} onClick={() => void newBlank()}>
              Create
            </Button>
          </section>

          <RecoveredDrafts titleId={titleId} onOpened={onClose} />

          <section className="sb-welcome__section" aria-labelledby={`${titleId}-recent`}>
            <div className="sb-welcome__section-head">
              <h3 className="sb-welcome__section-title" id={`${titleId}-recent`}>
                Recent
              </h3>
              {canOpen && (
                <Button size="sm" variant="ghost" icon={<FolderOpen size={12} />} onClick={openFile}>
                  Open… <Kbd shortcut="Mod+O" variant="plain" />
                </Button>
              )}
            </div>
            {recent.length === 0 ? (
              <p className="sb-welcome__empty">Prototypes you open or save show up here.</p>
            ) : (
              <ul className="sb-welcome__recent">
                {recent.map((path) => (
                  <li key={path}>
                    <button type="button" className="sb-welcome__recent-item" onClick={() => void openRecent(path)} disabled={busy === path} title={path}>
                      <Clock size={13} strokeWidth={1.75} aria-hidden />
                      <span className="sb-welcome__recent-name">{session.host?.displayName(path) ?? path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sb-welcome__card sb-welcome__claude" aria-labelledby={`${titleId}-claude`}>
            <span className="sb-welcome__claude-icon" aria-hidden>
              <Sparkles size={15} strokeWidth={2} />
            </span>
            <h3 className="sb-welcome__card-title" id={`${titleId}-claude`}>
              Build with Claude
            </h3>
            <p className="sb-welcome__card-text">Use Claude Desktop or Claude Code on your own Claude plan. Describe an interaction and watch it get built, one undoable step at a time.</p>
            <Button size="sm" variant="ai" icon={<Plug size={12} />} onClick={connect}>
              Connect Claude
            </Button>
          </section>
        </aside>

        <div className="sb-welcome__main">
          <section className="sb-welcome__section" aria-labelledby={`${titleId}-learn`}>
            <div className="sb-welcome__section-head">
              <h3 className="sb-welcome__section-title" id={`${titleId}-learn`}>
                <GraduationCap size={13} strokeWidth={2} aria-hidden /> Learn Sonobe
              </h3>
              <span className="sb-welcome__hint">Hands-on lessons that check your work as you go</span>
            </div>
            <ol className="sb-welcome__path">
              {LESSONS.map((lesson) => {
                const done = completed[lesson.id] !== undefined;
                return (
                  <li key={lesson.id} className="sb-welcome__stop" data-done={done || undefined}>
                    <button type="button" className="sb-welcome__stop-button" onClick={() => openLesson(lesson.id)}>
                      <span className="sb-welcome__stop-number sb-tabular" aria-hidden>
                        {done ? <Check size={12} strokeWidth={2.75} /> : lesson.number}
                      </span>
                      <span className="sb-welcome__stop-title">{lesson.title}</span>
                      <span className="sb-welcome__stop-meta">
                        {lesson.minutes} min{done ? " · Done" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="sb-welcome__section" aria-labelledby={`${titleId}-templates`}>
            <div className="sb-welcome__section-head">
              <h3 className="sb-welcome__section-title" id={`${titleId}-templates`}>
                Start from a template
              </h3>
              <span className="sb-welcome__hint">Each opens as a copy with step-by-step notes</span>
            </div>
            <ul className="sb-welcome__templates">
              {templates.map((example) => {
                const thumbnail = thumbnailFor(example.folder);
                return (
                  <li key={example.folder}>
                    <button type="button" className="sb-template" onClick={() => void openTemplate(example)} disabled={busy === example.folder} aria-describedby={example.description ? `${titleId}-t-${example.id}` : undefined}>
                      <span className="sb-template__thumb">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="sb-template__placeholder" />}</span>
                      <span className="sb-template__name">{example.name}</span>
                      {example.description && (
                        <span className="sb-template__desc" id={`${titleId}-t-${example.id}`}>
                          {example.description}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      <footer className="sb-welcome__footer">
        <Toggle size="sm" checked={showOnLaunch} onChange={(checked) => settingsStore.getState().update({ showWelcomeOnLaunch: checked })} label="Show this screen when Sonobe starts" />
        <span className="sb-welcome__spacer" />
        {canKeepWorking && (
          <Button variant="ghost" trailingIcon={<ArrowRight size={13} />} onClick={onClose}>
            Keep working on “{docName}”
          </Button>
        )}
      </footer>
    </div>
  );
}
