import { DEVICE_PRESETS, getDevicePreset, type DevicePreset } from "@sonobe/core";
import { ArrowRight, Check, FilePlus, FolderOpen, Monitor, Plug, Scaling, Smartphone, Tablet, Watch, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { openExample, type ExampleProject } from "../../panels/learn/examples.ts";
import { LESSONS } from "../../panels/learn/lessons/catalog.ts";
import { useLessons } from "../../panels/learn/lessons/lessonStore.ts";
import { connectClaudeStore } from "../../panels/connect/connectStore.ts";
import { DEMO_DOCUMENT_NAME } from "../../state/demoDocument.ts";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { useCommands } from "../../ui/commands/CommandProvider.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { learnNav } from "../learnStore.ts";
import { settingsStore, useSettings } from "../settings.ts";
import { recentFolder } from "./recent.ts";
import { RecoveredDrafts } from "./RecoveredDrafts.tsx";
import { getTemplates, templateTag, thumbnailFor } from "./templates.ts";
import { Tip, TruncatedText } from "./Tip.tsx";
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
  const untouchedDemo = useDocument((s) => !s.dirty && s.projectPath === null && s.doc.project.name === DEMO_DOCUMENT_NAME);
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

  const openProject = async (key: string, path?: string) => {
    setBusy(key);
    try {
      const result = await session.openProject(path);
      if (result.ok) onClose();
      else if (!result.cancelled) toast.error("Couldn't open the prototype", { description: result.error ?? "It may have moved or been deleted." });
    } finally {
      setBusy(null);
    }
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
  const nextLesson = LESSONS.find((lesson) => completed[lesson.id] === undefined);
  const featured = LESSONS.every((lesson) => completed[lesson.id] === undefined) ? LESSONS[0] : undefined;

  return (
    <div className="sb-welcome__frame">
      <header className="sb-welcome__header">
        <div className="sb-welcome__heading">
          <h2 className="sb-welcome__title" id={titleId}>
            {reason === "launch" ? "Welcome to Sonobe" : "Start something new"}
          </h2>
          {reason === "launch" && <p className="sb-welcome__subtitle">Make interactive prototypes by connecting patches. No code needed.</p>}
        </div>
        <IconButton size="sm" className="sb-welcome__close" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
      </header>

      <div className="sb-welcome__body">
        <aside className="sb-welcome__side sb-scroll" aria-label="Start">
          <section className="sb-welcome__card sb-welcome__blank" aria-labelledby={`${titleId}-blank`}>
            <div className="sb-welcome__blank-preview" aria-hidden>
              <span className="sb-welcome__blank-screen" style={{ aspectRatio: `${preset.size[0]} / ${preset.size[1]}` }} />
            </div>
            <h3 className="sb-welcome__card-title" id={`${titleId}-blank`}>
              New blank prototype
            </h3>
            <Select aria-label="Device for the new prototype" options={DEVICE_OPTIONS} value={device} onChange={setDevice} searchable menuWidth={272} />
            <div className="sb-welcome__create">
              <Button ref={createRef} variant="primary" size="lg" icon={<FilePlus size={14} />} loading={busy === "blank"} onClick={() => void newBlank()}>
                Create
              </Button>
              {canOpen && (
                <Button variant="ghost" size="lg" icon={<FolderOpen size={14} />} loading={busy === "open"} onClick={() => void openProject("open")}>
                  Open… <Kbd shortcut="Mod+O" variant="plain" />
                </Button>
              )}
            </div>
          </section>

          <RecoveredDrafts titleId={titleId} onOpened={onClose} />

          {recent.length > 0 && (
            <section className="sb-welcome__section" aria-labelledby={`${titleId}-recent`}>
              <h3 className="sb-welcome__section-title" id={`${titleId}-recent`}>
                Recent
              </h3>
              <ul className="sb-welcome__recent">
                {recent.map((path) => {
                  const folder = recentFolder(path);
                  return (
                    <li key={path}>
                      <Tooltip content={<Tip>{path}</Tip>} placement="right">
                        <button type="button" className="sb-welcome__recent-item" onClick={() => void openProject(path, path)} disabled={busy === path}>
                          <span className="sb-welcome__recent-name">{session.host?.displayName(path) ?? path}</span>
                          {folder && <span className="sb-welcome__recent-folder">{folder}</span>}
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="sb-welcome__section sb-welcome__claude" aria-labelledby={`${titleId}-claude`}>
            <h3 className="sb-welcome__card-title" id={`${titleId}-claude`}>
              Build with Claude
            </h3>
            <p className="sb-welcome__card-text">Describe an interaction and watch Claude build it, one undoable step at a time.</p>
            <Button variant="ai" icon={<Plug size={14} strokeWidth={1.75} />} onClick={connect}>
              Connect Claude
            </Button>
          </section>
        </aside>

        <div className="sb-welcome__main sb-scroll">
          <section className="sb-welcome__section" aria-labelledby={`${titleId}-learn`}>
            <h3 className="sb-welcome__section-title" id={`${titleId}-learn`}>
              Learn Sonobe
            </h3>
            <ol className="sb-welcome__path" data-featured={featured ? "" : undefined}>
              {LESSONS.map((lesson) => {
                const done = completed[lesson.id] !== undefined;
                return (
                  <li key={lesson.id} className="sb-welcome__stop" data-done={done || undefined} data-next={lesson === nextLesson || undefined} data-featured={lesson === featured || undefined}>
                    <button type="button" className="sb-welcome__stop-button" onClick={() => openLesson(lesson.id)}>
                      <span className="sb-welcome__stop-number sb-tabular" aria-hidden>
                        {done ? <Check size={12} strokeWidth={2.75} /> : lesson.number}
                      </span>
                      <span className="sb-welcome__stop-title">{lesson.title}</span>
                      {lesson === featured && <span className="sb-welcome__stop-summary">{lesson.summary}</span>}
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
              {templates.map((example) => (
                <li key={example.folder}>
                  <TemplateButton example={example} describedBy={example.description ? `${titleId}-t-${example.id}` : undefined} disabled={busy === example.folder} onOpen={() => void openTemplate(example)} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer className="sb-welcome__footer">
        <Toggle className="sb-welcome__toggle" size="sm" checked={showOnLaunch} onChange={(checked) => settingsStore.getState().update({ showWelcomeOnLaunch: checked })} label="Show this screen when Sonobe starts" />
        <span className="sb-welcome__spacer" />
        {canKeepWorking && (
          <Button variant="ghost" trailingIcon={<ArrowRight size={13} />} onClick={onClose}>
            {untouchedDemo ? (
              `Explore the ${DEMO_DOCUMENT_NAME} demo`
            ) : (
              <>
                Keep working on “<TruncatedText text={docName} className="sb-welcome__doc-name" />”
              </>
            )}
          </Button>
        )}
      </footer>
    </div>
  );
}

function TemplateButton({ example, describedBy, disabled, onOpen }: { example: ExampleProject; describedBy: string | undefined; disabled: boolean; onOpen: () => void }) {
  const thumbnail = thumbnailFor(example.folder);
  const tag = templateTag(example);
  const button = (
    <button type="button" className="sb-template" onClick={onOpen} disabled={disabled} aria-describedby={describedBy}>
      <span className="sb-template__thumb">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="sb-template__placeholder" />}</span>
      <span className="sb-template__name">{example.name}</span>
      {tag && <span className="sb-template__tag">{tag}</span>}
      {example.description && (
        <span className="sb-visually-hidden" id={describedBy}>
          {example.description}
        </span>
      )}
    </button>
  );
  return example.description ? <Tooltip content={<Tip>{example.description}</Tip>}>{button}</Tooltip> : button;
}
