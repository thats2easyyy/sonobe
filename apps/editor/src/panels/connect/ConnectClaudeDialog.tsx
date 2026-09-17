import { BookOpen, CircleAlert, Copy, Layers, LoaderCircle, Monitor, RefreshCw, ShieldCheck, Sparkles, SquareTerminal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { getDesktopHostApi } from "../../host/detect.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { claudeDesktopBundle, detectRepoPath, IS_DEV_BUILD } from "./buildInfo.ts";
import { claudeCodeCommand, claudeDesktopConfig, claudeDesktopConfigPath, EXAMPLE_PROMPTS, mcpLaunchSpec, shellForPlatform, tildePath, type LaunchMode, type ShellFlavor } from "./connectInfo.ts";
import { connectClaudeStore, useConnectClaude, type ConnectTab } from "./connectStore.ts";
import { CopyBlock } from "./CopyBlock.tsx";
import { useMcpStatus, type McpStatusSource, type McpStatusState } from "./useMcpStatus.ts";
import "./connect.css";

export const CLAUDE_GUIDE = "11-working-with-claude";

/** The part of window.sonobeHost this dialog uses. */
export interface ConnectHostLike extends McpStatusSource {
  readonly platform?: string;
}

export interface ConnectDefaults {
  /** "installed" (the `sonobe` command) or "checkout" (node + repo). Default: checkout in dev builds. */
  mode?: LaunchMode;
  nodePath?: string;
  repoPath?: string;
  /** "darwin" | "win32" | "linux". Default: the host's platform, else guessed from the browser. */
  platform?: string;
  headlessProject?: string;
}

export interface ConnectClaudeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default: window.sonobeHost. Null means browser mode (no live connection). */
  host?: ConnectHostLike | null;
  /** Opens a guide in the Learn drawer ("11-working-with-claude"). Hides the guide button when absent. */
  onOpenGuide?: (slug: string) => void;
  defaults?: ConnectDefaults;
  initialTab?: ConnectTab;
}

function guessPlatform(): string {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(agent)) return "darwin";
  if (/Win/i.test(agent)) return "win32";
  return "linux";
}

function useStoredString(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => readString(key) ?? "");
  return [
    value,
    (next) => {
      setValue(next);
      writeString(key, next);
    },
  ];
}

/**
 * Connect Claude: explains bring-your-own-plan over MCP, shows the MCP server status, and gives the
 * Claude Code command and Claude Desktop setup for this machine, example prompts, and privacy notes.
 */
export function ConnectClaudeDialog({ open, onOpenChange, ...rest }: ConnectClaudeDialogProps) {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-labelledby={titleId} width={660} className="sb-connect-dialog" initialFocusRef={bodyRef} style={{ maxHeight: "min(800px, calc(100vh - 48px))" }}>
      <ConnectClaudeContent titleId={titleId} bodyRef={bodyRef} onClose={() => onOpenChange(false)} {...rest} />
    </Dialog>
  );
}

/** The dialog bound to connectClaudeStore (render once near the app root). */
export function ConnectClaudeHost(props: Omit<ConnectClaudeDialogProps, "open" | "onOpenChange" | "initialTab">) {
  const open = useConnectClaude((s) => s.open);
  const tab = useConnectClaude((s) => s.tab);
  return <ConnectClaudeDialog {...props} open={open} initialTab={tab} onOpenChange={(next) => connectClaudeStore.getState().setOpen(next)} />;
}

interface ContentProps extends Omit<ConnectClaudeDialogProps, "open" | "onOpenChange"> {
  titleId: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

function ConnectClaudeContent({ titleId, bodyRef, onClose, host, onOpenGuide, defaults, initialTab = "code" }: ContentProps) {
  const [api] = useState<ConnectHostLike | null>(() => (host === undefined ? (getDesktopHostApi() ?? null) : host));
  const browser = api === null;
  const platform = defaults?.platform ?? api?.platform ?? guessPlatform();
  const shell = shellForPlatform(platform);
  const mcp = useMcpStatus(api, { intervalMs: 4000 });
  const [tab, setTab] = useState<ConnectTab>(initialTab);
  const [mode, setMode] = useState<LaunchMode>(defaults?.mode ?? (IS_DEV_BUILD ? "checkout" : "installed"));
  const [storedNode, setNodePath] = useStoredString("sonobe.connect.nodePath");
  const [storedRepo, setRepoPath] = useStoredString("sonobe.connect.repoPath");
  const [storedProject, setProject] = useStoredString("sonobe.connect.headlessProject");
  const [detectedRepo, setDetectedRepo] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "checkout" || defaults?.repoPath) return;
    let cancelled = false;
    void detectRepoPath().then((path) => {
      if (!cancelled) setDetectedRepo(path);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, defaults?.repoPath]);

