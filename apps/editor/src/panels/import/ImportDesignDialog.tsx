import { ChevronRight, CircleAlert, Code, Globe, Plug, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { CopyBlock } from "../connect/CopyBlock.tsx";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DIALOG_WIDTH } from "../../ui/Dialog.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select } from "../../ui/Select.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { assistantStore } from "../assistant/assistantStore.ts";
import { sharedAssistantController } from "../assistant/controller.ts";
import { chatProvider } from "../assistant/provider.ts";
import { getAssistantHost, supportsAssistant } from "../assistant/types.ts";
import { designStore } from "../design/designStore.ts";
import { HologramScanner, scannerFrame } from "./HologramScanner.tsx";
import { canImportUrl, importDesign, importViewport, notifyImported, type ImportDeps, type ImportDesignRequest } from "./importDesign.ts";
import "../connect/connect.css";
import "./importDesign.css";
import "../design/design.css";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={DIALOG_WIDTH.md} className="sb-import-dialog" modalScope="import" closeOnOverlayClick={false} style={{ maxHeight: "min(720px, calc(100vh - 48px))" }}>
      <ImportContent onClose={() => onOpenChange(false)} {...(initialTab ? { initialTab } : {})} {...(deps ? { deps } : {})} />
    </Dialog>
  );
}

