import { CircleCheck, CircleX, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms, or "persistent". Defaults to a reading-time estimate. */
  duration?: number | "persistent";
  icon?: ReactNode;
}

interface ToastRecord extends ToastOptions {
  id: string;
  tone: ToastTone;
  state: "open" | "closing";
}

const MAX_VISIBLE = 4;
const EXIT_MS = 160;

let toasts: ToastRecord[] = [];
let counter = 0;
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
  const record: ToastRecord = { ...options, id, tone: options.tone ?? "neutral", state: "open" };
  const exists = toasts.some((t) => t.id === id);
  toasts = exists ? toasts.map((t) => (t.id === id ? record : t)) : [...toasts, record].slice(-MAX_VISIBLE);
  emit();
  return id;
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
}

/** Renders the toast stack. Mount once near the app root. Hovering pauses timers. */
export function Toaster({ placement = "bottom-right" }: ToasterProps) {
  const items = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  const [paused, setPaused] = useState(false);
  return (
    <Portal>
      <section
        className="sb-toaster"
        data-placement={placement}
        aria-label="Notifications"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        {items.map((item) => (
          <ToastItem key={item.id} toast={item} paused={paused} />
        ))}
      </section>
    </Portal>
  );
}

function ToastItem({ toast: item, paused }: { toast: ToastRecord; paused: boolean }) {
  const remaining = useRef(item.duration === "persistent" ? Infinity : (item.duration ?? readingDuration(`${item.title} ${item.description ?? ""}`)));

  useEffect(() => {
    if (item.state !== "open" || paused || !Number.isFinite(remaining.current)) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [item.id, item.state, paused]);

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
      <IconButton size="xs" icon={<X size={12} />} label="Dismiss notification" tooltip={false} className="sb-toast__close" onClick={() => dismissToast(item.id)} />
    </div>
  );
}
