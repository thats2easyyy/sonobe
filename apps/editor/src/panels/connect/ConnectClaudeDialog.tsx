import { BookOpen, Check, ChevronRight, CircleAlert, Copy, LoaderCircle, Monitor, RefreshCw, SquareTerminal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getDesktopHostApi } from "../../host/detect.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DIALOG_WIDTH } from "../../ui/Dialog.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { detectHostPlatform } from "../../ui/commands/shortcutManager.ts";
import { cx } from "../../ui/lib/cx.ts";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { getAssistantHost, supportsAssistant } from "../assistant/types.ts";
import { claudeDesktopBundle, detectRepoPath, IS_DEV_BUILD } from "./buildInfo.ts";
import {
  claudeCodeCommand,
  claudeCodeRemoveCommand,
  claudeDesktopConfig,
  claudeDesktopConfigPath,
  connectedSessions,
  EXAMPLE_PROMPTS,
  isHeadlessSpec,
  mcpLaunchSpec,
  relativeTime,
  shellForPlatform,
  tildePath,
  type LaunchMode,
  type McpSessionInfo,
  type ShellFlavor,
} from "./connectInfo.ts";
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
  /** "installed" (the app's bundled CLI, else `sonobe` on PATH) or "checkout" (node + repo). Default: checkout in dev builds. */
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

