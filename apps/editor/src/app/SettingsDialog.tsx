import { DEVICE_PRESETS, type DevicePreset } from "@sonobe/core";
import { FolderLock, Trash2, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useEditorSession } from "../state/EditorProvider.tsx";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../ui/Select.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { trustServiceFor } from "./sessionServices.ts";
import { settingsStore, useSettings, type AgentPermission, type MotionPreference } from "./settings.ts";
import "./dialogs.css";

const KIND_LABELS: Record<DevicePreset["kind"], string> = { phone: "Phones", tablet: "Tablets", computer: "Desktop", watch: "Watch", custom: "Custom" };

const DEVICE_OPTIONS: SelectOption[] = DEVICE_PRESETS.map((d) => ({ value: d.id, label: d.name, group: KIND_LABELS[d.kind], trailing: `${d.size[0]}×${d.size[1]}`, keywords: [d.platform, d.kind] }));

function Row({ name, description, children, stack = false }: { name: string; description?: ReactNode; children: ReactNode; stack?: boolean }) {
  const id = useId();
  return (
    <div className="sb-settings__row" data-stack={stack || undefined} role="group" aria-labelledby={id}>
      <div className="sb-settings__label">
        <span className="sb-settings__name" id={id}>
          {name}
        </span>
        {description && <span className="sb-settings__desc">{description}</span>}
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

/** Settings: theme, motion, the default device, the welcome screen, what Claude may do, and trusted projects. */
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
          <Row name="Motion" description="Reduce turns off interface animation, like cable sparks and sliding panels. Your prototypes still animate.">
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
          {!desktop && <p className="sb-settings__desc">Claude connects to open prototypes through the desktop app. This setting applies there.</p>}
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
