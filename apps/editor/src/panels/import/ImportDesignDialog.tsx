import { ChevronRight, CircleAlert, Code, Globe, ScanLine, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { CopyBlock } from "../connect/CopyBlock.tsx";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select } from "../../ui/Select.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { canImportUrl, importDesign, importViewport, notifyImported, type ImportDeps, type ImportDesignRequest } from "./importDesign.ts";
import "../connect/connect.css";
import "./importDesign.css";

export type ImportTab = "url" | "html" | "claude";

const URL_KEY = "sonobe.import.url";
const TAB_KEY = "sonobe.import.tab";

/** What to ask Claude, from a repo with the app open in Claude Code. */
export const IMPORT_PROMPTS: readonly string[] = [
  "Import the settings screen from my app into Sonobe. The dev server runs on localhost:3000.",
  "Rebuild ProfileView from my SwiftUI code as HTML, import it into Sonobe, then make the Follow button bounce when I tap it.",
  "Design a music player screen, import it into Sonobe, and make the play button morph into pause with a spring.",
];

export interface ImportDesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: ImportTab;
  /** For tests: the desktop bridge and HTML capture. */
  deps?: ImportDeps;
}

/** Import Design: bring a screen from a running app, from HTML, or through Claude, onto the canvas as real layers. */
export function ImportDesignDialog({ open, onOpenChange, initialTab, deps }: ImportDesignDialogProps) {
  const titleId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-labelledby={titleId} width={560} className="sb-import-dialog" modalScope="import" closeOnOverlayClick={false} style={{ maxHeight: "min(720px, calc(100vh - 48px))" }}>
      <ImportContent titleId={titleId} onClose={() => onOpenChange(false)} {...(initialTab ? { initialTab } : {})} {...(deps ? { deps } : {})} />
    </Dialog>
  );
}