  const nodePath = storedNode || defaults?.nodePath || "node";
  const repoPath = storedRepo || defaults?.repoPath || detectedRepo || "";
  const project = storedProject || defaults?.headlessProject || "";
  const spec = mcpLaunchSpec({ mode, nodePath, repoPath, ...(browser ? { headlessProject: project || (shell === "windows" ? "C:\\path\\to\\Prototype.sonobe" : "/path/to/Prototype.sonobe") } : {}) });
  const tokenFile = mcp.status?.tokenFile ? tildePath(mcp.status.tokenFile) : "~/.sonobe/mcp.json";

  const launchSettings = (
    <LaunchSettings
      mode={mode}
      onModeChange={setMode}
      nodePath={storedNode || defaults?.nodePath || ""}
      onNodePathChange={setNodePath}
      repoPath={repoPath}
      onRepoPathChange={setRepoPath}
      shell={shell}
      browser={browser}
      project={project}
      onProjectChange={setProject}
    />
  );

  return (
    <div className="sb-connect">
      <header className="sb-connect__header">
        <span className="sb-connect__mark" aria-hidden>
          <Sparkles size={16} strokeWidth={2} />
        </span>
        <div className="sb-connect__heading">
          <h2 className="sb-connect__title" id={titleId}>
            Connect Claude
          </h2>
          <p className="sb-connect__subtitle">Build with Claude Desktop or Claude Code on your own Claude plan. There's no API key to paste, and you never sign in to Claude here.</p>
        </div>
        <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
      </header>

      <div className="sb-connect__body sb-scroll" ref={bodyRef} tabIndex={-1}>
        <StatusCard browser={browser} mcp={mcp} />
        <FlowDiagram browser={browser} />

        <section className="sb-connect__section" aria-label="Setup">
          <SegmentedControl<ConnectTab>
            fullWidth
            aria-label="Claude app"
            value={tab}
            onChange={setTab}
            options={[
              { value: "code", label: "Claude Code", icon: <SquareTerminal size={13} /> },
              { value: "desktop", label: "Claude Desktop", icon: <Monitor size={13} /> },
            ]}
          />
          {tab === "code" ? (
            <ol className="sb-connect__steps">
              <Step n={1} title="Run this in a terminal">
                <CopyBlock text={claudeCodeCommand(spec, shell)} label="Claude Code command" />
                {launchSettings}
              </Step>
              <Step n={2} title="Start Claude Code and ask">
                <div className="sb-connect__ask">“{browser ? "Show me the outline of this prototype." : "List the documents open in Sonobe."}”</div>
                <p className="sb-connect__hint">
                  Run <code>claude mcp list</code> anytime to check the connection.
                </p>
              </Step>
            </ol>
          ) : (
            <DesktopSteps spec={spec} platform={platform} launchSettings={launchSettings} mode={mode} browser={browser} />
          )}
          <p className="sb-connect__note">
            <CircleAlert size={13} strokeWidth={2} aria-hidden />
            <span>Claude in a web browser can't reach apps on your computer. Use Claude Desktop or Claude Code.</span>
          </p>
        </section>

        <PromptExamples />

        <section className="sb-connect__privacy" aria-labelledby={`${titleId}-privacy`}>
          <h3 className="sb-connect__section-title" id={`${titleId}-privacy`}>
            <ShieldCheck size={13} strokeWidth={2} aria-hidden /> What stays private
          </h3>
          <ul>
            <li>Sonobe's MCP server listens only on this computer (127.0.0.1) and rejects requests from web pages, so other devices and websites can't reach it.</li>
            <li>
              Every request needs the token in <code>{tokenFile}</code>, a file only your account can read. You never paste it anywhere.
            </li>
            <li>You sign in to Claude inside Claude's own app. Sonobe never asks for your Claude login and never sees your credentials.</li>
            <li>What Claude reads through Sonobe, like the outline, live values, or a screenshot, becomes part of your Claude conversation under your plan's settings.</li>
          </ul>
        </section>
      </div>

      <footer className="sb-connect__footer">
        {onOpenGuide && (
          <Button
            variant="ghost"
            icon={<BookOpen size={13} />}
            onClick={() => {
              onOpenGuide(CLAUDE_GUIDE);
              onClose();
            }}
          >
            Read Working with Claude
          </Button>
        )}
        <span className="sb-connect__spacer" />
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="sb-connect__step">
      <span className="sb-connect__step-number sb-tabular" aria-hidden>
        {n}
      </span>
      <div className="sb-connect__step-body">
        <div className="sb-connect__step-title">{title}</div>
        {children}
      </div>
    </li>
  );
}

