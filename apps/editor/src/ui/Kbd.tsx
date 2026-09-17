import type { ReactNode } from "react";
import { usePlatform } from "./commands/CommandProvider.tsx";
import { formatShortcut, type Platform } from "./commands/shortcutManager.ts";
import { cx } from "./lib/cx.ts";
import "./Kbd.css";

const SPOKEN: Record<string, string> = {
  "⌘": "Command",
  "⇧": "Shift",
  "⌥": "Option",
  "⌃": "Control",
  "⏎": "Return",
  "⌫": "Delete",
  "⌦": "Forward Delete",
  "⇥": "Tab",
  "↑": "Up Arrow",
  "↓": "Down Arrow",
  "←": "Left Arrow",
  "→": "Right Arrow",
};

function partsFor(spec: string, platform: Platform): string[] {
  try {
    return formatShortcut(spec, platform);
  } catch {
    return [spec];
  }
}

export interface KbdProps {
  /** Registry format ("Mod+Shift+K"); adapts to the platform. The first alternative is shown. */
  shortcut?: string | readonly string[];
  /** Literal key text when not using `shortcut`. */
  children?: ReactNode;
  /** "keycap" draws each key; "plain" is inline text for menus and tooltips. */
  variant?: "keycap" | "plain";
  className?: string;
}

export function Kbd({ shortcut, children, variant = "keycap", className }: KbdProps) {
  const platform = usePlatform();
  const spec = typeof shortcut === "string" ? shortcut : shortcut?.[0];
  const parts = spec ? partsFor(spec, platform) : [];
  const spoken = spec ? parts.map((p) => SPOKEN[p] ?? p).join(" ") : undefined;

  if (variant === "plain") {
    return (
      <kbd className={cx("sb-kbd", "sb-kbd--plain", className)} aria-label={spoken}>
        {spec ? parts.join(platform === "mac" ? "" : "+") : children}
      </kbd>
    );
  }
  return (
    <span className={cx("sb-kbd", className)} aria-label={spoken} role={spec ? "img" : undefined}>
      {spec ? (
        parts.map((part, i) => (
          <kbd key={i} className="sb-kbd__key" aria-hidden>
            {part}
          </kbd>
        ))
      ) : (
        <kbd className="sb-kbd__key">{children}</kbd>
      )}
    </span>
  );
}