/** The desktop host's platform, else navigator.userAgentData / navigator.platform (never guessed from the user agent first). */
function guessPlatform(): string {
  return detectHostPlatform();
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

/** Shown, dimmed, in the command until the project folder is filled in. */
const PROJECT_PLACEHOLDER = "<project folder>";

/**
 * Connect Claude: the MCP server's status, then the Claude Code command or Claude Desktop setup for this
 * machine, example prompts, and privacy notes.
 */
export function ConnectClaudeDialog({ open, onOpenChange, ...rest }: ConnectClaudeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={DIALOG_WIDTH.lg} className="sb-connect-dialog" style={{ maxHeight: "min(720px, calc(100vh - 48px))" }}>
      <ConnectClaudeContent onClose={() => onOpenChange(false)} {...rest} />
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
  onClose: () => void;
}

function ConnectClaudeContent({ onClose, host, onOpenGuide, defaults, initialTab = "code" }: ContentProps) {
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
  const project = (storedProject || defaults?.headlessProject || "").trim();
  const projectMissing = browser && project === "";
  const cliPath = mcp.status?.cliPath ?? null;
  const spec = mcpLaunchSpec({ mode, nodePath, repoPath, cliPath, ...(browser ? { headlessProject: project || PROJECT_PLACEHOLDER } : {}) });
  const tokenFile = mcp.status?.tokenFile ? tildePath(mcp.status.tokenFile) : "~/.sonobe/mcp.json";

  const [assistantAvailable] = useState(() => supportsAssistant(getAssistantHost()));
  const projectField = browser ? <ProjectField shell={shell} project={project} onChange={setProject} /> : null;
  const advanced = (
    <Advanced
      mode={mode}
      onModeChange={setMode}
      nodePath={storedNode || defaults?.nodePath || ""}
      onNodePathChange={setNodePath}
      repoPath={repoPath}
      onRepoPathChange={setRepoPath}
      shell={shell}
      cliPath={cliPath}
    >
      {tab === "code" && !isHeadlessSpec(spec) && <SetUpBefore />}
    </Advanced>
  );

  return (
    <div className="sb-connect">
      <Dialog.Header
        title="Connect Claude"
        description={assistantAvailable ? "Let Claude Desktop or Claude Code build on your Claude plan. To chat inside Sonobe, open Assistant." : "Let Claude Desktop or Claude Code build on your Claude plan."}
        onClose={onClose}
      />

      <Dialog.Body className="sb-connect__body">
        <StatusRow browser={browser} mcp={mcp} />

        <section className="sb-connect__section" aria-label="Setup">
          <SegmentedControl<ConnectTab>
            size="sm"
            fullWidth
            aria-label="Claude app"
            value={tab}
            onChange={setTab}
            options={[
              { value: "code", label: "Claude Code", icon: <SquareTerminal size={13} /> },
              { value: "desktop", label: "Claude Desktop", icon: <Monitor size={13} /> },
            ]}
          />
          {!browser && <p className="sb-connect__hint">Claude in a web browser can't reach apps on your computer, so use one of these.</p>}
          {tab === "code" ? (
            <ClaudeCodeSteps spec={spec} shell={shell} browser={browser} blocked={projectMissing} projectField={projectField} />
          ) : (
            <DesktopSteps spec={spec} platform={platform} mode={mode} browser={browser} blocked={projectMissing} projectField={projectField} />
          )}
        </section>

        <PromptExamples />

        {advanced}

        <Disclosure title="What stays private">
          <ul className="sb-connect__privacy">
            <li>Sonobe's MCP server listens only on this computer (127.0.0.1) and rejects requests from web pages, so other devices and websites can't reach it.</li>
            <li>
              Every request needs the token in <code>{tokenFile}</code>, a file only your account can read. You never paste it anywhere.
            </li>
            <li>You sign in to Claude inside Claude's own app. Sonobe never asks for your Claude login and never sees your credentials.</li>
            <li>What Claude reads through Sonobe, like the outline, live values, or a screenshot, becomes part of your Claude conversation under your plan's settings.</li>
          </ul>
        </Disclosure>
      </Dialog.Body>

      <Dialog.Footer
        start={
          onOpenGuide && (
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
          )
        }
      >
        {/* The kit would pick a field inside the closed Advanced disclosure, which can't take focus. */}
        <Button variant="primary" onClick={onClose} data-autofocus={browser ? undefined : ""}>
          Done
        </Button>
      </Dialog.Footer>
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

/** A closed-by-default section: its text stays in the page, so find-in-page opens it. */
function Disclosure({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <details className={cx("sb-connect__disclosure", className)}>
      <summary>
        <ChevronRight size={12} strokeWidth={2} aria-hidden />
        {title}
      </summary>
      <div className="sb-connect__disclosure-body">{children}</div>
    </details>
  );
}

/**
 * Claude Code: the relay installs once at user scope, so every session gets Sonobe's tools wherever it
 * starts. A headless server works on one folder, so it stays with that project (local scope).
 */
function ClaudeCodeSteps({ spec, shell, browser, blocked, projectField }: { spec: ReturnType<typeof mcpLaunchSpec>; shell: ShellFlavor; browser: boolean; blocked: boolean; projectField: ReactNode }) {
  const headless = isHeadlessSpec(spec);
  return (
    <ol className="sb-connect__steps">
      <Step n={1} title={headless ? "Run this in the folder where you start Claude" : "Run this once in a terminal, from any folder"}>
        {projectField}
        <CopyBlock text={claudeCodeCommand(spec, shell)} label="Claude Code command" placeholder={PROJECT_PLACEHOLDER} disabledReason={blocked ? "Add your project folder first" : undefined} />
        {headless && <p className="sb-connect__hint">Headless mode edits, simulates, saves, and takes approximate screenshots of the folder directly.</p>}
      </Step>
      <Step n={2} title={headless ? "Start Claude Code in that folder and ask" : "Start a new Claude Code session in any folder and ask"}>
        <div className="sb-connect__ask">“{browser ? "Show me the outline of this prototype." : "List the documents open in Sonobe."}”</div>
        <p className="sb-connect__hint">
          {browser ? null : "The session shows up at the top of this screen once it connects. "}Run <code>claude mcp list</code> anytime to check the setup.
        </p>
      </Step>
    </ol>
  );
}

/** For anyone whose earlier setup gets in the way of the command. */
function SetUpBefore() {
  return (
    <>
      <p className="sb-connect__hint">
        If Claude Code says <code>sonobe</code> already exists, it's set up. To point it at this copy of Sonobe, run <code>{claudeCodeRemoveCommand("user")}</code>, then the command again.
      </p>
      <p className="sb-connect__hint">
        Earlier versions added Sonobe to one folder only, and that entry wins in its folder. Run <code>{claudeCodeRemoveCommand("local")}</code> in that folder.
      </p>
    </>
  );
}

/** One status row: the server, the sessions connected to it, or what to do when it's off. */
function StatusRow({ browser, mcp }: { browser: boolean; mcp: McpStatusState }) {
  if (browser) {
    return (
      <Status tone="neutral" lead={<Monitor size={14} strokeWidth={2} />} title="Live editing needs the desktop app">
        In a browser, Claude can edit a saved project folder instead. Use the command below.
      </Status>
    );
  }
  if (mcp.loading) {
    return <Status tone="neutral" lead={<LoaderCircle size={14} strokeWidth={2} className="sb-connect__spin" data-spinner />} title="Checking Sonobe's MCP server…" />;
  }
  if (mcp.status?.running) {
    const status = mcp.status;
    const connected = connectedSessions(status);
    // Green only for a connected session: a server that's listening says nothing about Claude.
    return (
      <Status
        tone={connected.length ? "success" : "neutral"}
        lead={connected.length > 0 ? <Check size={14} strokeWidth={2} /> : <span className="sb-connect__status-dot" />}
        title={connected.length === 0 ? "No Claude session is connected" : connected.length === 1 ? `${connected[0]!.label} is connected` : `${connected.length} sessions are connected`}
      >
        {connected.length === 0 ? "Sessions show up here once Claude starts Sonobe's server. Set it up below, then start a new session or restart Claude Desktop. " : null}
        Sonobe's server is running{status.url ? " at " : "."}
        {status.url && <code className="sb-connect__url">{status.url}</code>}
        {status.clients.length > 0 && (
          <ul className="sb-connect__sessions" aria-label="Sessions">
            {status.clients.map((session) => (
              <SessionRow key={session.id} session={session} appVersion={status.version} />
            ))}
          </ul>
        )}
      </Status>
    );
  }
  return (
    <Status
      tone="warn"
      lead={<CircleAlert size={14} strokeWidth={2} />}
      title={mcp.error ? "Couldn't read the MCP server status" : "Sonobe's MCP server is off"}
      action={
        <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={mcp.refresh}>
          Check again
        </Button>
      }
    >
      {mcp.error ?? "It normally starts with the app. If Sonobe was launched with SONOBE_MCP=0, quit and open it again without that setting."}
    </Status>
  );
}

function Status({ tone, lead, title, action, children }: { tone: "neutral" | "success" | "warn"; lead: ReactNode; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sb-connect__status" data-tone={tone} role="status">
      <span className="sb-connect__status-lead" aria-hidden>
        {lead}
      </span>
      <div className="sb-connect__status-text">
        <div className="sb-connect__status-title">{title}</div>
        {children && <div className="sb-connect__status-desc">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** One session: who, where, and what it did last. */
function SessionRow({ session, appVersion }: { session: McpSessionInfo; appVersion: string | null }) {
  const now = Date.now();
  const activity =
    session.lastActivityAt !== null
      ? `${session.state === "connected" ? "Active" : "Last active"} ${relativeTime(session.lastActivityAt, now)}${session.lastTool ? ` · ${session.lastTool}` : ""} · ${session.toolCalls} tool ${session.toolCalls === 1 ? "call" : "calls"}`
      : session.state === "connected"
        ? `Connected ${relativeTime(session.connectedAt, now)} · no tool calls yet`
        : "No tool calls";
  const state = session.state === "gone" ? "Disconnected" : session.state === "idle" ? "Idle" : null;
  const olderRelay = session.via === "relay" && session.relayVersion !== null && appVersion !== null && session.relayVersion !== appVersion;
  return (
    <li className="sb-connect__session" data-state={session.state}>
      <span className="sb-connect__session-dot" aria-hidden />
      <div className="sb-connect__session-text">
        <div className="sb-connect__session-title">
          {session.label}
          {session.version && <span className="sb-connect__session-version sb-tabular"> {session.version}</span>}
          {state && <span className="sb-connect__session-state"> · {state}</span>}
        </div>
        {session.folder && <code className="sb-connect__session-folder">{tildePath(session.folder)}</code>}
        <div className="sb-connect__session-desc">{activity}</div>
        {session.via === "http" && <div className="sb-connect__session-note">It connected without Sonobe's relay, so Sonobe can't tell which session it is. Set up with the steps below to see it by name.</div>}
        {olderRelay && (
          <div className="sb-connect__session-note" data-tone="warn">
            Runs the relay from Sonobe {session.relayVersion}, not this app's {appVersion}. Set up again to use this app's version.
          </div>
        )}
      </div>
    </li>
  );
}

interface AdvancedProps {
  mode: LaunchMode;
  onModeChange: (mode: LaunchMode) => void;
  nodePath: string;
  onNodePathChange: (value: string) => void;
  repoPath: string;
  onRepoPathChange: (value: string) => void;
  shell: ShellFlavor;
  /** The app's bundled CLI launcher, when the desktop host reports one. */
  cliPath: string | null;
  children?: ReactNode;
}

/** What the chosen launch mode runs. */
function launchHint(mode: LaunchMode, cliPath: string | null): ReactNode {
  if (mode === "checkout") return "Runs the CLI from a Sonobe checkout with Node 22.18 or later.";
  if (cliPath) return "Runs the CLI that comes with the Sonobe app, by its full path, so nothing has to be on your PATH.";
  return (
    <>
      Uses a <code>sonobe</code> command on your PATH, after building the CLI and running <code>npm link -w @sonobe/cli</code>.
    </>
  );
}

/** How Claude starts Sonobe, for anyone who isn't using the app's own CLI. Changes the commands above. */
function Advanced({ mode, onModeChange, nodePath, onNodePathChange, repoPath, onRepoPathChange, shell, cliPath, children }: AdvancedProps) {
  return (
    <Disclosure title="Advanced">
      <div className="sb-connect__settings">
        <div className="sb-connect__settings-row">
          <SegmentedControl<LaunchMode>
            size="sm"
            aria-label="How Claude starts Sonobe"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: "installed", label: cliPath ? "Sonobe app" : "sonobe command" },
              { value: "checkout", label: "From source" },
            ]}
          />
          <span className="sb-connect__hint">{launchHint(mode, cliPath)}</span>
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
        {children}
      </div>
    </Disclosure>
  );
}

/** The folder the headless server works on. The commands stay disabled until it's filled in. */
function ProjectField({ shell, project, onChange }: { shell: ShellFlavor; project: string; onChange: (value: string) => void }) {
  return (
    <div className="sb-connect__field">
      <label className="sb-connect__field-label" htmlFor="sb-connect-project">
        Project folder
      </label>
      <TextField id="sb-connect-project" size="sm" mono value={project} placeholder={shell === "windows" ? "C:\\path\\to\\Prototype.sonobe" : "/path/to/Prototype.sonobe"} aria-describedby="sb-connect-project-hint" onChange={(event) => onChange(event.target.value)} />
      <p className="sb-connect__hint" id="sb-connect-project-hint">
        {project === "" ? "Save this prototype as a project folder first, then paste its path here." : "Claude reads and edits the files in this folder."}
      </p>
    </div>
  );
}

function DesktopSteps({ spec, platform, mode, browser, blocked, projectField }: { spec: ReturnType<typeof mcpLaunchSpec>; platform: string; mode: LaunchMode; browser: boolean; blocked: boolean; projectField: ReactNode }) {
  const bundle = browser ? null : claudeDesktopBundle();
  const configPath = claudeDesktopConfigPath(platform);
  let n = 0;
  return (
    <ol className="sb-connect__steps">
      {bundle && (
        <Step n={++n} title={`Build and install the ${bundle.name} extension`}>
          <p className="sb-connect__text">
            From your Sonobe folder, build and pack the extension in <code>{bundle.folder}</code>:
          </p>
          <CopyBlock text={bundle.buildCommands} label="Extension build commands" />
          <p className="sb-connect__hint">
            Then open <code>{bundle.file}</code>. Claude Desktop shows what it will run. Confirm to install.
          </p>
        </Step>
      )}
      <Step n={++n} title={bundle ? "Or add Sonobe by hand" : "Add Sonobe to Claude Desktop's config"}>
        <p className="sb-connect__text">
          In Claude Desktop, open <strong>Settings → Developer → Edit Config</strong> and add the snippet below to <code>claude_desktop_config.json</code>.
        </p>
        {projectField}
        <CopyBlock text={claudeDesktopConfig(spec)} label="Claude Desktop config" kind="config" placeholder={PROJECT_PLACEHOLDER} disabledReason={blocked ? "Add your project folder first" : undefined} />
        <p className="sb-connect__hint">
          {configPath ? (
            <>
              The file is at <code>{configPath}</code>.{" "}
            </>
          ) : null}
          If it already has <code>mcpServers</code>, add the <code>sonobe</code> entry inside it.
          {mode === "checkout"
            ? " Apps opened from the Dock or Start menu don't see your terminal's PATH, so a full path to node is safest."
            : spec.command === "sonobe"
              ? " Claude Desktop doesn't see your terminal's PATH, so replace sonobe with the command's full path."
              : ""}
        </p>
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
      connectClaudeStore.getState().markCopied("prompt");
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
