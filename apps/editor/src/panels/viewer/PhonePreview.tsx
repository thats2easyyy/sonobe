/**
 * "On phone": a QR code and link for the web player on the local network. With the desktop host's
 * preview server it can also start and stop the server, count connected phones, and offer other
 * addresses; with a fixed URL it just shows that URL.
 */

import { Copy, QrCode, Vibrate, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useControllableState } from "../../ui/lib/hooks.ts";
import { getPreviewHostApi, toPreviewStatus, type PreviewHostApi, type PreviewStatus } from "./hostBridge.ts";
import { phoneClientsLabel, qrPath } from "./viewerModel.ts";
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

export interface PhonePreviewController {
  /** "On phone" can be offered at all. */
  available: boolean;
  /** The host runs the preview server, so it can be started and stopped. */
  managed: boolean;
  /** The host's server status (null with a fixed URL, or before the first status arrives). */
  status: PreviewStatus | null;
  /** The best player URL, when there is one. */
  url: string | null;
  /** Every player URL, best first. */
  urls: string[];
  busy: boolean;
  start(): Promise<PreviewStatus | null>;
  stop(): Promise<PreviewStatus | null>;
  /** Adopt a status the host pushed (the viewer.showPhonePreview RPC). */
  adopt(status: PreviewStatus): void;
}

const STOPPED: PreviewStatus = { running: false, url: null, urls: [], lanReachable: true, clients: 0, error: null };

/**
 * Phone preview state. A string or null `staticUrl` is used as is; undefined uses `api`, or the desktop
 * host's preview server when there is one.
 */
export function usePhonePreview(staticUrl?: string | null, api?: PreviewHostApi | null): PhonePreviewController {
  const fixed = staticUrl !== undefined;
  const host = useMemo(() => (fixed ? null : api === undefined ? getPreviewHostApi() : api), [fixed, api]);
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    if (!host) return;
    let cancelled = false;
    host.getPreviewStatus().then(
      (value) => {
        const next = toPreviewStatus(value);
        if (!cancelled && next) setStatus(next);
      },
      () => undefined,
    );
    const off = host.onPreviewStatus?.((value) => {
      const next = toPreviewStatus(value);
      if (!cancelled && next) setStatus(next);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [host]);

  const run = useCallback(
    async (action: "start" | "stop"): Promise<PreviewStatus | null> => {
      if (!host) return null;
      setBusy(true);
      try {
        const next = toPreviewStatus(await (action === "start" ? host.startPreview() : host.stopPreview()));
        if (next) setStatus(next);
        return next;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus((s) => ({ ...(s ?? STOPPED), error: message || "The preview server didn't respond." }));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [host],
  );

  const adopt = useCallback((next: PreviewStatus) => setStatus(next), []);

  return useMemo<PhonePreviewController>(() => {
    if (fixed) {
      const url = staticUrl || null;
      return { available: !!url, managed: false, status: null, url, urls: url ? [url] : [], busy: false, start: async () => null, stop: async () => null, adopt: () => undefined };
    }
    const running = !!status?.running;
    return {
      available: !!host,
      managed: !!host,
      status,
      url: running ? (status?.url ?? null) : null,
      urls: running ? (status?.urls ?? []) : [],
      busy,
      start: () => run("start"),
      stop: () => run("stop"),
      adopt,
    };
  }, [fixed, staticUrl, host, status, busy, run, adopt]);
}

export interface PhonePreviewButtonProps {
  /** A fixed web player URL. Ignored when `preview` is given. */
  url?: string | null;
  /** Phone preview state from usePhonePreview (with start and stop when the host manages the server). */
  preview?: PhonePreviewController;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function PhonePreviewButton({ url: urlProp = null, preview, open: openProp, onOpenChange }: PhonePreviewButtonProps) {
  const [open, setOpen] = useControllableState(openProp, false, onOpenChange);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [qr, setQr] = useState<{ url: string; image: QrImage } | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState(0);

  const managed = preview?.managed ?? false;
  const status = preview?.status ?? null;
  const urls = preview ? preview.urls : urlProp ? [urlProp] : [];
  const url = urls[Math.min(choice, Math.max(0, urls.length - 1))] ?? null;
  const running = managed ? !!status?.running : !!url;
  const clients = status?.clients ?? 0;

  useEffect(() => {
    if (choice >= urls.length && choice !== 0) setChoice(0);
  }, [choice, urls.length]);

  useEffect(() => {
    if (!open || !url || qr?.url === url) return;
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
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", tone: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", description: url, tone: "warn" });
    }
  };

  const image = url && qr?.url === url ? qr.image : null;
  const total = image ? image.size + QUIET_ZONE * 2 : 0;
  const lanReachable = status?.lanReachable !== false;

  return (
    <>
      <button ref={setAnchor} type="button" className="sb-vw__pill sb-vw__phone" data-live={(managed && running) || undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {managed && running ? <span className="sb-vw__dot" aria-hidden /> : <QrCode size={12} strokeWidth={2} aria-hidden />}
        On phone
        {managed && running && clients > 0 && (
          <span className="sb-vw__pill-meta sb-tabular" aria-label={phoneClientsLabel(clients)}>
            {clients}
          </span>
        )}
      </button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="top" role="dialog" aria-label="Preview on your phone" className="sb-phone">
        <div className="sb-phone__title">Preview on your phone</div>
        {url ? (
          <>
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
            {urls.length > 1 && (
              <div className="sb-phone__alts" role="group" aria-label="Other addresses">
                <span>Not loading? Try</span>
                {urls.map((u, i) =>
                  i === Math.min(choice, urls.length - 1) ? null : (
                    <button key={u} type="button" className="sb-phone__alt" onClick={() => setChoice(i)}>
                      {hostOf(u)}
                    </button>
                  ),
                )}
              </div>
            )}
            {managed && (
              <div className="sb-phone__status" data-connected={clients > 0 || undefined}>
                <span className="sb-vw__dot" aria-hidden />
                {phoneClientsLabel(clients)}
              </div>
            )}
            <p className="sb-phone__note" data-tone={lanReachable ? undefined : "warn"}>
              {lanReachable ? <Wifi size={12} aria-hidden /> : <WifiOff size={12} aria-hidden />}
              {lanReachable ? "Scan with your phone's camera. Your phone and this computer need to be on the same Wi-Fi." : "No local network was found, so only this computer can open this link."}
            </p>
            {lanReachable && (
              <p className="sb-phone__note">
                <Vibrate size={12} aria-hidden />
                On iPhone, scan this code in the Sonobe Viewer app to feel haptics.
              </p>
            )}
            {managed && (
              <Button size="sm" variant="ghost" loading={preview?.busy} onClick={() => void preview?.stop()}>
                Stop phone preview
              </Button>
            )}
          </>
        ) : managed ? (
          <>
            <p className="sb-phone__intro">Try this prototype on a real phone. Sonobe starts a small preview server on this computer, then shows a QR code to scan from any phone on the same Wi-Fi.</p>
            {status?.error && (
              <p className="sb-phone__error" role="alert">
                {status.error}
              </p>
            )}
            <Button size="sm" variant="primary" fullWidth loading={preview?.busy} icon={<QrCode size={14} />} onClick={() => void preview?.start()}>
              Start phone preview
            </Button>
          </>
        ) : null}
      </Popover>
    </>
  );
}
