import { Bug } from "lucide-react";
import { getDesktopHostApi } from "../host/detect.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog, DIALOG_WIDTH } from "../ui/Dialog.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
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
  const api = getDesktopHostApi();
  const version = api?.version ?? EDITOR_VERSION;
  const where = api ? `Desktop app for ${PLATFORM_NAMES[detectHostPlatform()] ?? detectHostPlatform()}` : "In your browser";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={DIALOG_WIDTH.sm} className="sb-about" modalScope="about">
      <Dialog.Header title={APP_NAME} description={<span className="sb-selectable">{`Version ${version} · ${where}`}</span>} onClose={() => onOpenChange(false)} />
      <Dialog.Body>
        <div className="sb-about__content" tabIndex={-1} data-autofocus>
          <p className="sb-about__text">Sonobe is an open-source app for interaction prototyping: layers, patches, and a live viewer, built from the start to work with Claude on your own plan.</p>
          <section aria-labelledby="sb-about-credits">
            <h3 className="sb-settings__section-title" id="sb-about-credits">
              Built with open source
            </h3>
            <ul className="sb-about__credits">
              {CREDITS.map((credit) => (
                <li key={credit.name} className="sb-about__credit">
                  <Tooltip content={credit.role} placement="top">
                    <a className="sb-about__credit-name" href={credit.url} target="_blank" rel="noreferrer">
                      {credit.name}
                    </a>
                  </Tooltip>
                  <span className="sb-about__license">{credit.license}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className="sb-about__legal">Sonobe is MIT licensed. © 2026 Sonobe contributors. Sonobe isn't affiliated with Meta or Origami Studio.</p>
        </div>
      </Dialog.Body>
      <Dialog.Footer
        start={
          <Button variant="ghost" icon={<Bug size={14} />} onClick={onReportIssue}>
            Report an Issue…
          </Button>
        }
      >
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
