/**
 * A caption over the viewer when the running knob preset changes, whoever changed it (you, an undo,
 * Claude): "⇄ Shipped app" for a moment, so a flip reads while your eyes stay on the prototype.
 */

import { ArrowLeftRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { EditorSession } from "../../state/session.ts";

export const PRESET_CAPTION_MS = 1500;

export function PresetCaption({ session }: { session: EditorSession }) {
  const [caption, setCaption] = useState<{ name: string; key: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = session.document.getState().subscribeRevision((next, previous) => {
      // Opening another prototype isn't a switch.
      if (next.lastChange?.kind === "replace") return;
      const before = previous.doc.knobs?.active;
      const after = next.doc.knobs?.active;
      if (!before || !after || before === after) return;
      const name = next.doc.knobs?.presets.find((p) => p.id === after)?.name ?? after;
      clearTimeout(timer);
      setCaption((c) => ({ name, key: (c?.key ?? 0) + 1 }));
      timer = setTimeout(() => setCaption(null), PRESET_CAPTION_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [session]);
  if (!caption) return null;
  return (
    <div key={caption.key} className="sb-vw__preset-caption" role="status" aria-live="polite">
      <ArrowLeftRight size={12} strokeWidth={2} aria-hidden />
      <span>{caption.name}</span>
    </div>
  );
}
