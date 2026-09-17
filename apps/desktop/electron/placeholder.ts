/** Friendly fallback page shown when the editor build (or dev server) isn't available. */

export type PlaceholderReason = { kind: "missing-editor"; editorIndex: string } | { kind: "dev-server-unreachable"; url: string; error: string };

/** Window background; matches the editor's dark theme so there's no flash on load. */
export const DARK_BACKGROUND = "#161618";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function step(n: number, title: string, command: string, hint?: string): string {
  return `<li class="step">
  <span class="num" aria-hidden="true">${n}</span>
  <div class="body">
    <p class="step-title">${escapeHtml(title)}</p>
    <div class="cmd"><code>${escapeHtml(command)}</code><button type="button" class="copy" data-copy="${escapeHtml(command)}" aria-label="Copy command: ${escapeHtml(command)}">Copy</button></div>
    ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""}
  </div>
</li>`;
}

export function placeholderHtml(reason: PlaceholderReason): string {
  const missing = reason.kind === "missing-editor";
  const heading = missing ? "Build the editor to get started" : "Can't reach the editor dev server";
  const lede = missing
    ? "Sonobe's desktop shell is running, but the editor UI hasn't been built yet."
    : `Nothing answered at ${reason.url} (${reason.error}).`;
  const steps = missing
    ? [
        step(1, "Build the editor", "npm run build -w @sonobe/editor", "Run this from the repository root."),
        step(2, "Relaunch Sonobe", "npm run desktop"),
      ].join("")
    : [
        step(1, "Start the dev server", "npm run dev", "Keep it running in its own terminal."),
        step(2, "Relaunch with the dev URL", `SONOBE_DEV_URL=${reason.url} npm run desktop`),
      ].join("");
  const detail = missing ? `<p class="detail">Looked for <code>${escapeHtml(reason.editorIndex)}</code></p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Sonobe</title>
<style>
  :root {
    --bg: ${DARK_BACKGROUND};
    --surface: #1f1f23;
    --surface-2: #26262b;
    --border: #2f2f36;
    --text: #ededf0;
    --muted: #a0a0ab;
    --accent: #8b9cff;
    --focus: #b7c1ff;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: grid;
    place-items: center;
    padding: 56px 24px 32px;
  }
  .drag { position: fixed; inset: 0 0 auto 0; height: 40px; -webkit-app-region: drag; }
  main { width: min(560px, 100%); }
  .mark { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; color: var(--muted); font-weight: 600; letter-spacing: 0.01em; }
  h1 { font-size: 22px; line-height: 1.25; font-weight: 650; margin: 0 0 8px; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 0 0 24px; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .step { display: grid; grid-template-columns: 28px 1fr; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .num { width: 24px; height: 24px; border-radius: 999px; background: var(--surface-2); color: var(--text); font-size: 12px; font-weight: 600; display: grid; place-items: center; margin-top: 1px; font-variant-numeric: tabular-nums; }
  .step-title { margin: 0 0 8px; font-weight: 600; }
  .cmd { display: flex; align-items: center; gap: 8px; background: #121214; border: 1px solid var(--border); border-radius: 8px; padding: 6px 6px 6px 12px; }
  code { font: 12.5px/1.4 ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace; color: var(--text); overflow-wrap: anywhere; }
  .cmd code { flex: 1; }
  .copy { font: inherit; font-size: 12px; font-weight: 600; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; min-width: 64px; }
  .copy:hover { background: #303037; }
  .copy:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .hint { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; }
  .detail { margin: 20px 0 0; color: var(--muted); font-size: 12px; }
  .detail code { font-size: 11.5px; color: var(--muted); }
  .status { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); font-size: 12px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 999px; background: #5c5c66; margin-right: 6px; vertical-align: 1px; }
  .dot.on { background: #4ade80; }
</style>
</head>
<body>
<div class="drag" aria-hidden="true"></div>
<main>
  <div class="mark">
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12 12 3l9 9-9 9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 3v18M3 12h9" stroke="currentColor" stroke-width="1.6"/></svg>
    Sonobe
  </div>
  <h1>${escapeHtml(heading)}</h1>
  <p class="lede">${escapeHtml(lede)}</p>
  <ol>${steps}</ol>
  ${detail}
  <div class="status" role="status" aria-live="polite">
    <span id="host"><span class="dot"></span>Desktop host: checking…</span>
    <span id="mcp"><span class="dot"></span>Claude connection: checking…</span>
  </div>
</main>
<script>
  for (const button of document.querySelectorAll("button.copy")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select & copy";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1600);
    });
  }
  const set = (id, on, text) => {
    const el = document.getElementById(id);
    el.replaceChildren();
    const dot = document.createElement("span");
    dot.className = on ? "dot on" : "dot";
    el.append(dot, text);
  };
  const host = window.sonobeHost;
  if (host) {
    set("host", true, "Desktop host ready (" + host.platform + ", v" + host.version + ")");
    host.getMcpStatus().then(
      (s) => set("mcp", s.running, s.running ? "MCP endpoint on " + s.url : "MCP endpoint is off"),
      () => set("mcp", false, "MCP status unavailable"),
    );
  } else {
    set("host", false, "Desktop host unavailable");
    set("mcp", false, "MCP status unavailable");
  }
</script>
</body>
</html>
`;
}

export function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}
