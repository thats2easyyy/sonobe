import { Sparkles } from "lucide-react";
import { useState } from "react";
import { getDesktopHostApi } from "../../host/detect.ts";
import { usePresence } from "../../state/EditorProvider.tsx";
import type { WorkingItem } from "../../state/presence.ts";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { connectedSessions, folderName, sessionSummary } from "./connectInfo.ts";
import { connectClaudeStore } from "./connectStore.ts";
import { useMcpStatus, type McpStatusSource } from "./useMcpStatus.ts";
import "./connect.css";

/**
 * working: an agent has a working badge. connected: a Claude session talked to Sonobe recently (green).
 * ready: the server runs but nothing is connected (neutral). checking, off (warn), browser.
 */
export type ClaudeButtonState = "working" | "connected" | "ready" | "checking" | "off" | "browser";

export interface ConnectClaudeButtonProps {
  /** Default: open the dialog through connectClaudeStore. */
  onClick?: () => void;
  /** Default: window.sonobeHost. Null means browser mode. */
  host?: McpStatusSource | null;
  className?: string;
}

/** "Claude Code in placemark is adding a press animation". */
function workingTooltip(item: WorkingItem): string {
  const who = item.client ? `${item.client.label}${item.client.folder ? ` in ${folderName(item.client.folder)}` : ""}` : item.author.name;
  return `${who} is ${item.intent.charAt(0).toLowerCase()}${item.intent.slice(1)}`;
}

/**
 * Toolbar Claude button: green only while a Claude session is connected, and names who is working.
 * A running server with no session reads "Connect Claude". Opens Connect Claude.
 */
export function ConnectClaudeButton({ onClick, host, className }: ConnectClaudeButtonProps) {
  const [api] = useState<McpStatusSource | null>(() => (host === undefined ? (getDesktopHostApi() ?? null) : host));
  const mcp = useMcpStatus(api, { intervalMs: 10_000 });
  const working = usePresence((s) => s.working[0] ?? null);
  const sessions = connectedSessions(mcp.status);
  const state: ClaudeButtonState = working ? "working" : api === null ? "browser" : mcp.status?.running ? (sessions.length ? "connected" : "ready") : mcp.loading ? "checking" : "off";
  const label = state === "working" ? "Claude is working" : state === "connected" ? (sessions.length > 1 ? `Claude ×${sessions.length}` : "Claude") : "Connect Claude";
  const now = Date.now();
  const tooltip: Record<ClaudeButtonState, string> = {
    working: working ? workingTooltip(working) : "Claude is working",
    connected: sessions.map((s) => sessionSummary(s, now)).join("\n"),
    ready: "Sonobe is ready. No Claude session is connected yet.",
    checking: "Checking Sonobe's MCP server…",
    off: "Sonobe's MCP server is off. Open connection setup.",
    browser: "Connect Claude Desktop or Claude Code",
  };
  return (
    <Tooltip content={<span className="sb-claudebtn__tooltip">{tooltip[state]}</span>}>
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
