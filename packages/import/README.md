# @sonobe/import

Bring real designs into Sonobe as layers people can prototype with. Every source produces a **design capture** (`capture.ts`), and one converter turns captures into ops.

| Source | Where it runs | Writes a capture with |
|---|---|---|
| A URL or HTML | The desktop app's hidden window, the browser editor's sandboxed iframe, Playwright in headless servers | The DOM walker (`dom/walk.ts`, injected as `WALKER_SOURCE`) |
| Any page in Chrome | `integrations/chrome-extension` | The same walker |
| A Figma selection | `integrations/figma-plugin` | `figmaToCapture` (`figma.ts`) |

```ts
import { planImport, resolveCaptureFiles } from "@sonobe/import";

const images = await resolveCaptureFiles(capture, { fetch: globalFetcher() }); // images and web fonts
const plan = await planImport(capture, doc, images, { name: "Profile" });       // or { replace: "profile" }
host.putAssetFiles(plan.files);                                                 // new image and font files
host.apply(plan.ops, { label: `imported ${plan.screenName}` });                 // one undo step
```

Hosts that render pages run each capture under one deadline with `createCaptureRun` (`run.ts`): 90 s plus `waitMs`, with a budget per step, an error that names the stage it stopped in, and a caller's signal that cancels it. `resolveCaptureFiles` takes that `signal`, an `until` cutoff (files still downloading then become placeholders) and an `onFile` progress callback. `capturePage` from `@sonobe/import/node` does all of this with Playwright.

Both page hosts read the page with `walkPage` (`symbols.ts`), which also turns SF Symbol placeholders (`<svg data-sf-symbol="heart.fill">`, styled by CSS `font-size`, `font-weight` and `color`) into the real symbols before the walker runs. The host passes a `SymbolRenderer`: `symbolHelper(path)` from `@sonobe/import/node` runs the sfsymbol helper the desktop app builds on macOS (`apps/desktop/native/sfsymbol`), and `unavailableSymbols(reason)` leaves gray placeholders with a note giving the reason.

`planImport` maps frames to groups (rectangles when empty), borders to strokes or thin rectangles, gradients and background images to child layers, text to text layers (single lines hug, paragraphs keep their width, mixed styles split into per-line runs), images and SVG icons to image assets, inputs to text fields, web fonts to font assets, and scrolling pages and scroll containers to Scroll patches. `replace` swaps an earlier screen while keeping the ids and wiring of layers found again.

## Scripts

```sh
node packages/import/scripts/build-walker.ts            # rebundle the walker and SF Symbol scripts after changing src/dom (a test checks them)
node packages/import/scripts/fidelity.ts                # fixtures → source | imported | difference images in fidelity-out/
node packages/import/scripts/fidelity.ts http://localhost:3000/   # the same for a running app
```

The fidelity script needs Playwright's Chromium (`npx playwright install chromium`).
