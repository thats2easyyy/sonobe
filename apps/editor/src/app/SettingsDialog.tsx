import { DEVICE_PRESETS, type DevicePreset } from "@sonobe/core";
import { ChevronRight, FolderLock, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useAssistant } from "../panels/assistant/assistantStore.ts";
import { sharedAssistantController } from "../panels/assistant/controller.ts";
import { getAssistantHost, supportsAssistant } from "../panels/assistant/types.ts";
import { useEditorSession } from "../state/EditorProvider.tsx";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog, DIALOG_WIDTH } from "../ui/Dialog.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../ui/Select.tsx";
import { toast } from "../ui/Toast.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { trustServiceFor } from "./sessionServices.ts";
import { settingsStore, useSettings, type AgentPermission, type MotionPreference } from "./settings.ts";
import "./dialogs.css";

const KIND_LABELS: Record<DevicePreset["kind"], string> = { phone: "Phones", tablet: "Tablets", computer: "Desktop", watch: "Watch", custom: "Custom" };

const DEVICE_OPTIONS: SelectOption[] = DEVICE_PRESETS.map((d) => ({ value: d.id, label: d.name, group: KIND_LABELS[d.kind], trailing: `${d.size[0]}×${d.size[1]}`, keywords: [d.platform, d.kind] }));

/** `descriptionId`: the description's id, for the control's aria-describedby. `details`: what doesn't fit in the description, behind a closed disclosure. */
function Row({ name, description, descriptionId, details, children, stack = false }: { name: string; description?: ReactNode; descriptionId?: string; details?: ReactNode; children: ReactNode; stack?: boolean }) {
  const id = useId();
  return (
    <div className="sb-settings__row" data-stack={stack || undefined} data-details={details ? "" : undefined} role="group" aria-labelledby={id}>
      <div className="sb-settings__label">
        <span className="sb-settings__name" id={id}>
          {name}
        </span>
        {description && (
          <span className="sb-settings__desc" id={descriptionId}>
            {description}
          </span>
        )}
        {details && (
          <details className="sb-settings__details">
            <summary>
              <ChevronRight size={12} strokeWidth={2} aria-hidden />
              Details
            </summary>
            <p className="sb-settings__desc">{details}</p>
          </details>
        )}
      </div>
      <div className="sb-settings__control">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sb-settings__section" aria-label={title}>
      <h3 className="sb-settings__section-title">{title}</h3>
      {children}
    </section>
  );
}

/** Prototypes allowed to run JavaScript patches: the session's trust service when it has one, else Settings' own list. */
function useTrustedProjects(): { paths: readonly string[]; revoke: (path: string) => void } {
  const session = useEditorSession();
  const service = trustServiceFor(session);
  const stored = useSettings((s) => s.trustedProjects);
  const [, setVersion] = useState(0);
  useEffect(() => service?.subscribe?.(() => setVersion((v) => v + 1)), [service]);
  if (service) return { paths: service.list(), revoke: (path) => service.revoke(path) };
  return { paths: stored, revoke: (path) => settingsStore.getState().revokeProject(path) };
}

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SUBSCRIPTION_SWITCH_LABEL = "Use my Claude subscription in the Assistant";
export const SUBSCRIPTION_SWITCH_DESCRIPTION = "Experimental · awaiting Anthropic's permission. Off by default and not part of any release until Anthropic agrees.";
const SUBSCRIPTION_SWITCH_DETAILS = "When it's on, the Assistant runs Claude through Claude's agent adapter. It uses the Claude account you're signed in to on this computer, and your plan's usage limits.";

/**
 * The experimental switch (desktop, with a preload that has it): the Assistant on the person's Claude
 * subscription. Main keeps it, off by default; this asks main and shows what main says. A build that
 * doesn't offer it (any packaged build, so every release) shows nothing, and so does one whose answer
 * hasn't come yet, so a release never shows the switch even for a moment.
 */
function SubscriptionSwitch() {
  const controller = useMemo(() => sharedAssistantController(), []);
  const connection = useAssistant((s) => s.status?.connection);
  const descriptionId = useId();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void controller.refresh();
  }, [controller]);
  const change = async (subscriptionEnabled: boolean) => {
    setSaving(true);
    const result = await controller.setConnection({ subscriptionEnabled });
    setSaving(false);
    if (result && !result.ok) toast.error("Couldn't change the setting", { description: result.error });
  };
  if (!connection || connection.available === false) return null;
  return (
    // The description is the switch's too: a screen reader says it's experimental and awaiting Anthropic's permission.
    <Row name={SUBSCRIPTION_SWITCH_LABEL} description={SUBSCRIPTION_SWITCH_DESCRIPTION} descriptionId={descriptionId} details={SUBSCRIPTION_SWITCH_DETAILS}>
      <Toggle aria-label={SUBSCRIPTION_SWITCH_LABEL} aria-describedby={descriptionId} checked={connection.subscriptionEnabled} disabled={saving} onChange={(checked) => void change(checked)} />
    </Row>
  );
}

