import { Bug, X } from "lucide-react";
import { useId } from "react";
import { getDesktopHostApi } from "../host/detect.ts";
import { SonobeMark } from "../shell/icons.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { detectHostPlatform } from "../ui/commands/shortcutManager.ts";
import { APP_NAME, CREDITS, EDITOR_VERSION } from "./about.ts";
import "./dialogs.css";

const PLATFORM_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReportIssue: () => void;
}

/** About Sonobe: version, what it's for, the open-source software it's built with, and Report an Issue. */
export function AboutDialog({ open, onOpenChange, onReportIssue }: AboutDialogProps) {
  const titleId = useId();
  const api = getDesktopHostApi();
  const version = api?.version ?? EDITOR_VERSION;
  const where = api ? `Desktop app for ${PLATFORM_NAMES[detectHostPlatform()] ?? detectHostPlatform()}` : "In your browser";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-labelledby={titleId} width={500} className="sb-about" modalScope="about" style={{ maxHeight: "min(720px, calc(100vh - 48px))" }}>
      <header className="sb-about__header">
        <span className="sb-about__mark" aria-hidden>
          <SonobeMark size={28} />
        </span>
        <div className="sb-about__heading">
          <h2 className="sb-about__name" id={titleId}>
            {APP_NAME}
          </h2>
          <span className="sb-about__version sb-selectable">
            Version {version} · {where}
          </span>
        </div>
        <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={() => onOpenChange(false)} />
      </header>
      <div className="sb-about__body sb-scroll">
        <p className="sb-about__text">Sonobe is an open-source app for interaction prototyping: layers, patches, and a live viewer, built from the start to work with Claude on your own plan.</p>
        <section aria-labelledby={`${titleId}-credits`}>
          <h3 className="sb-settings__section-title" id={`${titleId}-credits`}>
            Built with open source
          </h3>
          <ul className="sb-about__credits">
            {CREDITS.map((credit) => (
              <li key={credit.name} className="sb-about__credit">
                <span className="sb-about__credit-text">
                  <a className="sb-about__credit-name" href={credit.url} target="_blank" rel="noreferrer">
                    {credit.name}
                  </a>
                  <span className="sb-about__credit-role">{credit.role}</span>
                </span>
                <span className="sb-about__license">{credit.license}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="sb-about__legal">Sonobe is MIT licensed. © 2026 Sonobe contributors. Sonobe isn't affiliated with Meta or Origami Studio.</p>
      </div>
      <footer className="sb-about__footer">
        <Button variant="ghost" icon={<Bug size={13} />} onClick={onReportIssue}>
          Report an Issue…
        </Button>
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </footer>
    </Dialog>
  );
}
