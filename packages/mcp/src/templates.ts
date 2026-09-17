/** Starter documents for create_document and `sonobe new`. Browser-safe. */

import {
  applyOps,
  createEmptyDocument,
  getDevicePreset,
  type Op,
  type Registry,
  type SonobeDocument,
} from "@sonobe/core";
import { HostError } from "./host.ts";

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: "blank", name: "Blank", description: "An empty prototype sized to the device." },
  {
    id: "photo-zoom",
    name: "Photo zoom",
    description:
      "Tap a photo to spring it bigger and back: Interaction → Switch → Pop Animation → Transition.",
  },
];

/** Ops that build a template on top of an empty document of `size`. */
export function templateOps(template: string, size: [number, number]): Op[] {
  switch (template) {
    case "blank":
      return [];
    case "photo-zoom": {
      const [w, h] = size;
      const photo: [number, number] = [Math.min(300, w - 32), Math.min(360, h - 200)];
      const at: [number, number] = [Math.round((w - photo[0]) / 2), Math.round((h - photo[1]) / 2)];
      return [
        { op: "setProject", changes: { background: "#F2F2F7FF" } },
        {
          op: "addLayer",
          layer: {
            id: "photo",
            type: "rectangle",
            name: "Photo",
            props: { position: at, size: photo, cornerRadius: 24, color: "#5E8BFFFF" },
          },
        },
        {
          op: "addLayer",
          layer: {
            id: "caption",
            type: "text",
            name: "Caption",
            props: {
              position: [Math.round(w / 2), at[1] + photo[1] + 40],
              anchor: [0.5, 0],
              text: "Tap the photo to zoom",
              textAlignment: "center",
              textColor: "#3C3C43FF",
              fontSize: 15,
            },
          },
        },
        {
          op: "addPatch",
          patch: {
            id: "tap_photo",
            type: "interaction",
            name: "Tap Photo",
            inputs: { layer: { layer: "photo" } },
            ui: { x: 40, y: 40 },
          },
        },
        {
          op: "addPatch",
          patch: { id: "zoomed", type: "switch", name: "Zoomed", ui: { x: 260, y: 40 } },
        },
        {
          op: "addPatch",
          patch: {
            id: "zoom_spring",
            type: "popAnimation",
            name: "Zoom Spring",
            inputs: { bounciness: 6, speed: 12 },
            ui: { x: 480, y: 40 },
          },
        },
        {
          op: "addPatch",
          patch: {
            id: "zoom_scale",
            type: "transition",
            name: "Zoom Scale",
            typeParam: "number",
            inputs: { start: 1, end: 1.25 },
            ui: { x: 700, y: 40 },
          },
        },
        { op: "connect", from: "tap_photo.tap", to: "zoomed.flip" },
        { op: "connect", from: "zoomed.on", to: "zoom_spring.number" },
        { op: "connect", from: "zoom_spring.output", to: "zoom_scale.progress" },
        { op: "connect", from: "zoom_scale.output", to: "@photo.scale" },
        {
          op: "updateComponent",
          id: "main",
          notes:
            "Tap the photo: the Switch remembers zoomed or not, Pop Animation springs 0↔1, and Transition maps that to a scale of 1↔1.25.",
        },
      ];
    }
    default:
      throw new HostError("unknown_template", `There's no template "${template}".`, {
        hint: `Templates: ${TEMPLATES.map((t) => t.id).join(", ")}.`,
      });
  }
}

export interface TemplateDocumentOptions {
  name: string;
  template?: string;
  device?: string;
  registry: Registry;
}

/** A new document built from a template through applyOps. */
export function createTemplateDocument(options: TemplateDocumentOptions): SonobeDocument {
  const device = options.device ?? undefined;
  if (device !== undefined && getDevicePreset(device).id !== device) {
    throw new HostError("unknown_device", `There's no device preset "${device}".`, {
      hint: "Presets include iphone-17-pro, iphone-se, android-large, ipad-pro-11, desktop and custom.",
    });
  }
  const doc = createEmptyDocument({ name: options.name, ...(device ? { device } : {}) });
  const size = doc.components[doc.project.root]!.size ?? [402, 874];
  const ops = templateOps(options.template ?? "blank", size);
  if (!ops.length) return doc;
  const r = applyOps(doc, ops, { registry: options.registry });
  if (!r.ok)
    throw new HostError(
      "template_failed",
      `The "${options.template}" template couldn't be built: ${r.errors.map((e) => e.message).join(" ")}`,
    );
  return r.doc;
}
