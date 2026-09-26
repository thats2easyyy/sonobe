import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useDocument } from "../../../state/EditorProvider.tsx";
import { Button } from "../../../ui/Button.tsx";
import { getLesson, LESSONS } from "./catalog.ts";
import { useLessons } from "./lessonStore.ts";
import { isLessonDocumentOpen } from "./runner.ts";
import type { Lesson } from "./types.ts";
import { useStartLesson } from "./useStartLesson.ts";

export interface LessonsHomeProps {
  onOpenLesson: (id: string) => void;
}

/** The lesson list: the suggested lesson open with one button, every other lesson a single row. */
export function LessonsHome({ onOpenLesson }: LessonsHomeProps) {
  const active = useLessons((s) => s.active);
  const completed = useLessons((s) => s.completed);
  const inProgress = active ? getLesson(active.id) : undefined;
  const resume = inProgress && active && active.step < inProgress.steps.length ? inProgress : undefined;
  const practiceOpen = useDocument((s) => (resume ? isLessonDocumentOpen(resume, s.doc) : false));
  const suggested = resume ?? LESSONS.find((l) => completed[l.id] === undefined);
  const doneCount = LESSONS.filter((l) => completed[l.id] !== undefined).length;

  return (
    <section className="sb-lessons" aria-labelledby="sb-lessons-title">
      <div className="sb-lessons__head">
        <h3 className="sb-lessons__title" id="sb-lessons-title">
          Lessons
        </h3>
        <span className="sb-lessons__count sb-tabular">
          {doneCount} of {LESSONS.length} done
        </span>
      </div>
      <ol className="sb-lessonlist">
        {LESSONS.map((lesson) => {
          const done = completed[lesson.id] !== undefined;
          const marker = done ? <Check size={12} strokeWidth={2.75} /> : lesson.number;
          if (lesson.id !== suggested?.id) {
            return (
              <li key={lesson.id}>
                <button type="button" className="sb-lessoncard" data-done={done || undefined} onClick={() => onOpenLesson(lesson.id)}>
                  <span className="sb-lessoncard__number sb-tabular" aria-hidden>
                    {marker}
                  </span>
                  <span className="sb-lessoncard__title">{lesson.title}</span>
                  <span className="sb-lessoncard__meta sb-tabular">{done ? "Done" : `${lesson.minutes} min`}</span>
                  <ChevronRight size={14} strokeWidth={1.75} className="sb-lessoncard__chevron" aria-hidden />
                </button>
              </li>
            );
          }
          return (
            <li key={lesson.id}>
              <SuggestedLesson lesson={lesson} marker={marker} done={done} step={resume?.id === lesson.id && active ? active.step : undefined} practiceOpen={practiceOpen} onOpenLesson={onOpenLesson} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface SuggestedLessonProps {
  lesson: Lesson;
  marker: ReactNode;
  done: boolean;
  /** Set when this lesson is the one in progress. */
  step: number | undefined;
  practiceOpen: boolean;
  onOpenLesson: (id: string) => void;
}

function SuggestedLesson({ lesson, marker, done, step, practiceOpen, onOpenLesson }: SuggestedLessonProps) {
  const { busy, start } = useStartLesson(lesson, () => onOpenLesson(lesson.id));
  const resuming = step !== undefined;
  const restart = resuming && !practiceOpen;
  const label = restart ? "Restart" : resuming ? "Continue" : "Start";
  const act = () => (restart ? void start() : onOpenLesson(lesson.id));
  return (
    <div className="sb-lessoncard" data-expanded data-done={done || undefined} data-current={(resuming && practiceOpen) || undefined} onClick={act}>
      <span className="sb-lessoncard__number sb-tabular" aria-hidden>
        {marker}
      </span>
      <span className="sb-lessoncard__text">
        <span className="sb-lessoncard__title">{lesson.title}</span>
        <span className="sb-lessoncard__summary">{lesson.summary}</span>
        <span className="sb-lessoncard__meta sb-tabular">{resuming ? (practiceOpen ? `Step ${step + 1} of ${lesson.steps.length}` : "Your practice prototype isn't open") : `${lesson.minutes} min`}</span>
        <Button
          variant="primary"
          className="sb-lessoncard__action"
          aria-label={`${label} ${lesson.title}`}
          loading={busy}
          onClick={(event) => {
            event.stopPropagation();
            act();
          }}
        >
          {label}
        </Button>
      </span>
    </div>
  );
}