function ImportContent({ onClose, initialTab, deps }: { onClose: () => void; initialTab?: ImportTab; deps?: ImportDeps }) {
  const session = useEditorSession();
  const urlSupported = canImportUrl(deps);
  const [assistantAvailable] = useState(() => supportsAssistant(getAssistantHost()));
  // The experimental switch in Settings → Claude puts the Assistant on the person's Claude subscription.
  const onSubscription = useStore(assistantStore, (s) => chatProvider(s.status) === "subscription");
  const [tab, setTab] = useState<ImportTab>(() => {
    const wanted = initialTab ?? (readString(TAB_KEY) as ImportTab | null) ?? "url";
    return wanted === "url" && !urlSupported ? "html" : wanted;
  });
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
  const cancelRef = useRef<HTMLButtonElement>(null);
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
  // The With Claude tab says what the Assistant runs on.
  useEffect(() => {
    if (assistantAvailable && tab === "claude") void sharedAssistantController().refresh();
  }, [assistantAvailable, tab]);
  // Closing the dialog while an import runs cancels it.
  useEffect(() => () => running.current?.abort(), []);
  // The form goes inert while an import runs; Cancel is the one control left.
  useEffect(() => {
    if (busy) cancelRef.current?.focus();
  }, [busy]);
  useEffect(() => {
    setProblem(null);
    if (tab === "url") urlRef.current?.focus();
    if (tab === "html") htmlRef.current?.focus();
  }, [tab]);

  const trimmedUrl = url.trim();
  const validUrl = /^https?:\/\/\S+$/i.test(trimmedUrl);
  const canSubmit = !busy && ((tab === "url" && validUrl) || (tab === "html" && html.trim() !== ""));

  const submitBlocker =
    tab === "claude"
      ? "Claude does the importing. Copy a prompt above."
      : tab === "url" && !validUrl
        ? "Enter an address that starts with http:// or https://."
        : tab === "html" && html.trim() === ""
          ? "Paste the page's HTML first."
          : undefined;

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
      <Dialog.Header title="Import Design" description="Bring a screen from your app onto the canvas as layers you can animate." onClose={onClose} />

      <Dialog.Body className="sb-import__body">
        <div className="sb-import__content" inert={busy}>
          <SegmentedControl<ImportTab>
            size="sm"
            fullWidth
            aria-label="Import from"
            value={tab}
            onChange={setTab}
            options={[
              ...(urlSupported ? [{ value: "url" as const, label: "From URL", icon: <Globe size={13} /> }] : []),
              { value: "html", label: "Paste HTML", icon: <Code size={13} /> },
              { value: "claude", label: "With Claude", icon: <Sparkles size={13} /> },
            ]}
          />

          {tab === "url" && (
            <section className="sb-import__section" aria-label="From URL">
              <label className="sb-import__field">
                <span className="sb-import__label">Page address</span>
                <TextField ref={urlRef} mono value={url} disabled={busy} placeholder="http://localhost:3000/settings" onChange={(event) => setUrl(event.target.value)} aria-label="Page address" invalid={trimmedUrl !== "" && !validUrl} spellCheck={false} />
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
                  A complete page with its CSS. Put <code>data-name="Like Button"</code> on elements to name their layers.{!urlSupported && " To import from a URL, use the desktop app."}
                </span>
              </label>
            </section>
          )}

          {tab === "claude" && (
            <section className="sb-import__section" aria-label="With Claude">
              {assistantAvailable && (
                <div className="sb-import__assistant">
                  <p className="sb-import__text">Design it here: describe a screen and watch Claude draw it on the canvas, using {onSubscription ? "your Claude subscription" : "your own API key"}.</p>
                  <Button
                    size="sm"
                    variant="ai"
                    icon={<Sparkles size={12} />}
                    onClick={() => {
                      onClose();
                      designStore.getState().openBox();
                    }}
                  >
                    Design on the canvas…
                  </Button>
                </div>
              )}
              <p className="sb-import__text">Claude can import screens straight from your code. It opens your running app, or rebuilds the screen from source when the app isn't a web app (SwiftUI, React Native, Flutter), then builds the interactions you describe.</p>
              <ol className="sb-import__steps">
                <li>
                  <span className="sb-import__step-title">Connect Claude Code or Claude Desktop</span>
                  <Button
                    size="sm"
                    variant="ai"
                    icon={<Plug size={12} strokeWidth={1.75} />}
                    onClick={() => {
                      onClose();
                      connectClaudeStore.getState().show();
                    }}
                  >
                    Connect Claude…
                  </Button>
                </li>
                <li>
                  <span className="sb-import__step-title">In your app's folder, ask</span>
                  {IMPORT_PROMPTS.map((prompt) => (
                    <CopyBlock key={prompt} text={prompt} label="prompt" kind="prompt" />
                  ))}
                </li>
              </ol>
            </section>
          )}

          {tab !== "claude" && (
            <section className="sb-import__section" aria-label="Options">
              <label className="sb-import__field">
                <span className="sb-import__label">Screen name</span>
                <TextField value={name} disabled={busy} placeholder="From the page title" onChange={(event) => setName(event.target.value)} aria-label="Screen name" />
                <span className="sb-import__hint sb-tabular">
                  Size {width} × {height}
                </span>
              </label>
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
                <ChevronRight size={12} strokeWidth={2} className="sb-import__chevron" aria-hidden />
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
      </Dialog.Body>
      <ImportScan busy={busy} status={status ?? (tab === "url" ? "Loading the page…" : "Rendering the HTML…")} size={[width, height]} source={tab === "url" ? hostOf(trimmedUrl) : "HTML"} />

      <Dialog.Footer>
        {/* While an import runs, Cancel stops it and keeps the dialog open. */}
        {!busy && submitBlocker && (
          <p className="sb-import__reason" id="sb-import-reason">
            {submitBlocker}
          </p>
        )}
        <Button ref={cancelRef} onClick={busy ? cancelImport : onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit} aria-describedby={!busy && submitBlocker ? "sb-import-reason" : undefined}>
          Import
        </Button>
      </Dialog.Footer>
    </form>
  );
}

/** How long the scanner takes to fade out when an import stops. */
const SCAN_FADE_MS = 160;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** True while `on`, and for `ms` after it turns off (for an exit fade). */
function usePresence(on: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (on) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on || lingering;
}

/**
 * The scan phase: while a page is captured, a hologram scanner with the import's proportions covers
 * the form, with the progress beside it. It lies over the form, so the dialog keeps its size.
 */
function ImportScan({ busy, status, size, source }: { busy: boolean; status: string; size: readonly [number, number]; source: string }) {
  const present = usePresence(busy, SCAN_FADE_MS);
  const [ref, box] = useElementSize<HTMLDivElement>();
  // The last progress stays up while the scanner fades out.
  const last = useRef(status);
  useLayoutEffect(() => {
    if (busy) last.current = status;
  }, [busy, status]);
  // Room for the text beside the frame, and padding around both.
  const frame = scannerFrame(size, { width: box.width - 280, height: box.height - 56 });
  return (
    <div ref={ref} className="sb-import__scan" data-active={busy || undefined}>
      {present && frame.width > 8 && frame.height > 8 && <HologramScanner width={frame.width} height={frame.height} />}
      <div className="sb-import__scan-text">
        <p className="sb-import__scan-status" role="status">
          {busy ? status : present ? last.current : ""}
        </p>
        {present && (
          <p className="sb-import__scan-meta sb-tabular" aria-hidden>
            {size[0]} × {size[1]}
            {source ? ` · ${source}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
