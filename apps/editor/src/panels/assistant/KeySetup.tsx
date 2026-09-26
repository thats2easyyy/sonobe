import { ChevronRight, CircleAlert, CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
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
  /** The experimental switch is on, so the Claude subscription is a choice beside this one: the copy points to it. */
  subscriptionEnabled?: boolean;
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
 * subscription alternatives (Connect Claude over MCP, and with the experimental switch on, the choice above).
 */
export function KeySetup({ controller, status, keyCheck, onConnectClaude, onDone, subscriptionEnabled = false }: KeySetupProps) {
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
        <h3 className="sb-assistant-key__title">Use your own Anthropic API key</h3>
        <p className="sb-assistant-key__lead">Usage is billed to your Anthropic account at API rates.</p>
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
        </div>
      ) : null}

      <div className="sb-assistant-key__field">
        <div className="sb-assistant-key__label-row">
          <label className="sb-assistant-key__label" htmlFor={fieldId}>
            {status.hasKey ? "Replace key" : "API key"}
          </label>
          <button type="button" className="sb-assistant-link" onClick={() => controller.openConsole()}>
            console.anthropic.com
            <ExternalLink size={11} aria-hidden />
          </button>
        </div>
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
      </div>

      {!secretsOk ? (
        <div className="sb-assistant-callout" data-tone="warn" role="alert">
          <CircleAlert size={15} aria-hidden className="sb-assistant-callout__icon" />
          <div>
            <p className="sb-assistant-callout__title">Sonobe can't store a key securely on this computer</p>
            <p className="sb-assistant-callout__body">{status.secrets.reason ?? "No system keychain is available."} You can still use Claude over MCP with Connect Claude.</p>
          </div>
        </div>
      ) : null}

      <div className="sb-assistant-privacy">
        <p id={hintId} className="sb-assistant-privacy__summary">
          Your key is encrypted with {backend} and never stored in your project files.
        </p>
        <details className="sb-assistant-privacy__details">
          <summary className="sb-assistant-privacy__toggle">
            <ChevronRight size={12} aria-hidden />
            Details
          </summary>
          <ul>
            <li>Only Sonobe's main process reads the key, to call Anthropic's API.</li>
            <li>When you chat, your messages, the parts of this prototype the Assistant reads, and any files it reads from a code folder you link are sent to Anthropic's API.</li>
            {/* The Claude subscription's Sign in… opens Claude Code's own login in Terminal. */}
            <li>{subscriptionEnabled ? "Sonobe never reads Claude credentials." : "Sonobe never asks for your claude.ai login and never reads Claude credentials."}</li>
          </ul>
        </details>
      </div>

      <div className="sb-assistant-callout" data-tone="ai">
        <div>
          <p className="sb-assistant-callout__title">Prefer your Claude subscription?</p>
          <p className="sb-assistant-callout__body">
            {subscriptionEnabled
              ? "Choose Claude subscription above, or connect Claude Desktop or Claude Code to Sonobe and build with your own Claude plan there. No API key needed."
              : "Connect Claude Desktop or Claude Code to Sonobe and build with your own Claude plan. No API key needed."}
          </p>
          <Button size="sm" variant="ghost" className="sb-assistant-callout__action" onClick={onConnectClaude}>
            Connect Claude Desktop or Claude Code
          </Button>
        </div>
      </div>
    </div>
  );
}
