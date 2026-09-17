/** Window capture for MCP screenshots: crop with capturePage, flatten to device pixels, and resize. */

import { BrowserWindow, nativeImage, type WebContents } from "electron";
import type { CapturedImage } from "./app-host.ts";
import { toCaptureRect, type Rect, type Size } from "./screenshot.ts";

/**
 * Capture a viewport CSS-pixel rect of a page as a PNG of exactly `size`, so image pixels map to
 * prototype points. The capture holds device pixels (2× on Retina) and is resampled to `size`.
 */
export async function captureWebContents(wc: WebContents, rect: Rect, size: Size): Promise<CapturedImage | null> {
  if (wc.isDestroyed()) return null;
  const win = BrowserWindow.fromWebContents(wc);
  if (win?.isMinimized()) return null;
  const [pageWidth, pageHeight] = win?.getContentSize() ?? [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const region = toCaptureRect(rect, wc.getZoomFactor(), { width: pageWidth!, height: pageHeight! });
  if (!region) return null;
  const image = await wc.capturePage(region, { stayHidden: true });
  if (image.isEmpty()) return null;
  const factor = Math.max(1, ...image.getScaleFactors());
  const natural = image.getSize(factor);
  const flat = factor === 1 ? image : nativeImage.createFromBitmap(image.toBitmap({ scaleFactor: factor }), { width: natural.width, height: natural.height, scaleFactor: 1 });
  const out = size.width === natural.width && size.height === natural.height ? flat : flat.resize({ width: size.width, height: size.height, quality: "best" });
  const { width, height } = out.getSize();
  return { data: out.toPNG().toString("base64"), width, height };
}
