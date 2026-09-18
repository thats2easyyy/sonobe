# Sonobe Capture for Figma

A Figma plugin that copies the selected frame, or any layers, as a design you paste into Sonobe as real layers. It writes the same design capture as File → Import Design… and the Chrome extension, so everything lands through one converter (`@sonobe/import`).

> **Status:** built and tested against a stand-in for Figma's plugin API (`smoke.ts`) and with unit tests for the mapping (`packages/import/src/figma.test.ts`). It hasn't been verified inside Figma yet, and it isn't published to the Figma Community.

## Build and install

From a Sonobe checkout with dependencies installed:

```sh
node integrations/figma-plugin/build.ts
```

In the Figma desktop app, choose **Plugins → Development → Import plugin from manifest…** and pick `integrations/figma-plugin/manifest.json`.

## Use it

1. Select a frame (a screen), or a few layers.
2. Run **Plugins → Development → Sonobe Capture**.
3. In Sonobe, press ⌘V.

## What comes across

| In Figma | In Sonobe |
|---|---|
| Frames, groups, components, instances, sections | Groups with fill, gradients, strokes, corner radii, drop shadows, blur and clipping |
| Rectangles and circles | Rectangles and round groups; image fills become Image layers |
| Text | Text layers with family, size, weight, line height, letter spacing, alignment, case and decoration |
| Vectors, boolean groups, stars, polygons, lines, ellipses | Image layers holding their SVG export |
| Layer names you chose | Layer names (and ids that follow them); default names like "Frame 12" are treated as generic |

Auto layout comes across as the positions it produced. Masks, text with several styles in one layer (it uses the first style), and slices aren't imported; the capture's notes say what was left out. Fonts aren't embedded: text uses the family name, which renders when the font is installed on your computer.

## Test

```sh
node integrations/figma-plugin/build.ts && node integrations/figma-plugin/smoke.ts
```