function ImportContent({ titleId, onClose, initialTab, deps }: { titleId: string; onClose: () => void; initialTab?: ImportTab; deps?: ImportDeps }) {
  const session = useEditorSession();
  const urlSupported = canImportUrl(deps);
  const [tab, setTab] = useState<ImportTab>(() => initialTab ?? ((readString(TAB_KEY) as ImportTab | null) ?? (urlSupported ? "url" : "html")));
  const [url, setUrl] = useState(() => readString(URL_KEY) ?? "http://localhost:3000/");
  const [html, setHtml] = useState("");
  const [name, setName] = useState("");
  const [selector, setSelector] = useState("");
  const [waitFor, setWaitFor] = useState("");
  const [fullPage, setFullPage] = useState(true);
  const [scrolling, setScrolling] = useState(true);
  const [dark, setDark] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  /** What the running import is doing ("Downloading images: 7 of 28"). */
  const [status, setStatus] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const [problem, setProblem] = useState<{ message: string; hint?: string } | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const [width, height] = importViewport(session);
  const doc = useStore(session.document, (s) => s.doc);
  const componentId = session.currentComponentId();
  // Screens are top-level groups; the selected one is the likeliest to refresh.
  const screens = useMemo(() => (doc.components[componentId]?.layers ?? []).filter((l) => l.type === "group").reverse(), [doc, componentId]);
  const [target, setTarget] = useState<string>(() => {
    const selected = session.selection.getState().layers[0];
    return selected && screens.some((l) => l.id === selected) ? `replace:${selected}` : "new";
  });

  useEffect(() => writeString(TAB_KEY, tab), [tab]);
  // Closing the dialog while an import runs cancels it.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    setProblem(null);
    if (tab === "url") urlRef.current?.focus();
    if (tab === "html") htmlRef.current?.focus();
  }, [tab]);

  const trimmedUrl = url.trim();
  const validUrl = /^https?:\/\/\S+$/i.test(trimmedUrl);
  const canSubmit = !busy && ((tab === "url" && urlSupported && validUrl) || (tab === "html" && html.trim() !== ""));

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);
    const request: ImportDesignRequest = {
      ...(tab === "url" ? { url: trimmedUrl } : { html }),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(selector.trim() ? { selector: selector.trim() } : {}),
      ...(waitFor.trim() ? { waitFor: waitFor.trim() } : {}),
      ...(!fullPage ? { fullPage: false } : {}),
      ...(dark ? { colorScheme: "dark" as const } : {}),
      ...(target.startsWith("replace:") ? { replace: target.slice("replace:".length) } : {}),
      scrolling,
    };
    if (tab === "url") writeString(URL_KEY, trimmedUrl);
    const controller = new AbortController();
    running.current = controller;
    try {
      const outcome = await importDesign(session, request, deps, {
        signal: controller.signal,
        onProgress: (message) => {
          if (!controller.signal.aborted) setStatus(message);
        },
      });
      // A cancel is the person's choice, not a problem to show.
      if (outcome.cancelled || controller.signal.aborted) return;
      if (!outcome.ok) {
        setProblem({ message: outcome.message ?? "The design couldn't be imported.", ...(outcome.hint ? { hint: outcome.hint } : {}) });
        return;
      }
      notifyImported(toast, `Imported “${outcome.screenName}”`, outcome);
      onClose();
    } catch (err) {
      if (!controller.signal.aborted) setProblem({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (running.current === controller) running.current = null;
      setBusy(false);
      setStatus(null);
    }
  };

  const cancelImport = () => running.current?.abort();

  return (
    <form className="sb-import" onSubmit={(event) => void submit(event)}>
      <header className="sb-import__header">
        <span className="sb-import__mark" aria-hidden>
          <ScanLine size={16} strokeWidth={2} />
        </span>
        <div className="sb-import__heading">
          <h2 className="sb-import__title" id={titleId}>
            Import Design
          </h2>
          <p className="sb-import__subtitle">Bring a screen from your app onto the canvas as real layers: backgrounds, text, images, icons and text fields you can wire up and animate.</p>
        </div>
        <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
      </header>

      <div className="sb-import__body sb-scroll">
        <SegmentedControl<ImportTab>
          fullWidth
          aria-label="Import from"
          value={tab}
          onChange={setTab}
          options={[
            { value: "url", label: "From URL", icon: <Globe size={13} /> },
            { value: "html", label: "Paste HTML", icon: <Code size={13} /> },
            { value: "claude", label: "With Claude", icon: <Sparkles size={13} /> },
          ]}
        />

        {tab === "url" && (
          <section className="sb-import__section" aria-label="From URL">
            {!urlSupported && (
              <p className="sb-import__note" role="status">
                <CircleAlert size={13} strokeWidth={2} aria-hidden />
                <span>Importing from a URL needs the Sonobe desktop app: a browser tab can't read another site's layout. Paste the page's HTML instead.</span>
              </p>
            )}
            <label className="sb-import__field">
              <span className="sb-import__label">Page address</span>
              <TextField ref={urlRef} mono value={url} disabled={!urlSupported || busy} placeholder="http://localhost:3000/settings" onChange={(event) => setUrl(event.target.value)} aria-label="Page address" invalid={trimmedUrl !== "" && !validUrl} spellCheck={false} />
              <span className="sb-import__hint">Start your app's dev server and open the screen you want. Storybook stories work too.</span>
            </label>
          </section>
        )}

        {tab === "html" && (
          <section className="sb-import__section" aria-label="Paste HTML">
            <label className="sb-import__field">
              <span className="sb-import__label">HTML</span>
              <textarea ref={htmlRef} className="sb-import__code sb-scroll sb-selectable" value={html} disabled={busy} spellCheck={false} placeholder={'<!doctype html>\n<html>\n  <head><style>…</style></head>\n  <body>…</body>\n</html>'} onChange={(event) => setHtml(event.target.value)} aria-label="HTML" onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
              }} />
              <span className="sb-import__hint">
                A complete page with its CSS. Put <code>data-name="Like Button"</code> on elements to name their layers.
              </span>
            </label>
          </section>
        )}

        {tab === "claude" && (
          <section className="sb-import__section" aria-label="With Claude">
            <p className="sb-import__text">Claude can import screens straight from your code. It opens your running app, or rebuilds the screen from source when the app isn't a web app (SwiftUI, React Native, Flutter), then wires up the interactions you describe.</p>
            <ol className="sb-import__steps">
              <li>
                <span className="sb-import__step-title">Connect Claude Code or Claude Desktop</span>
                <Button size="sm" variant="ai" icon={<Sparkles size={12} />} onClick={() => connectClaudeStore.getState().show()}>
                  Connect Claude…
                </Button>
              </li>
              <li>
                <span className="sb-import__step-title">In your app's folder, ask</span>
                {IMPORT_PROMPTS.map((prompt) => (
                  <CopyBlock key={prompt} text={prompt} label="Prompt" kind="prompt" />
                ))}
              </li>
            </ol>
          </section>
        )}

        {tab !== "claude" && (
          <section className="sb-import__section" aria-label="Options">
            <div className="sb-import__row">
              <label className="sb-import__field sb-import__field--grow">
                <span className="sb-import__label">Screen name</span>
                <TextField value={name} disabled={busy} placeholder="From the page title" onChange={(event) => setName(event.target.value)} aria-label="Screen name" />
              </label>
              <div className="sb-import__field">
                <span className="sb-import__label">Size</span>
                <span className="sb-import__size sb-tabular">
                  {width} × {height}
                </span>
              </div>
            </div>
            {screens.length > 0 && (
              <div className="sb-import__field">
                <span className="sb-import__label">Add to the prototype</span>
                <Select
                  aria-label="Add to the prototype"
                  value={target}
                  onChange={setTarget}
                  options={[
                    { value: "new", label: "As a new screen" },
                    ...screens.map((l) => ({ value: `replace:${l.id}`, label: `Replace “${l.name}”`, description: "Keeps the wiring of layers it finds again", group: "Refresh an earlier import" })),
                  ]}
                />
              </div>
            )}
            <button type="button" className="sb-import__more" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
              <ChevronRight size={13} strokeWidth={2} className="sb-import__chevron" aria-hidden />
              More options
            </button>
            {showMore && (
              <div className="sb-import__options">
                <label className="sb-import__field">
                  <span className="sb-import__label">Only this element</span>
                  <TextField mono size="sm" value={selector} disabled={busy} placeholder="#pricing-card" onChange={(event) => setSelector(event.target.value)} aria-label="Only this element" spellCheck={false} />
                </label>
                <label className="sb-import__field">
                  <span className="sb-import__label">Wait for</span>
                  <TextField mono size="sm" value={waitFor} disabled={busy} placeholder="[data-loaded]" onChange={(event) => setWaitFor(event.target.value)} aria-label="Wait for" spellCheck={false} />
                </label>
                <Toggle size="sm" checked={fullPage} onChange={setFullPage} label="Import the whole page, not just the first screen" />
                <Toggle size="sm" checked={scrolling} onChange={setScrolling} label="Make long pages and scroll areas scroll" />
                {urlSupported && <Toggle size="sm" checked={dark} onChange={setDark} label="Dark appearance" />}
              </div>
            )}
          </section>
        )}

        {problem && (
          <div className="sb-import__problem" role="alert">
            <CircleAlert size={14} strokeWidth={2} aria-hidden />
            <div>
              <div className="sb-import__problem-title">{problem.message}</div>
              {problem.hint && <div className="sb-import__problem-hint">{problem.hint}</div>}
            </div>
          </div>
        )}
      </div>

      <footer className="sb-import__footer">
        <span className="sb-import__status" aria-live="polite">
          {busy ? (status ?? (tab === "url" ? "Loading the page…" : "Rendering the HTML…")) : ""}
        </span>
        {/* While an import runs, Cancel stops it and keeps the dialog open. */}
        <Button onClick={busy ? cancelImport : onClose}>{tab === "claude" ? "Done" : "Cancel"}</Button>
        {tab !== "claude" && (
          <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit}>
            Import
          </Button>
        )}
      </footer>
    </form>
  );
}
