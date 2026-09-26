import { CircleCheck, CircleX, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { IconButton } from "./IconButton.tsx";
import { Portal } from "./Portal.tsx";
import "./Toast.css";

export type ToastTone = "neutral" | "info" | "success" | "warn" | "danger" | "ai";

export interface ToastOptions {
  /** Reusing an id replaces that toast. */
  id?: string;
  title: string;
  description?: string;
  /** Lines listed under the description (every note of an import); the list scrolls when it's long. */
  details?: readonly string[];
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms, or "persistent". Defaults to a reading-time estimate; a toast with an action lasts at least 8 s, and a failure with an action stays until dismissed. */
  duration?: number | "persistent";
  icon?: ReactNode;
}

interface ToastRecord extends ToastOptions {
  id: string;
  tone: ToastTone;
  state: "open" | "closing";
  /** Grows with every show, so replacing a toast by id restarts its timer. */
  seq: number;
}

const MAX_VISIBLE = 4;
const EXIT_MS = 160;
const ACTION_MIN_MS = 8_000;

let toasts: ToastRecord[] = [];
let counter = 0;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Time to read a message: ~220 wpm plus a base, clamped to 3–10 s. */
export function readingDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(10_000, Math.max(3_000, 1_800 + words * 270));
}

function showToast(options: ToastOptions): string {
  const id = options.id ?? `toast-${++counter}`;
  const record: ToastRecord = { ...options, id, tone: options.tone ?? "neutral", state: "open", seq: ++seq };
  const exists = toasts.some((t) => t.id === id);
  toasts = exists ? toasts.map((t) => (t.id === id ? record : t)) : [...toasts, record].slice(-MAX_VISIBLE);
  emit();
  return id;
}

function lifetime(item: ToastRecord): number {
  if (item.duration === "persistent") return Infinity;
  if (item.duration !== undefined) return item.duration;
  if (item.action && item.tone === "danger") return Infinity;
  const reading = readingDuration(`${item.title} ${item.description ?? ""}`);
  return item.action ? Math.max(reading, ACTION_MIN_MS) : reading;
}

export function dismissToast(id: string): void {
  if (!toasts.some((t) => t.id === id && t.state === "open")) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, state: "closing" } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

/** Show a toast. `toast.success(...)`, `toast.error(...)`, `toast.dismiss(id)`. */
export const toast = Object.assign(showToast, {
  success: (title: string, options: Omit<ToastOptions, "title" | "tone"> = {}) => showToast({ ...options, title, tone: "success" }),
  error: (title: string, options: Omit<ToastOptions, "title" | "tone"> = {}) => showToast({ ...options, title, tone: "danger" }),
  warn: (title: string, options: Omit<ToastOptions, "title" | "tone"> = {}) => showToast({ ...options, title, tone: "warn" }),
  dismiss: dismissToast,
  clear: () => {
    toasts = [];
    emit();
  },
});

const ICONS: Record<ToastTone, ReactNode> = {
  neutral: null,
  info: <Info size={15} />,
  success: <CircleCheck size={15} />,
  warn: <TriangleAlert size={15} />,
  danger: <CircleX size={15} />,
  ai: <Sparkles size={15} />,
};

export interface ToasterProps {
  placement?: "bottom-right" | "bottom-center" | "top-right";
  /** Width in px of a sheet covering the right edge; the stack sits in the free area beside it. */
  inset?: number;
}

/** Renders the toast stack. Mount once near the app root. Hovering or focusing a toast pauses timers. */
export function Toaster({ placement = "bottom-right", inset = 0 }: ToasterProps) {
  const items = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const section = useRef<HTMLElement>(null);

  // A dismissed toast takes its focus with it without a blur.
  useEffect(() => {
    if (focused && !section.current?.contains(document.activeElement)) setFocused(false);
  }, [items, focused]);

  return (
    <Portal>
      <section
        ref={section}
        className="sb-toaster"
        data-placement={placement}
        data-layer-ignore
        aria-label="Notifications"
        style={inset > 0 ? ({ "--sb-toast-inset": `${inset}px` } as CSSProperties) : undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        {items.map((item) => (
          <ToastItem key={item.id} toast={item} paused={hovered || focused} />
        ))}
      </section>
    </Portal>
  );
}

function ToastItem({ toast: item, paused }: { toast: ToastRecord; paused: boolean }) {
  const remaining = useRef(lifetime(item));
  const shownSeq = useRef(item.seq);

  useEffect(() => {
    if (shownSeq.current !== item.seq) {
      shownSeq.current = item.seq;
      remaining.current = lifetime(item);
    }
    if (item.state !== "open" || paused || !Number.isFinite(remaining.current)) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.seq, item.state, paused]);

  const icon = item.icon ?? ICONS[item.tone];
  return (
    <div role={item.tone === "danger" ? "alert" : "status"} className="sb-toast sb-surface" data-tone={item.tone} data-state={item.state}>
      {icon && (
        <span className="sb-toast__icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="sb-toast__body">
        <div className="sb-toast__title">{item.title}</div>
        {item.description && <div className="sb-toast__description">{item.description}</div>}
        {item.details?.length ? (
          <ul className="sb-toast__details sb-scroll">
            {item.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {item.action && (
        <Button
          size="sm"
          variant="ghost"
          className="sb-toast__action"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </Button>
      )}
      <IconButton size="sm" icon={<X size={14} />} label="Dismiss notification" tooltip={false} className="sb-toast__close" onClick={() => dismissToast(item.id)} />
    </div>
  );
}
