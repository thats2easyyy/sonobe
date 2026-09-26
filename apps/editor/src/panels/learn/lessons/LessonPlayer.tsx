import { ArrowRight, BookOpen, Check, Crosshair, FileQuestionMark, Lightbulb, LogOut, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useDocument } from "../../../state/EditorProvider.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { LESSONS, nextLesson } from "./catalog.ts";
import { InlineText } from "./InlineText.tsx";
import { lessonLayout } from "./lessonLayout.ts";
import { lessonStore, useLessons } from "./lessonStore.ts";
import { findLessonTarget, LessonSpotlight } from "./LessonSpotlight.tsx";
import { isLessonDocumentOpen } from "./runner.ts";
import type { Lesson } from "./types.ts";
import { useLessonRunner } from "./useLessonRunner.ts";
import { useStartLesson } from "./useStartLesson.ts";

/** A finished step lingers a moment so the check mark registers before the next step opens. */
export const ADVANCE_DELAY_MS = 900;

const EXIT_HINT = "Progress on this lesson isn't kept";

export interface LessonPlayerProps {
  lesson: Lesson;
  /** Back to the lesson list. */
  onBack: () => void;
  onOpenLesson: (id: string) => void;
  /** Shows "Read the guide" when the lesson has one. */
  onOpenGuide?: (slug: string) => void;
}

/**
 * One lesson: an intro with Start, then the steps with a live check and spotlight, then a celebration.
 * Progress resumes only while the lesson's practice prototype is open; otherwise it offers a restart.
 * While the lesson is on screen the shell uses the lesson layout (see lessonLayout.ts).
 */
