import { ArrowRight, Check, ChevronRight, GraduationCap } from "lucide-react";
import { Button } from "../../../ui/Button.tsx";
import { getLesson, LESSONS } from "./catalog.ts";
import { useLessons } from "./lessonStore.ts";

export interface LessonsHomeProps {
  onOpenLesson: (id: string) => void;
  onOpenGuides: () => void;
}

/** The lesson list: continue where you left off, then every lesson with its progress. */
export function LessonsHome({ onOpenLesson, onOpenGuides }: LessonsHomeProps) {
  const active = useLessons((s) => s.active);
  const completed = useLessons((s) => s.completed);
  const inProgress = active ? getLesson(active.id) : undefined;
  const resume = inProgress && active && active.step < inProgress.steps.length ? inProgress : undefined;
  const suggested = resume ?? LESSONS.find((l) => completed[l.id] === undefined);

  return (
    <div className="sb-learnx__stack">
      {suggested && (
        <section className="sb-learnx__hero">
          <div className="sb-learnx__eyebrow">{resume ? "Pick up where you left off" : Object.keys(completed).length ? "Up next" : "Start here"}</div>
          <div className="sb-learnx__hero-title">{suggested.title}</div>
          <p className="sb-learnx__hero-text">{suggested.summary}</p>
          <div className="sb-learnx__hero-meta">
            <span>about {suggested.minutes} min</span>
            {resume && active && (
              <span>
                step {active.step + 1} of {resume.steps.length}
              </span>
            )}
          </div>
          <div className="sb-learnx__hero-actions">
            <Button size="sm" variant="primary" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenLesson(suggested.id)}>
              {resume ? "Continue" : "Open the lesson"}
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="sb-lessons-title">
        <h3 className="sb-learnx__section-title" id="sb-lessons-title">
          Lessons
        </h3>
        <ol className="sb-lessonlist">
          {LESSONS.map((lesson) => {
            const done = completed[lesson.id] !== undefined;
            const current = resume?.id === lesson.id;
            return (
              <li key={lesson.id}>
                <button type="button" className="sb-lessoncard" data-done={done || undefined} data-current={current || undefined} onClick={() => onOpenLesson(lesson.id)}>
                  <span className="sb-lessoncard__number sb-tabular" aria-hidden>
                    {done ? <Check size={12} strokeWidth={2.75} /> : lesson.number}
                  </span>
                  <span className="sb-lessoncard__text">
                    <span className="sb-lessoncard__title">{lesson.title}</span>
                    <span className="sb-lessoncard__summary">{lesson.summary}</span>
                    <span className="sb-lessoncard__meta">
                      {lesson.minutes} min{done ? " · Done" : current ? " · In progress" : ""}
                    </span>
                  </span>
                  <ChevronRight size={14} strokeWidth={2} className="sb-lessoncard__chevron" aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="sb-learnx__tip">
        <GraduationCap size={14} strokeWidth={2} aria-hidden />
        <div>
          Lessons check your work as you go, so you learn by doing. Prefer to read first?{" "}
          <button type="button" className="sb-learnx__inline-link" onClick={onOpenGuides}>
            Browse the guides
          </button>
        </div>
      </section>
    </div>
  );
}
