import { DEVICE_PRESETS, type DevicePreset } from "@sonobe/core";
import { FolderLock, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useAssistant } from "../panels/assistant/assistantStore.ts";
import { sharedAssistantController } from "../panels/assistant/controller.ts";
import { getAssistantHost, supportsAssistant } from "../panels/assistant/types.ts";
import { useEditorSession } from "../state/EditorProvider.tsx";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../ui/Select.tsx";
import { toast } from "../ui/Toast.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { trustServiceFor } from "./sessionServices.ts";
import { settingsStore, useSettings, type AgentPermission, type MotionPreference } from "./settings.ts";
import "./dialogs.css";

const KIND_LABELS: Record<DevicePreset["kind"], string> = { phone: "Phones", tablet: "Tablets", computer: "Desktop", watch: "Watch", custom: "Custom" };

const DEVICE_OPTIONS: SelectOption[] = DEVICE_PRESETS.map((d) => ({ value: d.id, label: d.name, group: KIND_LABELS[d.kind], trailing: `${d.size[0]}×${d.size[1]}`, keywords: [d.platform, d.kind] }));

/** `descriptionId`: the description's id, for the control's aria-describedby. */
function Row({ name, description, descriptionId, children, stack = false }: { name: string; description?: ReactNode; descriptionId?: string; children: ReactNode; stack?: boolean }) {
  const id = useId();
  return (
    <div className="sb-settings__row" data-stack={stack || undefined} role="group" aria-labelledby={id}>
      <div className="sb-settings__label">
        <span className="sb-settings__name" id={id}>
          {name}
        </span>
        {description && (
          <span className="sb-settings__desc" id={descriptionId}>
            {description}
          </span>
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

/** Projects allowed to run JavaScript patches: the session's trust service when it has one, else Settings' own list. */
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
export const SUBSCRIPTION_SWITCH_DESCRIPTION =
  "Experimental · awaiting Anthropic's permission. Off by default and not part of any release until Anthropic agrees. When it's on, the Assistant can run Claude through Claude's agent adapter with the Claude account you're signed in to on this computer, using your plan's usage limits.";

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
    <Row name={SUBSCRIPTION_SWITCH_LABEL} description={SUBSCRIPTION_SWITCH_DESCRIPTION} descriptionId={descriptionId}>
      <Toggle aria-label={SUBSCRIPTION_SWITCH_LABEL} aria-describedby={descriptionId} checked={connection.subscriptionEnabled} disabled={saving} onChange={(checked) => void change(checked)} />
    </Row>
  );
}

/** Settings: theme, motion, the default device, the welcome screen, what Claude may do (and the experimental subscription switch), and trusted projects. */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const titleId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-labelledby={titleId} width={580} className="sb-settings" modalScope="settings" style={{ maxHeight: "min(760px, calc(100vh - 48px))" }}>
      <SettingsContent titleId={titleId} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function SettingsContent({ titleId, onClose }: { titleId: string; onClose: () => void }) {
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
      <header className="sb-settings__header">
        <h2 className="sb-settings__title" id={titleId}>
          Settings
        </h2>
        <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
      </header>
      <div className="sb-settings__body sb-scroll">
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
          <Row name="Motion" description="Reduce turns off interface animation, like sliding panels and the orbs that travel along cables. Your prototypes still animate.">
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
          <Row name="Default device" description="The screen size New Blank starts with. You can change a prototype's device anytime.">
            <Select aria-label="Default device" options={DEVICE_OPTIONS} value={defaultDevice} onChange={(id) => update({ defaultDevice: id })} searchable menuWidth={272} />
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
                ? "Claude can read, simulate, and change your prototype. Every change is one undo step, labeled with Claude's name."
                : "Claude can read the outline, run simulations, and take screenshots, but can't change, save, or open prototypes."
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
          {!desktop && !subscriptionSwitch && <p className="sb-settings__desc">Claude connects to open prototypes through the desktop app. This setting applies there.</p>}
        </Section>

        <Section title="Trusted projects">
          <p className="sb-settings__desc">Sonobe asks before running a project's JavaScript patches. Projects you trusted are listed here; remove one and Sonobe asks again next time.</p>
          {trusted.paths.length === 0 ? (
            <p className="sb-settings__empty">No trusted projects yet.</p>
          ) : (
            <ul className="sb-settings__projects" aria-label="Trusted projects">
              {trusted.paths.map((path) => (
                <li key={path} className="sb-settings__project">
                  <FolderLock size={14} strokeWidth={1.75} aria-hidden />
                  <span className="sb-settings__project-text">
                    <span>{session.host?.displayName(path) ?? path}</span>
                    <span className="sb-settings__project-path sb-selectable" title={path}>
                      {path}
                    </span>
                  </span>
                  <IconButton size="sm" icon={<Trash2 size={13} />} label={`Stop trusting ${session.host?.displayName(path) ?? path}`} onClick={() => trusted.revoke(path)} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <footer className="sb-settings__footer">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
    </>
  );
}