export function LessonPlayer({ lesson, onBack, onOpenLesson, onOpenGuide }: LessonPlayerProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const active = useLessons((s) => (s.active?.id === lesson.id ? s.active : null));
  const completed = useLessons((s) => s.completed[lesson.id] !== undefined);
  const documentOpen = useDocument((s) => isLessonDocumentOpen(lesson, s.doc));
  const [spotlightKey, setSpotlightKey] = useState(0);
  const stepCount = lesson.steps.length;
  const stepIndex = active ? Math.min(active.step, stepCount) : 0;
  const inLesson = active !== null && documentOpen;
  const elsewhere = active !== null && !documentOpen;
  const running = inLesson && stepIndex < stepCount;
  const finished = inLesson && stepIndex >= stepCount;
  const runner = useLessonRunner(lesson, stepIndex, running);
  const next = nextLesson(lesson.id);
  const focusTitle = () => titleRef.current?.focus({ preventScroll: true });
  const { busy, start } = useStartLesson(lesson, focusTitle);

  // The view underneath the focused button changes, so keyboard focus goes to the lesson heading.
  useEffect(focusTitle, []);

  useEffect(() => {
    if (!running || !runner.done || runner.step !== stepIndex) return;
    const timer = setTimeout(() => lessonStore.getState().advance(stepCount), ADVANCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [running, runner.done, runner.step, stepIndex, stepCount]);

  // Lesson layout while this lesson is on screen; the earlier layout comes back when it leaves.
  useEffect(() => {
    if (!inLesson) {
      lessonLayout.releaseStale();
      return;
    }
    lessonLayout.enter();
    return () => lessonLayout.leave();
  }, [inLesson]);

  // Show the Inspector while a step points at it. A finished step keeps it until the next step starts.
  useEffect(() => {
    if (!running) lessonLayout.showPanelsFor(null);
    else if (!runner.done) lessonLayout.showPanelsFor(runner.target);
  }, [running, runner.done, runner.target]);

  // A window resized mid-step may need Layers folded or back.
  useEffect(() => {
    if (!running || runner.done) return;
    const refit = () => lessonLayout.showPanelsFor(runner.target);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [running, runner.done, runner.target]);

  const exit = () => {
    lessonStore.getState().exit();
    onBack();
  };

  const showMe = () => {
    const element = runner.target ? findLessonTarget(runner.target) : null;
    element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    setSpotlightKey((k) => k + 1);
  };

  const current = running ? lesson.steps[stepIndex] : undefined;

  return (
    <div className="sb-lesson" data-lesson={lesson.id} aria-labelledby={titleId}>
      <header className="sb-lesson__intro">
        <div className="sb-lesson__eyebrow sb-tabular">
          Lesson {lesson.number} of {LESSONS.length} · about {lesson.minutes} min{running ? ` · Step ${stepIndex + 1} of ${stepCount}` : ""}
        </div>
        <h3 className="sb-lesson__title" id={titleId} ref={titleRef} tabIndex={-1}>
          {lesson.title}
        </h3>
        <p className="sb-lesson__summary">{lesson.summary}</p>
      </header>

      {!active && (
        <section className="sb-lesson__start">
          <h4 className="sb-lesson__heading">You'll be able to</h4>
          <ul className="sb-lesson__outcomes">
            {lesson.outcomes.map((outcome) => (
              <li key={outcome}>
                {outcome}
              </li>
            ))}
          </ul>
          <p className="sb-lesson__note">{lesson.starter ? "Starting opens a small practice prototype. If you have unsaved changes, Sonobe asks first." : "This lesson works with the prototype you have open."}</p>
          <Button variant="primary" trailingIcon={<ArrowRight size={13} />} loading={busy} onClick={() => void start()}>
            {completed ? "Do it again" : "Start lesson"}
          </Button>
        </section>
      )}

      {elsewhere && (
        <section className="sb-lesson__elsewhere" role="status" aria-live="polite">
          <div className="sb-lesson__elsewhere-title">
            <FileQuestionMark size={14} strokeWidth={2} aria-hidden />
            Your practice prototype isn't open
          </div>
          <p className="sb-lesson__text">
            This lesson checks its own practice prototype, and a different one is open now. Restart the lesson to get a fresh copy. If the open prototype has unsaved changes, Sonobe asks first.
          </p>
          <div className="sb-lesson__actions">
            <Button variant="primary" icon={<RotateCcw size={13} />} loading={busy} onClick={() => void start()}>
              Restart lesson
            </Button>
            <Tooltip content={EXIT_HINT}>
              <Button variant="ghost" icon={<LogOut size={13} />} onClick={exit}>
                Exit lesson
              </Button>
            </Tooltip>
          </div>
        </section>
      )}

      {finished && (
        <section className="sb-lesson__celebrate" role="status" aria-live="polite">
          <div className="sb-lesson__celebrate-row">
            <Check size={14} strokeWidth={2.25} aria-hidden />
            <div>
              <h4 className="sb-lesson__celebrate-title">{lesson.celebrate.title}</h4>
              <p className="sb-lesson__celebrate-text">{lesson.celebrate.body}</p>
            </div>
          </div>
          <div className="sb-lesson__celebrate-actions">
            {next ? (
              <Button variant="primary" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenLesson(next.id)}>
                Next: {next.title}
              </Button>
            ) : (
              <Button variant="primary" onClick={exit}>
                Back to lessons
              </Button>
            )}
            {lesson.guide && onOpenGuide && (
              <Button className="sb-lesson__guide" variant="ghost" icon={<BookOpen size={13} />} onClick={() => onOpenGuide(lesson.guide!)}>
                Read the guide
              </Button>
            )}
          </div>
        </section>
      )}

      {(running || finished) && (
        <ol className="sb-lesson__steps">
          {lesson.steps.map((step, index) => {
            const state = index < stepIndex ? "done" : index === stepIndex ? (runner.done ? "passed" : "current") : "upcoming";
            return (
              <li key={step.id} className="sb-lesson__step" data-state={state} aria-current={index === stepIndex ? "step" : undefined}>
                <span className="sb-lesson__marker sb-tabular" aria-hidden>
                  {state === "done" || state === "passed" ? <Check size={11} strokeWidth={2.75} /> : index + 1}
                </span>
                <div className="sb-lesson__step-body">
                  <div className="sb-lesson__step-title">
                    <span className="sb-visually-hidden">{state === "done" ? "Done: " : state === "current" ? "Current step: " : ""}</span>
                    {step.title}
                  </div>
                  {index === stepIndex && current && (
                    <>
                      <p className="sb-lesson__text">
                        <InlineText text={current.body} />
                      </p>
                      {current.tip && (
                        <p className="sb-lesson__tip">
                          <Lightbulb size={12} strokeWidth={2} aria-hidden />
                          <span>
                            <InlineText text={current.tip} />
                          </span>
                        </p>
                      )}
                      <div className="sb-lesson__status" role="status" aria-live="polite">
                        {runner.done ? (
                          <span className="sb-lesson__success">
                            <Check size={12} strokeWidth={2.5} aria-hidden /> Nice work
                          </span>
                        ) : runner.hint ? (
                          <span className="sb-lesson__hint">{runner.hint}</span>
                        ) : null}
                      </div>
                      {!runner.done && (runner.target || current.manual) && (
                        <div className="sb-lesson__actions">
                          {runner.target && (
                            <Button variant="secondary" icon={<Crosshair size={13} />} onClick={showMe}>
                              Show me
                            </Button>
                          )}
                          {current.manual && (
                            <Button variant="secondary" onClick={() => lessonStore.getState().advance(stepCount)}>
                              {current.manual}
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {inLesson && (
        <footer className="sb-lesson__footer">
          {lesson.starter && !finished && (
            <Button variant="ghost" icon={<RotateCcw size={13} />} loading={busy} onClick={() => void start()}>
              Start over
            </Button>
          )}
          <span className="sb-lesson__spacer" />
          <Tooltip content={EXIT_HINT} disabled={finished}>
            <Button variant="ghost" icon={<LogOut size={13} />} onClick={exit}>
              {finished ? "Close lesson" : "Exit lesson"}
            </Button>
          </Tooltip>
        </footer>
      )}

      {running && <LessonSpotlight key={spotlightKey} target={runner.done ? null : runner.target} />}
    </div>
  );
}
