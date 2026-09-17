/** "On phone": a QR code and link for the host's LAN web player. */

import { Copy, QrCode, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useControllableState } from "../../ui/lib/hooks.ts";
import { qrPath } from "./viewerModel.ts";
import "./viewer.css";

interface QrImage {
  size: number;
  path: string;
}

const QUIET_ZONE = 3;

async function encodeQr(url: string): Promise<QrImage> {
  const mod = await import("qrcode");
  const create = mod.create ?? (mod as unknown as { default?: { create?: typeof mod.create } }).default?.create;
  if (!create) throw new Error("QR encoder unavailable");
  const { modules } = create(url, { errorCorrectionLevel: "M" });
  const size = modules.size;
  return { size, path: qrPath(size, (row, col) => modules.data[row * size + col] === 1, QUIET_ZONE) };
}

export interface PhonePreviewButtonProps {
  /** The web player URL on the local network. */
  url: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PhonePreviewButton({ url, open: openProp, onOpenChange }: PhonePreviewButtonProps) {
  const [open, setOpen] = useControllableState(openProp, false, onOpenChange);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [qr, setQr] = useState<{ url: string; image: QrImage } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || qr?.url === url) return;
    let cancelled = false;
    setFailed(false);
    encodeQr(url).then(
      (image) => {
        if (!cancelled) setQr({ url, image });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, url, qr]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", description: url, tone: "warn" });
    }
  };

  const image = qr?.url === url ? qr.image : null;
  const total = image ? image.size + QUIET_ZONE * 2 : 0;

  return (
    <>
      <button ref={setAnchor} type="button" className="sb-vw__pill sb-vw__phone" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <QrCode size={12} strokeWidth={2} aria-hidden /> On phone
      </button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="top" role="dialog" aria-label="Preview on your phone" className="sb-phone">
        <div className="sb-phone__title">Preview on your phone</div>
        <div className="sb-phone__qr" data-state={image ? "ready" : failed ? "failed" : "loading"}>
          {image ? (
            <svg viewBox={`0 0 ${total} ${total}`} role="img" aria-label={`QR code for ${url}`} shapeRendering="crispEdges">
              <rect width={total} height={total} fill="#fff" />
              <path d={image.path} fill="#000" />
            </svg>
          ) : failed ? (
            <span>The QR code isn't available. Open the link on your phone instead.</span>
          ) : (
            <span className="sb-phone__spinner" aria-label="Making QR code" />
          )}
        </div>
        <div className="sb-phone__url">
          <code>{url}</code>
          <IconButton size="xs" icon={<Copy size={12} />} label="Copy link" onClick={() => void copy()} />
        </div>
        <p className="sb-phone__note">
          <Wifi size={12} aria-hidden />
          Scan with your phone's camera. Your phone and this computer need to be on the same Wi-Fi.
        </p>
      </Popover>
    </>
  );
}