function StatusCard({ browser, mcp }: { browser: boolean; mcp: McpStatusState }) {
  if (browser) {
    return (
      <div className="sb-connect__status" data-tone="neutral" role="status">
        <span className="sb-connect__status-icon" aria-hidden>
          <Monitor size={15} strokeWidth={2} />
        </span>
        <div className="sb-connect__status-text">
          <div className="sb-connect__status-title">Live editing needs the desktop app</div>
          <div className="sb-connect__status-desc">Claude reaches your open document through a small server that the Sonobe desktop app runs on your computer. A browser can't run one. Open this prototype in the desktop app, or save it as a project folder and let Claude work on the folder with the headless command below.</div>
        </div>
      </div>
    );
  }
  if (mcp.loading) {
    return (
      <div className="sb-connect__status" data-tone="neutral" role="status">
        <span className="sb-connect__status-icon" aria-hidden>
          <LoaderCircle size={15} strokeWidth={2} className="sb-connect__spin" />
        </span>
        <div className="sb-connect__status-text">
          <div className="sb-connect__status-title">Checking Sonobe's MCP server…</div>
        </div>
      </div>
    );
  }
  if (mcp.status?.running) {
    return (
      <div className="sb-connect__status" data-tone="success" role="status">
        <span className="sb-connect__status-dot" aria-hidden />
        <div className="sb-connect__status-text">
          <div className="sb-connect__status-title">Sonobe is ready for Claude</div>
          <div className="sb-connect__status-desc">
            The MCP server is running{mcp.status.url ? " at " : "."}
            {mcp.status.url && <code className="sb-connect__url">{mcp.status.url}</code>}
            {mcp.status.url ? ". " : " "}Only apps on this computer can connect.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="sb-connect__status" data-tone="warn" role="status">
      <span className="sb-connect__status-icon" aria-hidden>
        <CircleAlert size={15} strokeWidth={2} />
      </span>
      <div className="sb-connect__status-text">
        <div className="sb-connect__status-title">{mcp.error ? "Couldn't read the MCP server status" : "Sonobe's MCP server is off"}</div>
        <div className="sb-connect__status-desc">{mcp.error ?? "It normally starts with the app. If Sonobe was launched with SONOBE_MCP=0, quit and open it again without that setting."}</div>
      </div>
      <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={mcp.refresh}>
        Check again
      </Button>
    </div>
  );
}

function FlowDiagram({ browser }: { browser: boolean }) {
  return (
    <ol className="sb-connect__flow" aria-label="How Claude connects to Sonobe">
      <li className="sb-connect__node" data-tone="ai">
        <span className="sb-connect__node-icon" aria-hidden>
          <Sparkles size={13} strokeWidth={2} />
        </span>
        <span className="sb-connect__node-title">Claude Desktop or Claude Code</span>
        <span className="sb-connect__node-sub">signed in with your plan</span>
      </li>
      <li className="sb-connect__edge" aria-hidden>
        <span>MCP</span>
      </li>
      <li className="sb-connect__node">
        <span className="sb-connect__node-icon" aria-hidden>
          <SquareTerminal size={13} strokeWidth={2} />
        </span>
        <span className="sb-connect__node-title">{browser ? "sonobe mcp --headless" : "Sonobe's local server"}</span>
        <span className="sb-connect__node-sub">{browser ? "runs on your computer" : "127.0.0.1, token required"}</span>
      </li>
      <li className="sb-connect__edge" aria-hidden />
      <li className="sb-connect__node">
        <span className="sb-connect__node-icon" aria-hidden>
          <Layers size={13} strokeWidth={2} />
        </span>
        <span className="sb-connect__node-title">{browser ? "Your project folder" : "This document"}</span>
        <span className="sb-connect__node-sub">{browser ? "edits save to disk" : "one undo entry per change"}</span>
      </li>
    </ol>
  );
}

interface LaunchSettingsProps {
  mode: LaunchMode;
  onModeChange: (mode: LaunchMode) => void;
  nodePath: string;
  onNodePathChange: (value: string) => void;
  repoPath: string;
  onRepoPathChange: (value: string) => void;
  shell: ShellFlavor;
  browser: boolean;
  project: string;
  onProjectChange: (value: string) => void;
}

function LaunchSettings({ mode, onModeChange, nodePath, onNodePathChange, repoPath, onRepoPathChange, shell, browser, project, onProjectChange }: LaunchSettingsProps) {
  return (
    <div className="sb-connect__settings">
      <div className="sb-connect__settings-row">
        <SegmentedControl<LaunchMode>
          size="sm"
          aria-label="How Claude starts Sonobe"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "installed", label: "sonobe command" },
            { value: "checkout", label: "From source" },
          ]}
        />
        <span className="sb-connect__hint">{mode === "installed" ? "Uses the sonobe CLI on your PATH." : "Runs the CLI from a Sonobe checkout with Node 22.18 or later."}</span>
      </div>
      {mode === "checkout" && (
        <div className="sb-connect__fields">
          <label className="sb-connect__field">
            <span className="sb-connect__field-label">Node</span>
            <TextField size="sm" mono value={nodePath} placeholder="node" aria-describedby="sb-connect-node-hint" onChange={(event) => onNodePathChange(event.target.value)} />
          </label>
          <label className="sb-connect__field">
            <span className="sb-connect__field-label">Sonobe folder</span>
            <TextField size="sm" mono value={repoPath} placeholder={shell === "windows" ? "C:\\path\\to\\sonobe" : "/path/to/sonobe"} onChange={(event) => onRepoPathChange(event.target.value)} />
          </label>
          <p className="sb-connect__hint" id="sb-connect-node-hint">
            If Claude can't start Sonobe, use Node's full path. <code>{shell === "windows" ? "where node" : "which node"}</code> prints it.
          </p>
        </div>
      )}
      {browser && (
        <div className="sb-connect__fields">
          <label className="sb-connect__field">
            <span className="sb-connect__field-label">Project folder</span>
            <TextField size="sm" mono value={project} placeholder={shell === "windows" ? "C:\\path\\to\\Prototype.sonobe" : "/path/to/Prototype.sonobe"} onChange={(event) => onProjectChange(event.target.value)} />
          </label>
          <p className="sb-connect__hint">Headless mode edits, simulates, and saves the folder directly. Screenshots need the desktop app.</p>
        </div>
      )}
    </div>
  );
}

