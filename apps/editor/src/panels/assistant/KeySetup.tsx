import { CircleAlert, CircleCheck, ExternalLink, KeyRound, LoaderCircle, Plug, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { TextField } from "../../ui/TextField.tsx";
import type { KeyCheckState } from "./assistantStore.ts";
import type { AssistantController } from "./controller.ts";
import { validateApiKey } from "./format.ts";
import type { AssistantStatus } from "./types.ts";

export interface KeySetupProps {
  controller: AssistantController;
  status: AssistantStatus;
  keyCheck: KeyCheckState;
  /** Opens the Connect Claude dialog. */
  onConnectClaude: () => void;
  /** Shown when a key is already saved: go back to the chat. */
  onDone?: () => void;
}

const BACKEND_NAMES: Record<string, string> = {
  keychain: "macOS Keychain",
  dpapi: "Windows Data Protection",
  gnome_libsecret: "your system keyring",
  kwallet: "KWallet",
  kwallet5: "KWallet",
  kwallet6: "KWallet",
};

/**
 * Bring-your-own-key setup: where to get a key, a password field, what happens to the key, and the
 * subscription alternative (Connect Claude over MCP).
 */
export function KeySetup({ controller, status, keyCheck, onConnectClaude, onDone }: KeySetupProps) {
  const fieldId = useId();
  const hintId = useId();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validation = value ? validateApiKey(value) : null;
  const secretsOk = status.secrets.available;
  const backend = status.secrets.backend ? (BACKEND_NAMES[status.secrets.backend] ?? "your system keychain") : "your system keychain";

  const save = async () => {
    const check = validateApiKey(value);
    if (!check.ok) {
      setError(check.error ?? "That key can't be saved.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await controller.saveKey(value);
    setSaving(false);
    if (result.ok) {
      setValue("");
      onDone?.();
    } else {
      setError(result.message ?? "The key didn't work.");
    }
  };

  return (
    <div className="sb-assistant-key">
      <div className="sb-assistant-key__intro">
        <span className="sb-assistant-key__icon" aria-hidden>
          <KeyRound size={18} strokeWidth={1.75} />
        </span>
        <h3 className="sb-assistant-key__title">Use your own Anthropic API key</h3>
        <p className="sb-assistant-key__lead">The Assistant chats with Claude using an API key from your Anthropic account. Usage is billed to that account at API rates, separately from any Claude plan.</p>
      </div>

      <div className="sb-assistant-callout" data-tone="ai">
        <Plug size={15} aria-hidden className="sb-assistant-callout__icon" />
        <div>
          <p className="sb-assistant-callout__title">Prefer your Claude subscription?</p>
          <p className="sb-assistant-callout__body">Connect Claude Desktop or Claude Code to Sonobe and build with your own Claude plan. No API key needed.</p>
          <Button size="sm" variant="ghost" className="sb-assistant-callout__action" onClick={onConnectClaude}>
            Connect Claude Desktop or Claude Code
          </Button>
        </div>
      </div>

      {status.hasKey ? (
        <div className="sb-assistant-key__saved">
          <div className="sb-assistant-key__saved-row">
            <CircleCheck size={15} aria-hidden className="sb-assistant-key__ok" />
            <span>
              Key saved <code className="sb-assistant-key__hint">{status.keyHint ?? "…"}</code>
            </span>
          </div>
          {keyCheck.state === "checking" ? (
            <p className="sb-assistant-key__status" role="status">
              <LoaderCircle size={13} className="sb-spin" aria-hidden /> Checking the key…
            </p>
          ) : keyCheck.state === "ok" ? (
            <p className="sb-assistant-key__status" data-tone="success" role="status">
              The key works.
            </p>
          ) : keyCheck.state === "error" ? (
            <p className="sb-assistant-key__status" data-tone="danger" role="alert">
              {keyCheck.message}
            </p>
          ) : null}
          <div className="sb-assistant-key__actions">
            <Button size="sm" onClick={() => void controller.checkKey()} loading={keyCheck.state === "checking"}>
              Check key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void controller.removeKey()}>
              Remove key
            </Button>
            {onDone ? (
              <Button size="sm" variant="primary" onClick={onDone} className="sb-assistant-key__done">
                Back to chat
              </Button>
            ) : null}
          </div>
          <p className="sb-assistant-key__replace">To use a different key, paste it below.</p>
        </div>
      ) : null}

      <ol className="sb-assistant-key__steps">
        <li>
          <span className="sb-assistant-key__step-title">Create a key</span>
          <span className="sb-assistant-key__step-body">
            Sign in at{" "}
            <button type="button" className="sb-assistant-link" onClick={() => controller.openConsole()}>
              console.anthropic.com
              <ExternalLink size={11} aria-hidden />
            </button>{" "}
            and create an API key under Settings → API Keys.
          </span>
        </li>
        <li>
          <label className="sb-assistant-key__step-title" htmlFor={fieldId}>
            Paste it here
          </label>
          <form
            className="sb-assistant-key__form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <TextField
              id={fieldId}
              type="password"
              mono
              value={value}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={hintId}
              invalid={!!error}
              disabled={!secretsOk || saving}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            <Button type="submit" variant="primary" disabled={!secretsOk || !value.trim()} loading={saving}>
              Save key
            </Button>
          </form>
          {error ? (
            <p className="sb-assistant-key__status" data-tone="danger" role="alert">
              {error}
            </p>
          ) : validation?.warning ? (
            <p className="sb-assistant-key__status" data-tone="warn">
              {validation.warning}
            </p>
          ) : null}
        </li>
      </ol>

      {!secretsOk ? (
        <div className="sb-assistant-callout" data-tone="warn" role="alert">
          <CircleAlert size={15} aria-hidden className="sb-assistant-callout__icon" />
          <div>
            <p className="sb-assistant-callout__title">Sonobe can't store a key securely on this computer</p>
            <p className="sb-assistant-callout__body">{status.secrets.reason ?? "No system keychain is available."} You can still use Claude over MCP with Connect Claude.</p>
          </div>
        </div>
      ) : null}

      <div className="sb-assistant-privacy" id={hintId}>
        <ShieldCheck size={15} aria-hidden className="sb-assistant-privacy__icon" />
        <ul>
          <li>Your key is encrypted with {backend} and kept in Sonobe's app data, never in your project files. Only Sonobe's main process reads it, to call Anthropic's API.</li>
          <li>When you chat, your messages and the parts of this prototype the Assistant reads are sent to Anthropic's API.</li>
          <li>Sonobe never asks for your claude.ai login and never reads Claude credentials.</li>
        </ul>
      </div>
    </div>
  );
}