/** Settings: theme, motion, the default device, the welcome screen, what Claude may do (and the experimental subscription switch), and trusted prototypes. */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={DIALOG_WIDTH.md} className="sb-settings" modalScope="settings">
      <SettingsContent onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function SettingsContent({ onClose }: { onClose: () => void }) {
  const session = useEditorSession();
  const { preference, setPreference } = useTheme();
  const motion = useSettings((s) => s.motion);
  const defaultDevice = useSettings((s) => s.defaultDevice);
  const agentPermission = useSettings((s) => s.agentPermission);
  const showWelcomeOnLaunch = useSettings((s) => s.showWelcomeOnLaunch);
  const update = settingsStore.getState().update;
  const trusted = useTrustedProjects();
  const desktop = session.host?.kind === "desktop";
  const [assistantHost] = useState(getAssistantHost);
  const subscriptionSwitch = supportsAssistant(assistantHost) && typeof assistantHost.assistant.setConnection === "function";

  return (
    <>
      <Dialog.Header title="Settings" onClose={onClose} />
      <Dialog.Body>
        <div className="sb-settings__content" tabIndex={-1} data-autofocus>
          <Section title="Appearance">
            <Row name="Theme" description="System follows your computer's light or dark setting.">
              <SegmentedControl<ThemePreference>
                size="sm"
                aria-label="Theme"
                value={preference}
                onChange={setPreference}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
              />
            </Row>
            <Row name="Motion" description="Reduce turns off interface animation. Your prototypes still animate.">
              <SegmentedControl<MotionPreference>
                size="sm"
                aria-label="Motion"
                value={motion}
                onChange={(next) => update({ motion: next })}
                options={[
                  { value: "system", label: "System" },
                  { value: "reduce", label: "Reduce" },
                  { value: "full", label: "Full" },
                ]}
              />
            </Row>
          </Section>

          <Section title="New prototypes">
            <Row name="Default device" description="The screen size new prototypes start with.">
              <Select size="sm" aria-label="Default device" options={DEVICE_OPTIONS} value={defaultDevice} onChange={(id) => update({ defaultDevice: id })} searchable menuWidth={272} />
            </Row>
            <Row name="Welcome screen" description="Show templates and lessons every time Sonobe starts.">
              <Toggle aria-label="Show the welcome screen when Sonobe starts" checked={showWelcomeOnLaunch} onChange={(checked) => update({ showWelcomeOnLaunch: checked })} />
            </Row>
          </Section>

          <Section title="Claude">
            <Row
              name="What Claude can do"
              description={
                agentPermission === "edit"
                  ? "Claude can read, simulate, and change your prototype. Each change is one undo step."
                  : "Claude can look and simulate, but can't change, save, or open prototypes."
              }
            >
              <SegmentedControl<AgentPermission>
                size="sm"
                aria-label="What Claude can do"
                value={agentPermission}
                onChange={(next) => update({ agentPermission: next })}
                options={[
                  { value: "edit", label: "Can edit" },
                  { value: "readOnly", label: "Read only" },
                ]}
              />
            </Row>
            {subscriptionSwitch ? <SubscriptionSwitch /> : null}
            {!desktop && !subscriptionSwitch && <p className="sb-settings__note">Claude connects through the desktop app. This applies there.</p>}
          </Section>

          <Section title="Trusted prototypes">
            <p className="sb-settings__desc">Prototypes you trust to run JavaScript patches. Remove one and Sonobe asks again.</p>
            {trusted.paths.length === 0 ? (
              <p className="sb-settings__state">No trusted prototypes yet.</p>
            ) : (
              <ul className="sb-settings__projects" aria-label="Trusted prototypes">
                {trusted.paths.map((path) => (
                  <li key={path} className="sb-settings__project">
                    <FolderLock size={14} strokeWidth={1.75} aria-hidden />
                    <span className="sb-settings__project-text">
                      <span>{session.host?.displayName(path) ?? path}</span>
                      <Tooltip content={path} placement="top">
                        <span className="sb-settings__project-path sb-selectable">{path}</span>
                      </Tooltip>
                    </span>
                    <IconButton size="sm" icon={<Trash2 size={14} />} label={`Stop trusting ${session.host?.displayName(path) ?? path}`} onClick={() => trusted.revoke(path)} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </Dialog.Footer>
    </>
  );
}