function DesktopSteps({ spec, platform, launchSettings, mode, browser }: { spec: ReturnType<typeof mcpLaunchSpec>; platform: string; launchSettings: ReactNode; mode: LaunchMode; browser: boolean }) {
  const bundle = browser ? null : claudeDesktopBundle();
  const configPath = claudeDesktopConfigPath(platform);
  let n = 0;
  return (
    <ol className="sb-connect__steps">
      {bundle && (
        <Step n={++n} title={`Install the ${bundle.name} extension`}>
          <p className="sb-connect__text">
            Open the <code>.mcpb</code> bundle built from <code>{bundle.folder}</code>. Claude Desktop shows what it will run. Confirm to install.
          </p>
        </Step>
      )}
      <Step n={++n} title={bundle ? "Or add Sonobe by hand" : "Add Sonobe to Claude Desktop's config"}>
        <p className="sb-connect__text">
          In Claude Desktop, open <strong>Settings → Developer → Edit Config</strong> and add this to <code>claude_desktop_config.json</code>:
        </p>
        <CopyBlock text={claudeDesktopConfig(spec)} label="Claude Desktop config" />
        <p className="sb-connect__hint">
          {configPath ? (
            <>
              The file is at <code>{configPath}</code>.{" "}
            </>
          ) : null}
          If it already has <code>mcpServers</code>, add the <code>sonobe</code> entry inside it.
          {mode === "checkout" ? " Apps opened from the Dock or Start menu don't see your terminal's PATH, so a full path to node is safest." : ""}
        </p>
        {launchSettings}
      </Step>
      <Step n={++n} title="Restart Claude Desktop and ask">
        <div className="sb-connect__ask">“{browser ? "Show me the outline of this prototype." : "List the documents open in Sonobe."}”</div>
      </Step>
    </ol>
  );
}

function PromptExamples() {
  const [audience, setAudience] = useState(EXAMPLE_PROMPTS[0]!.audience);
  const group = EXAMPLE_PROMPTS.find((g) => g.audience === audience) ?? EXAMPLE_PROMPTS[0]!;
  const copy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Prompt copied", { description: "Paste it into Claude." });
    } catch {
      toast.error("Couldn't copy", { description: "Select the text and copy it instead." });
    }
  };
  return (
    <section className="sb-connect__section" aria-label="Try asking">
      <div className="sb-connect__section-head">
        <h3 className="sb-connect__section-title">Try asking</h3>
        <SegmentedControl size="sm" aria-label="Audience" value={audience} onChange={setAudience} options={EXAMPLE_PROMPTS.map((g) => ({ value: g.audience, label: g.audience }))} />
      </div>
      <p className="sb-connect__hint">{group.description}</p>
      <ul className="sb-connect__prompts">
        {group.prompts.map((prompt) => (
          <li key={prompt}>
            <button type="button" className="sb-connect__prompt" onClick={() => void copy(prompt)} aria-label={`Copy prompt: ${prompt}`}>
              <span>{prompt}</span>
              <Copy size={12} strokeWidth={2} aria-hidden className="sb-connect__prompt-icon" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
