/** Poll the desktop host for MCP server status. */

import { useCallback, useEffect, useState } from "react";
import { parseMcpStatus, type McpStatusInfo } from "./connectInfo.ts";

/** Anything with `getMcpStatus()` (window.sonobeHost, or a stand-in for previews and tests). */
export interface McpStatusSource {
  getMcpStatus(): Promise<unknown>;
}

export interface McpStatusState {
  status: McpStatusInfo | null;
  /** True until the first answer arrives. */
  loading: boolean;
  error: string | null;
  /** False in the browser (no desktop host). */
  available: boolean;
  refresh: () => void;
}

export interface McpStatusOptions {
  /** Default true. */
  enabled?: boolean;
  /** Re-check interval; 0 checks once. Default 4000 ms. */
  intervalMs?: number;
}

export function useMcpStatus(source: McpStatusSource | null, options: McpStatusOptions = {}): McpStatusState {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? 4000;
  const [state, setState] = useState<{ status: McpStatusInfo | null; loading: boolean; error: string | null }>({ status: null, loading: source !== null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!source || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = parseMcpStatus(await source.getMcpStatus());
        if (cancelled) return;
        setState({ status, loading: false, error: status ? null : "Sonobe reported an MCP status this version doesn't understand." });
      } catch (err) {
        if (cancelled) return;
        setState((previous) => ({ ...previous, loading: false, error: err instanceof Error ? err.message : String(err) }));
      }
      if (!cancelled && intervalMs > 0) timer = setTimeout(() => void poll(), intervalMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [source, enabled, intervalMs, nonce]);

  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: previous.status === null, error: null }));
    setNonce((n) => n + 1);
  }, []);

  return { ...state, loading: source !== null && state.loading, available: source !== null, refresh };
}
