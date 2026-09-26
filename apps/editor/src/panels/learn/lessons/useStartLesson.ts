import { useState } from "react";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import { toast } from "../../../ui/Toast.tsx";
import { lessonStore } from "./lessonStore.ts";
import { loadLessonStarter } from "./runner.ts";
import type { Lesson } from "./types.ts";

/** Opens the lesson's practice prototype (Sonobe asks about unsaved changes first) and begins it at step 1. */
export function useStartLesson(lesson: Lesson, onStarted?: () => void) {
  const session = useEditorSession();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      if (await loadLessonStarter(session, lesson)) {
        lessonStore.getState().start(lesson.id);
        onStarted?.();
      }
    } catch (err) {
      toast.error("Couldn't start the lesson", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, start };
}
