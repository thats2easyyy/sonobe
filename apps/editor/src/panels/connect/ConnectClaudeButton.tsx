import { Sparkles } from "lucide-react";
import { useState } from "react";
import { getDesktopHostApi } from "../../host/detect.ts";
import { usePresence } from "../../state/EditorProvider.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { connectClaudeStore } from "./connectStore.ts";
import { useMcpStatus, type McpStatusSource } from "./useMcpStatus.ts";
import "./connect.css";

export type ClaudeButtonState = "working" | "ready" | "checking" | "off" | "browser";

export interface ConnectClaudeButtonProps {
  /** Default: open the dialog through connectClaudeStore. */
  onClick?: () => void;
  /** Default: window.sonobeHost. Null means browser mode. */
  host?: McpStatusSource | null;
  className?: string;
}

/** Toolbar Claude button: shows whether Sonobe is ready for Claude (or Claude is working) and opens Connect Claude. */
export function ConnectClaudeButton({ onClick, host, className }: ConnectClaudeButtonProps) {
  const [api] = useState<McpStatusSource | null>(() => (host === undefined ? (getDesktopHostApi() ?? null) : host));
  const mcp = useMcpStatus(api, { intervalMs: 10_000 });
  const workingCount = usePresence((s) => s.working.length);
  const intent = usePresence((s) => s.working[0]?.intent ?? null);
  const state: ClaudeButtonState = workingCount > 0 ? "working" : api === null ? "browser" : mcp.status?.running ? "ready" : mcp.loading ? "checking" : "off";
  const label = state === "working" ? "Claude is working" : state === "ready" ? "Claude" : "Connect Claude";
  const tooltip: Record<ClaudeButtonState, string> = {
    working: intent ? `Claude is ${intent.charAt(0).toLowerCase()}${intent.slice(1)}` : "Claude is working",
    ready: "Sonobe is ready for Claude. Open connection setup.",
    checking: "Checking Sonobe's MCP server…",
    off: "Sonobe's MCP server is off. Open connection setup.",
    browser: "Connect Claude Desktop or Claude Code",
  };
  return (
    <Tooltip content={tooltip[state]}>
      <button type="button" className={cx("sb-claudebtn", className)} data-state={state} onClick={onClick ?? (() => connectClaudeStore.getState().show())}>
        <span className="sb-claudebtn__icon" aria-hidden>
          <Sparkles size={13} strokeWidth={2} />
          <span className="sb-claudebtn__dot" />
        </span>
        <span className="sb-claudebtn__label">{label}</span>
      </button>
    </Tooltip>
  );
}
