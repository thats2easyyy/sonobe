import type { PatchCategory } from "@sonobe/core";
import { ArrowLeft, BookOpen, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { toast } from "../../ui/Toast.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { getExamples, openExample, type ExampleProject } from "./examples.ts";
import { GuideHome } from "./GuideHome.tsx";
import { GUIDE_ID_PREFIX, GuideReader } from "./GuideReader.tsx";
import { getGuideCatalog } from "./guides.ts";
import { readLearnView, readOpenedGuides, writeLearnView, writeOpenedGuides, type LearnView } from "./learnStorage.ts";
import { getLesson } from "./lessons/catalog.ts";
import { lessonLayout } from "./lessons/lessonLayout.ts";
import { LessonPlayer } from "./lessons/LessonPlayer.tsx";
import { LessonsHome } from "./lessons/LessonsHome.tsx";
import { listPatchReference } from "./patchReference.ts";
import { PatchReference } from "./PatchReference.tsx";
import "./learn.css";
import "./lessons/lessons.css";

export interface LearnDrawerProps {
  /** Shows a close button. The drawer host closes on Escape, except while a lesson is docked. */
  onClose?: () => void;
  /** Navigate here whenever this changes (e.g. "Learn about this patch" → { kind: "patches", type }). */
  view?: LearnView;
  /** First view when `view` isn't set. Default: the last view this viewer had open, else the lessons. */
  defaultView?: LearnView;
  onViewChange?: (view: LearnView) => void;
  /** Shows "Connect Claude" in the Working with Claude guide. */
  onConnectClaude?: () => void;
  /** Shows "Add to patch editor" in patch docs. */
  onInsertPatch?: (type: string) => void;
  className?: string;
}

type Section = "lessons" | "guides" | "patches";

const viewKey = (view: LearnView | undefined) => (view ? JSON.stringify(view) : "");

const sectionOf = (view: LearnView): Section => (view.kind === "patches" ? "patches" : view.kind === "lessons" || view.kind === "lesson" ? "lessons" : "guides");

/**
 * The Learn drawer: interactive lessons, the guides from docs/guides with a level map and a reader,
 * and the patch reference, with "Try it" for bundled examples. Fills its container; mount inside an
 * EditorProvider.
 */
export function LearnDrawer({ onClose, view, defaultView, onViewChange, onConnectClaude, onInsertPatch, className }: LearnDrawerProps) {
  const session = useEditorSession();
  const catalog = useMemo(() => getGuideCatalog(), []);
  const examples = useMemo(() => getExamples(), []);
  const items = useMemo(() => listPatchReference(session.registry), [session.registry]);

  const [stack, setStack] = useState<LearnView[]>(() => [view ?? defaultView ?? readLearnView() ?? { kind: "lessons" }]);
  const stackRef = useRef(stack);
  const current = stack.at(-1)!;
  const [opened, setOpened] = useState(() => readOpenedGuides());
  const [guideQuery, setGuideQuery] = useState("");
  const [patchQuery, setPatchQuery] = useState("");
  const [patchCategory, setPatchCategory] = useState<PatchCategory | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onViewChangeRef = useLatest(onViewChange);
  const docked = useStore(lessonLayout, (s) => s.active);
  const scrollMemo = useRef(new Map<string, number>());
  const arrival = useRef({ restoreScroll: false, focusView: false });

  const show = useCallback((next: LearnView[], arrive: { restoreScroll: boolean; focusView: boolean }) => {
    const body = bodyRef.current;
    if (body) scrollMemo.current.set(viewKey(stackRef.current.at(-1)), body.scrollTop);
    arrival.current = arrive;
    stackRef.current = next;
    setStack(next);
  }, []);

  const goBack = useCallback(
    (fromContent: boolean) => {
      const s = stackRef.current;
      show(s.length > 1 ? s.slice(0, -1) : [{ kind: "lessons" }], { restoreScroll: true, focusView: fromContent });
    },
    [show],
  );

  /** Opens a view. `fromContent` is a click inside the drawer's own view, which moves focus to the new view. */
  const navigate = useCallback(
    (next: LearnView, fromContent = false) => {
      const s = stackRef.current;
      if (viewKey(s.at(-1)) === viewKey(next)) return;
      if (s.length > 1 && viewKey(s.at(-2)) === viewKey(next)) goBack(fromContent);
      else show([...s.slice(-29), next], { restoreScroll: false, focusView: fromContent });
    },
    [show, goBack],
  );
  const open = (next: LearnView) => navigate(next, true);

  const selectSection = (next: Section) => {
    scrollMemo.current.clear();
    show([next === "lessons" ? { kind: "lessons" } : next === "guides" ? { kind: "home" } : { kind: "patches", type: null }], { restoreScroll: false, focusView: false });
  };

  const controlledKey = viewKey(view);
  useEffect(() => {
    if (view) navigate(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledKey, navigate]);

  // A lesson layout left behind by a reload goes back to normal once Learn shows something other than a lesson.
  useEffect(() => {
    if (current.kind !== "lesson") lessonLayout.releaseStale();
  }, [current.kind]);

  const currentKey = viewKey(current);
  useEffect(() => {
    writeLearnView(current);
    onViewChangeRef.current?.(current);
    if (current.kind === "guide" && catalog.get(current.slug)) {
      setOpened((previous) => {
        if (previous.has(current.slug)) return previous;
        const next = new Set(previous).add(current.slug);
        writeOpenedGuides(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const { restoreScroll, focusView } = arrival.current;
    arrival.current = { restoreScroll: false, focusView: false };
    const remembered = restoreScroll ? scrollMemo.current.get(currentKey) : undefined;
    const anchor = current.kind === "guide" ? current.anchor : null;
    const target = remembered === undefined && anchor ? body.ownerDocument.getElementById(`${GUIDE_ID_PREFIX}${anchor}`) : null;
    if (target && body.contains(target)) body.scrollTop = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
    else body.scrollTop = remembered ?? 0;
    if (focusView && current.kind !== "lesson") (body.querySelector<HTMLElement>("[data-view-heading]") ?? body).focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const openGuide = (slug: string, anchor: string | null = null) => {
    if (slug.toLowerCase() === "readme") open({ kind: "home" });
    else open({ kind: "guide", slug, anchor });
  };

  const tryExample = async (example: ExampleProject) => {
    const result = await openExample(session, example);
    if (result.ok) toast.success(`Opened “${example.name}”`, { description: "It's a copy. Save it to keep your changes." });
    else if (result.error) toast.error(`Couldn't open “${example.name}”`, { description: result.error });
  };

  const guide = current.kind === "guide" ? catalog.get(current.slug) : undefined;
  const lesson = current.kind === "lesson" ? getLesson(current.id) : undefined;
  const section = sectionOf(current);
  const openLesson = (id: string) => open({ kind: "lesson", id });
  const openLessons = () => open({ kind: "lessons" });
  const openHome = () => open({ kind: "home" });

  // A guide or a patch page carries its own way back; the header arrow covers the views that don't and jumps in from another section.
  const previous = stack.at(-2);
  const hasCrumb = !!guide || (current.kind === "patches" && !!current.type);
  const showBack = previous !== undefined && (!hasCrumb || sectionOf(previous) !== section);

  let body;
  if (current.kind === "patches") {
    body = (
      <PatchReference
        items={items}
        type={current.type ?? null}
        onSelect={(type) => open({ kind: "patches", type })}
        query={patchQuery}
        onQueryChange={setPatchQuery}
        category={patchCategory}
        onCategoryChange={setPatchCategory}
        examples={examples}
        onTryExample={(e) => void tryExample(e)}
        {...(onInsertPatch ? { onInsertPatch } : {})}
      />
    );
  } else if (lesson) {
    body = <LessonPlayer key={lesson.id} lesson={lesson} onBack={openLessons} onOpenLesson={openLesson} onOpenGuide={(slug) => openGuide(slug)} />;
  } else if (current.kind === "lessons" || current.kind === "lesson") {
    body = <LessonsHome onOpenLesson={openLesson} onOpenGuides={openHome} />;
  } else if (guide) {
    body = <GuideReader guide={guide} catalog={catalog} examples={examples} onOpenGuide={openGuide} onHome={openHome} onTryExample={(e) => void tryExample(e)} {...(onConnectClaude ? { onConnectClaude } : {})} />;
  } else {
    body = <GuideHome catalog={catalog} opened={opened} examples={examples} query={guideQuery} onQueryChange={setGuideQuery} onOpenGuide={openGuide} onOpenPatches={() => open({ kind: "patches", type: null })} onTryExample={(e) => void tryExample(e)} />;
  }

  return (
    <div className={cx("sb-learnx", className)} data-view={current.kind}>
      <header className="sb-learnx__header">
        {showBack ? <IconButton size="sm" icon={<ArrowLeft size={14} />} label="Back" onClick={() => goBack(true)} /> : <BookOpen size={14} strokeWidth={2} className="sb-learnx__header-icon" aria-hidden />}
        <h2 className="sb-learnx__title">Learn</h2>
        <SegmentedControl<Section>
          size="sm"
          aria-label="Learn section"
          className="sb-learnx__sections"
          value={section}
          onChange={selectSection}
          options={[
            { value: "lessons", label: "Lessons" },
            { value: "guides", label: "Guides" },
            { value: "patches", label: "Patches" },
          ]}
        />
        {onClose && <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut={docked ? undefined : "Escape"} onClick={onClose} />}
      </header>
      <div className="sb-learnx__body sb-scroll" ref={bodyRef} tabIndex={-1}>
        {body}
      </div>
    </div>
  );
}
