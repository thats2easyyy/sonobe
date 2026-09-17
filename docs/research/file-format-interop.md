# Origami Studio File Format & Interoperability — Research Report

*Research date: 2026-09-16. Latest Origami Studio release seen: **Version 228, 09/07/2026** ([release notes](https://origami.design/releases/)).*

**Tags used below**
- **VERIFIED**: seen in a primary source or confirmed by looking at the file bytes myself.
- **VERIFIED (secondary)**: from a reputable secondary source.
- **INFERRED**: my reasoning, not stated anywhere.
- **UNKNOWN**: I looked and couldn't find it.

Origami's documentation is often out of date. The [release notes](https://origami.design/releases/) are treated as the source of truth, and conflicts between docs and release notes are flagged with **DOC-DRIFT**.

---

## 0. Executive summary (decision-relevant)

1. **An `.origami` file is an uncompressed ZIP.** Inside is one folder, `<DocumentName>.diamond/`. It holds a `graph` file and a `resources/` folder of images. **VERIFIED** by downloading 5 official example/tutorial files from origami.design and checking them with `file`, `xxd` and `unzip -l`. "diamond" looks like an internal codename (INFERRED).
2. **The `graph` payload has changed format over time.**
   - A **2016** file stores `graph` as **YAML text** (`_compatibilityVersion: 111`, `_version: 112`), and Ruby's YAML parser reads it. **VERIFIED.**
   - Files **re-saved by Meta on 2025-09-30** (Origami build `203.0 (799429869)`, which matches release v203 dated 9/29/2025) store `graph` as a **binary blob that follows the FlatBuffers layout**, with the 4-byte file identifier **`ORGM`**. The root offset and vtable check out; see §1.4. **VERIFIED** (the byte layout); calling it FlatBuffers is **INFERRED with high confidence**.
   - Release v204 (10/13/2025) names the "latest current internal file version (**129**)". **VERIFIED.**
3. **There is a compatibility cliff.**
   - v204 (10/13/2025) is the "Last version that should be able to open files from before Oct 2023."
   - v205 (10/27/2025) "will no longer be able to open files that were created around 2yrs ago."
   - **VERIFIED.** So even Meta's own 2016 tutorial file, which the site still serves, probably needs an intermediate app version to upgrade it (INFERRED).
4. **Meta has now added official JSON paths.** v221 (06/08/2026) added **"Copy-Paste As JSON."** and a **"CLI to convert Origami file to JSON."** **VERIFIED.** The CLI's name, flags and JSON schema are **not documented anywhere I could find (UNKNOWN)**.
5. **No community parser for Origami Studio files exists.** A GitHub code search for `extension:origami` returns 85 hits, and all belong to unrelated "origami" projects (a programming language, CMS configs, poker data). **VERIFIED (negative result).**
6. **Figma import = the "Origami Pasteboard" Figma plugin plus paste.** It copies custom shapes, frames, text, images and masks, and keeps **only the first fill, stroke and shadow**. **Sketch import = plain ⌘C in Sketch, ⌘V in Origami.** There's no live link to Figma (INFERRED; nothing in the release notes). **VERIFIED.**
7. **Export options.**
   - Video capture: "Capture, trim and export video", with codec and quality options since v159.
   - Sharing `.origami` files to the Origami Live apps on iOS and Android, via USB mirroring, the toolbar Share button, AirDrop or email.
   - A QuickLook plugin (v224) and the new JSON CLI and copy-paste.
   - **Code export existed only in Origami 2.0 for Quartz Composer (2015)**. I found no evidence of it in Origami Studio (INFERRED from its absence in release notes and docs).
8. **Recommended document format for our app:**
   - **Canonical, deterministic JSON** in a **folder package**, with one JSON file per component, content-addressed assets, and JS/shader sources as separate files.
   - Published **JSON Schema plus TypeScript types**.
   - **Prefixed string IDs**; ports addressed by **stable semantic keys**; connections stored **on the input they drive** (so two drivers into one input can't be represented).
   - A monotonic `formatVersion` with a permanent migration chain.
   - A shared clipboard/fragment format.
   - MCP tools that apply **batched operations**, plus a read-only compact text outline for LLM context.
   - A zipped single-file variant only for sharing.
9. **Importing `.origami` files (stretch goal).**
   - Technically feasible for the ZIP container and legacy YAML files.
   - **Fragile and legally riskier** for the current binary graph: it has no published schema, so we'd have to reverse-engineer it.
   - **Recommended path:** have users run **Meta's own CLI / Copy-Paste-As-JSON** and import that JSON, mapping `builtin.*` patch identifiers to our nodes. Don't decode `ORGM` binaries unless counsel approves and the EULA (not located) allows it.
10. **Figma → layers, recommended approach:**
    - **Primary:** our own Figma plugin that serializes the selection (Plugin API, `exportAsync` with `JSON_REST_V1`, `SVG_STRING` and PNG) into our clipboard JSON. This mirrors Origami Pasteboard but supports multiple fills, strokes and effects, plus auto layout.
    - **Secondary:** "link and refresh" through the REST API (`GET /v1/files/:key/nodes`, `GET /v1/images/:key`), respecting Tier-1 rate limits.
    - **Agent path:** Claude via the Figma MCP server.
    - **Fallback:** SVG paste.

---

## 1. What an `.origami` file is

### 1.1 Lineage: Quartz Composer → Origami Classic → Origami Studio

| Era | Product | File type | Notes | Status |
|---|---|---|---|---|
| ~2013–2016 | **Origami for Quartz Composer** ("Origami Classic"), a set of Quartz Composer patches | `.qtz` compositions | The repo README describes "A Quartz Composer framework that enables interactive design prototyping without programming." Install by linking into `~/Library/Graphics/Quartz Composer Patches`. Repo archived **Jan 13, 2022**. [github.com/facebookarchive/origami](https://github.com/facebookarchive/origami) | VERIFIED |
| | License of Classic | — | Custom "LICENSE AGREEMENT For Origami framework". Grants a "non-exclusive, worldwide, royalty-free copyright license to (1) use and copy … (2) reproduce and distribute … as part of your own framework". "Copyright (c) 2013-2014, Facebook, Inc." Not an OSI license. | VERIFIED (read LICENSE.md via GitHub API) |
| Feb 24, 2015 | **Origami 2.0 + Origami Live** | `.qtz` | Origami 2.0 "Code Export … generating files for iOS, Android, and the web with code for the animations". Animations run on Pop (iOS), Rebound (Android) and Rebound JS (web). [engineering.fb.com/2015/02/24/ios/introducing-origami-live/](https://engineering.fb.com/2015/02/24/ios/introducing-origami-live/), [Medium: Introducing Origami Live and Origami 2.0](https://medium.com/facebook-design/introducing-origami-live-and-origami-2-0-a68116294e65) (403 for me; details from search snippet) | VERIFIED (secondary) |
| 2016 | **Origami Studio**, a native Mac app with no Quartz Composer dependency | `.origami` | The oldest sample I found has ZIP entries dated **10-26-2016**. | VERIFIED (file) |
| Sept 2020 | **Origami Studio 3** (Canvas, vector drawing, dynamic layout, import from Figma and Sketch) | `.origami` | [tech.facebook.com 2020/9](https://tech.facebook.com/engineering/2020/9/origami-studio-3-makes-app-design-easier-than-ever/). The release-notes page starts at **Version 72, 09/24/2020**. | VERIFIED |
| 2025–2026 | Studio v200+ (binary graph, JSON CLI, LLM integrations) | `.origami` | See §1.4–1.6 | VERIFIED |

**Date conflict:** Meta's 2020 article says "Origami was first released in 2015 as a set of plugins built on top of Quartz Composer". The Classic LICENSE says "Copyright (c) 2013-2014". The first Classic release was likely 2013–2014 and 2015 was 2.0 (INFERRED).

**Quartz Composer `.qtz` heritage.** QC compositions are property lists, usually binary (`bplist00`), and can also be XML. Typical keys include `frameworkVersion`, `portAttributes` and `editorViewerWindow_`. Patches, their connections, input port states and embedded images are all serialized inside. VERIFIED (secondary): [Echo One File Juicer: QTZ](https://echoone.com/filejuicer/formats/qtz), [Wikipedia: Quartz Composer](https://en.wikipedia.org/wiki/Quartz_Composer).

**Is `.origami` a QC plist?** **No.** The sample files are ZIPs holding YAML or FlatBuffers-style payloads, not plists. VERIFIED. The conceptual carry-over is clear, though:
- Patches with typed ports.
- A root patch containing subpatches.
- Built-in patch identifiers such as `builtin.bouncy`, the Pop Animation patch named after QC-era Pop "bouncy" springs.

The mapping from identifier to patch name is VERIFIED via documentation URLs such as [builtin.bouncy.html = "Pop Animation"](https://origami.design/documentation/patches/builtin.bouncy.html) and [builtin.structure.format.html = "JSON to Text"](https://origami.design/documentation/patches/builtin.structure.format.html). The QC heritage of those names is INFERRED.

### 1.2 Container format (VERIFIED from 5 official sample files)

Samples downloaded from origami.design into scratch space and inspected only for structure:

| Sample | Size | ZIP entry dates | `graph` payload |
|---|---|---|---|
| `/public/origami_files/tutorials/Getting_Started/Getting-Started-(Completed).origami` | 1,227,448 B | 10-26-2016 | YAML text, 2,710 lines, `_compatibilityVersion: 111`, `_version: 112` |
| `/public/origami_files/examples/Facebook-Popular-Events.origami` | 3,737,949 B | 09-30-2025 | Binary, `ORGM` identifier, contains build string `203.0 (799429869)` |
| `/public/origami_files/tutorials/Audio_Metering/Audio_Metering_(Final).zip`, 3 `.origami` files inside | 1.6–4.7 MB | 09-30-2025 | Binary, `ORGM` identifier |

What the container looks like:
- `file` reports: `Zip archive data, at least v1.0 to extract, compression method=store`. Entries are **stored, not deflated**. INFERRED reason: the PNG assets are already compressed, and it allows fast random access or memory-mapping.
- Layout:
  ```
  <DocumentName>.origami   (ZIP, stored)
  └── <DocumentName>.diamond/
      ├── graph                      # document payload (YAML text in 2016; binary "ORGM" in 2025)
      └── resources/
          ├── <resource-id>.png      # 2025: named by numeric resource ID
          └── Image 28.png           # 2016: named by human-readable resource name
  ```
- The top-level folder is named after the document, so renaming the `.origami` file doesn't rename the internal folder. The parser must glob `*.diamond/graph`. INFERRED.
- One 2025 archive listed the same resource entry (`19136306958132154.png`) **twice**, so duplicate ZIP entries can occur. VERIFIED. That's odd given v101 "Origami now automatically removes duplicate resources to reduce file size." A robust reader must tolerate duplicates. INFERRED.
- Related release notes, all VERIFIED:
  - v101 (11/01/2021) removes duplicate resources.
  - v185 (1/21/2025) "Reduced file size by improved saving of component dependencies." Components' dependencies are stored inside the document (INFERRED).
  - v226 (08/19/2026) "Ability to Embed fonts into a prototype." Fonts can now live inside the file (INFERRED location: `resources/`).
  - v224 (07/20/2026) "QuickLook Generation Plugin. Supports video previews." Finder previews of `.origami` files.

### 1.3 Legacy text graph (2016, `_version: 112`), structural facts only

The 2016 `graph` is YAML: Ruby's Psych parser loads it. VERIFIED.
- **Top-level keys:** `_compatibilityVersion`, `_version`, `layer_hierarchy`, `resources`, `root`.
- **Two version numbers:** a writer version plus a minimum-compatibility version. That's a good pattern to copy.

**`layer_hierarchy`** is a tree of `{patch_id, sublayers[], maskedLayers[]}`.
- **Layers are patches.** Each layer is identified by the ID of a layer patch. The hierarchy just orders and nests those IDs, and masks are expressed as `maskedLayers` under the mask's entry.
- The same hierarchy appears again inside `root.patch`, so the data is duplicated and denormalized.

**`resources[]`** entries have `format` (`png`), `id` (64-bit integer), `name` (`Image 30.png`), `scale` (1), `size` ([48, 48]) and `type` (`image`).

**`root.patch`** has `builtin`, `editorData` (for example `expandedLayerGroups`), `id`, `layer_hierarchy`, `name` and `subpatches`.

**Patch records**
- Keys seen: `id`, `name`, `prototype`, `builtin`, `category`, `position`, `inports`, `outports`, `editorData`, `hidden`, `layerID`.
- `prototype` identifiers in that file: `builtin.layer.fill`, `builtin.layer.layer`, `builtin.layer.binding`, `builtin.layer.text`, `builtin.layer.image`, `builtin.layer.interaction`, `builtin.layer.gradient`, `builtin.transition`, `builtin.switch`, `builtin.bouncy`.

**Port records** (`port:`) carry:
- `id`: a 64-bit random integer.
- `name`: display name such as `Enable` or `Opacity`.
- `tag`: an integer, likely a stable semantic slot number (INFERRED).
- `typeInfo`: `{type, subtype}`, with types seen including `boolean`, `float` and `vec2`.
- `defaultValue`: `{type, value}`.
- Optional `min`, `max`, `enumOptions`, `hiddenValue` and `passthroughForPortTag`.

**Connections** are stored **on output ports** as `outgoing_connections: [{fromPatch, fromPort, toPatch, toPort}]`, all 64-bit integer IDs (11 connections in the sample).

**YAML explicit tags** (`!!int`, `!!float`, `!!str`, `!!id`) appear 76 times. Origami had to force types because YAML's implicit typing is ambiguous. This is evidence against YAML as a canonical format; see §5.

**IDs** are random unsigned 64-bit integers, for example `14865085813540686562`. They're unreadable to humans and LLMs, and exceed JavaScript's safe-integer range.

**Lessons for us (INFERRED)**
- Editor-only state (`expandedLayerGroups`) was mixed into the document, which makes diffs noisy.
- The layer tree was stored twice.
- IDs were opaque integers too big for JS numbers.
- Connections lived far from the input they drive.

### 1.4 Current binary graph (2025+), structural facts only

First bytes of the `graph` from `Facebook-Popular-Events.origami`:
```
00000000: 3000 0000 4f52 474d 0000 0000 2400 3400  0...ORGM....$.4.
```
My parse, all VERIFIED:
- `uint32` at offset 0 = **48** (root table offset).
- Bytes 4–7 = **`ORGM`**. This is exactly where FlatBuffers puts its optional 4-byte `file_identifier`.
- Reading `int32` at offset 48 gives a vtable at offset 12 with `vtable_size=36`, `object_size=52` and 16 fields, with sane field offsets. That's a well-formed FlatBuffers root table.
- A second file (`2. Messenger Audio Metering (Final).origami`) starts `2c00 0000 4f52 474d`: root offset 44, same identifier.
- **Conclusion:** the current graph is FlatBuffers with file identifier `ORGM` (INFERRED, high confidence). The `.fbs` schema is **not published** (UNKNOWN / not found).

Strings in the binary, gathered for identifier naming conventions only:
- **UUID strings**, e.g. `f4ba4d38-…`, `0147739F-…`. Newer files use UUIDs, in both lower and upper case, alongside or instead of 64-bit integer IDs. VERIFIED presence; their role is INFERRED.
- **App build string:** `203.0 (799429869)`, matching release **v203, 9/29/2025**. The ZIP entries are dated 09-30-2025. VERIFIED.
- **Patch/component identifier namespaces:**
  - `builtin.*`, e.g. `builtin.layer.binding`, `builtin.splitter`, `builtin.wirelessReceiver`, `builtin.wirelessBroadcaster`, `builtin.group.input`, `builtin.group.output`, `builtin.multiplexer`, `builtin.comment`, `builtin.transition`, `builtin.point`, `builtin.layer.roundRect`, `builtin.layer.rectangle`.
  - `origami.*` (built-in components), e.g. `origami.ProgressRing`, `origami.LongPress`.
  - `material.*` (platform components), e.g. `material.SoftNav`, `material.statusBar`, `material.Screen`.
  - VERIFIED.
- Port display names such as `Screen Width` and `Screen Height`. VERIFIED.

**What this tells us (INFERRED)**
- Meta moved from human-readable YAML to a binary serialization, probably for load speed and file size. Loading got faster in some releases (e.g. the homepage claims a "4.5x faster patch editor").
- Then, in v221 (June 2026), Meta added **JSON conversion and JSON copy-paste**, which lines up with that release's "JavaScript Patch LLM generation Integration." Text representations matter again for AI workflows. That's the gap our product targets.

### 1.5 Internal versioning and the compatibility cliff (VERIFIED, [releases](https://origami.design/releases/))

- **v204 | 10/13/2025:** "Last version that should be able to open files from before Oct 2023. This can still upgrade those file formats to the latest current internal file version (129)."
- **v205 | 10/27/2025:** "This version will no longer be able to open files that were created around 2yrs ago. Users can open and upgrade the file format on any version before this (v204)."
- Our 2016 sample reports `_version: 112`, and v204 names internal version **129**. So internal versions moved from about 112 to 129 over 2016–2025. The date of the YAML→binary switch is UNKNOWN; no release note mentions it.
- **Implication for us:** Origami dropped its old migration code. We should commit to a *permanent* migration chain, backed by a regression fixture corpus. See §5.9.

### 1.6 Official JSON features (v221, 06/08/2026)

- "Copy-Paste As JSON." VERIFIED
- "CLI to convert Origami file to JSON." VERIFIED
- Same release: "JavaScript Patch LLM generation Integration.", "New Layer Effects.", "Liquid Glass Support." VERIFIED
- v223 (07/07/2026): "Shader Layer LLM generation Integration."
- v227 (08/31/2026): "Increased token limit for JS Patch and Layer Shader when using Anthropic provider." So Origami now calls LLM providers, including Anthropic, directly for code generation. VERIFIED
- **UNKNOWN:** the CLI binary name, where it lives in the app bundle, its flags, whether it converts back (JSON→`.origami`), and the JSON schema. I didn't install the app, per the research rules. **Next step:** someone with Origami installed runs the CLI on their own document and records the output shape. §6 explains why that's the cleanest import route.

### 1.7 Other Origami JSON surfaces (for completeness)

- **Data patches:** JSON Object, JSON Array, JSON to Text (`builtin.structure.format`, renamed from "Text from JSON" in v207), Text to JSON (v207), JSON to Shape, and Settings JSON. VERIFIED ([patch docs](https://origami.design/documentation/patches/builtin.structure.object.html)).
- **JS Patch API types:** `NUMBER`, `PROGRESS`, `POSITION`, `SIZE`, `ANCHOR`, `POINT3D`, `POINT4D`, `COLOR`, `BOOLEAN`, `PULSE`, `INTEGER`, `ENUM`, `STRING`, `JSON`, `IMAGE`, `VARIANT`.
  - `COLOR` is RGBA in 0–1.
  - `Patch.evaluate()`, `Patch.alwaysNeedsToEvaluate`, `Patch.loopAware` (gives `PatchInput.values` arrays), `isDirty()`, `readRising()`, `readFalling()`.
  - `Http` and `Base64` globals.
  - No sounds or videos.
  - VERIFIED ([scriptingapi](https://origami.design/documentation/concepts/scriptingapi)). Useful as the port type vocabulary our format has to represent.
- v207 "JSON formatted as text will no longer have trailing commas", v185 "JSON support for boolean values", "Allow JSON as an input for Text Attributes." VERIFIED.

### 1.8 Community tooling that parses `.origami`

- **None found.** GitHub code search `extension:origami` (via `gh api search/code`) returned 85 results, none from Origami Studio. They're `.origami` source files of an unrelated language (`gitter-badger/origami-3`), CMS config (`origami-cms`), a Dockerfile suffix and poker datasets. Searching for `"Origami Studio" extension:origami` returned 0. VERIFIED.
- Web searches for Origami Studio file parsers or converters only surface unrelated "origami" projects: the FOLD crease-pattern format, a Ruby PDF library, and so on. VERIFIED.
- The only official structured exports are the v221 JSON CLI and copy-paste. VERIFIED.

---

## 2. Importing into Origami

### 2.1 From Figma: the "Origami Pasteboard" plugin

- **Plugin:** Figma Community plugin ID `832268423801619787`, "Origami Pasteboard", linked from [origami.design](https://origami.design/). VERIFIED. The Figma page returned 403 to me, so the description below comes from [figmaelements.com](https://figmaelements.com/plugins/origami-pasteboard/). VERIFIED (secondary):
  - "Import designs from Figma into Origami Beta. To use, open this plugin and select the frames or layers you would like to copy. Then click 'Copy Selected Layers'."
  - Supports "Custom shapes, frames, text, images, and masks."
  - "Since Origami doesn't support multiple fills, strokes, or shadows, only the first of each will be copied."
- **Workflow** ([Getting Started tutorial](https://origami.design/tutorials/getting-started/getting-started)), VERIFIED:
  1. Install Origami Pasteboard.
  2. In Figma, open it from the Plugins menu, select layers, and click **"Copy Selected Layers"**.
  3. In Origami, **Edit > Paste (⌘V)**.
- **Homepage claim:** "Copy and paste editable vector shape and text layers into Origami." VERIFIED.
- **Release-note history**, VERIFIED:
  - v72 (09/24/2020): "Improvements on Paste from Figma", "Better Artboard positioning when pasting from Sketch or Figma".
  - v82 (02/09/2021): "Copy to Figma plugin now include Auto Layout information." The wording "Copy to Figma" probably means the copy-from-Figma plugin (INFERRED). It implies auto-layout data travels in the pasteboard payload.
  - v177 (09/30/2024): "Origami Pasteboard now supports corner smoothing from Figma."
- **Mechanism (INFERRED):** the plugin serializes the selected nodes, with images as base64 and vectors as paths, into a clipboard payload, and Origami recognizes it on paste. The pasteboard type and payload schema are UNKNOWN.
- **No live sync or relink with Figma files** is documented. Import is a one-shot copy. INFERRED from absence.
- **DOC-DRIFT:** the Canvas doc says "Draw and edit shape layers, text, images, videos and layers imported from Sketch & Figma" but documents no import procedure. The procedure is only in the tutorial.

### 2.2 From Sketch

- **Plain clipboard, no plugin.** "select the Photo layer … and Info Group" and **Edit > Copy (⌘C)** in Sketch, then **Edit > Paste (⌘V)** in Origami. Layers may need realigning. VERIFIED ([tutorial](https://origami.design/tutorials/getting-started/getting-started)).
- **What's imported:** layer structure and groupings, text, images, gradients. VERIFIED (tutorial summary).
- **INFERRED mechanism:** Sketch puts its own layer archive on the macOS pasteboard, and Origami decodes it. Sketch's file format is an open ZIP of JSON with JSON Schemas ([developer.sketch.com/file-format](https://developer.sketch.com/file-format/)), which makes this tractable.

### 2.3 Media and other inputs

Images, video, Lottie, fonts and JSON can all come in. VERIFIED ([Canvas docs](https://origami.design/documentation/canvas/canvas), releases):
- **Images:** PNG in samples; WebP support added in v177.
- **Video:** video layers.
- **Lottie:** v144 (06/26/2023) "Support for Lottie animations.", via the "JSON to Lottie" patch and a "Lottie Animation" layer.
- **Fonts:** v226 embed fonts, variable fonts, and a "Variable Font builder from Patch Picker."
- **Other advanced layers:** Particle System, Video Stream, Shader, Clone Layer (v220), Reflective Layer (v224).
- **Assets:** v120 (07/25/2022) "Added brand new asset manager."
- **Drag-and-drop out:** "Allow to drag and drop files from Origami to Finder." (version not captured). VERIFIED.

---

## 3. Exporting and sharing from Origami

| Capability | Details | Status / Source |
|---|---|---|
| **Video capture** | "Capture, trim and export video of your prototype directly in Origami." The Viewer can "View, interact with and record the prototype." v159 (01/23/2024) "Added Advanced Recording options (Ability to specify codec and quality)." Recording performance work in v72, v73, v76 and v78; recording fixes in v206. Container formats and codec list are UNKNOWN. | VERIFIED ([home](https://origami.design/), [docs intro](https://origami.design/documentation/), releases) |
| **GIF export** | No evidence of native GIF export. v107 only mentions "Stop playing animated gifs on patch previews." | UNKNOWN / likely absent (INFERRED) |
| **Image/screenshot export** | Not documented. | UNKNOWN |
| **Origami Live (device preview)** | USB mirroring on iOS (App Store id942636206) and Android (Google Play; needs Developer Mode + USB debugging and a data cable). "Any changes you make in Origami Studio are immediately reflected in the preview". | VERIFIED ([previewsharing](https://origami.design/documentation/workflow/previewsharing)) |
| **Sharing files** | "Origami Studio files can also be sent directly to a phone or tablet via email, Dropbox, AirDrop, etc." The toolbar has an export button and a "Share button" with common options. Recipients need Origami Studio or Origami Live. | VERIFIED (docs + [tutorial](https://origami.design/tutorials/getting-started/previewing-and-sharing)) |
| **Custom fonts on device** | Docs: "Origami Studio doesn't mirror custom fonts to your device" and suggest Anyfont or Apple Configurator. **DOC-DRIFT:** v226 (08/19/2026) added "Ability to Embed fonts into a prototype." | VERIFIED conflict |
| **QuickLook** | v224 QuickLook generation plugin with video previews. | VERIFIED |
| **JSON** | v221 Copy-Paste As JSON, plus a CLI converting a file to JSON. | VERIFIED |
| **Code export** | **Origami 2.0 (Quartz Composer, 2015)** had Code Export generating iOS, Android and web animation code (Pop / Rebound / Rebound JS). Origami Studio docs for Pop Animation only say values "easily pass to developers" via those frameworks. There's no Studio code-export release note. | VERIFIED (2.0, secondary); absent in Studio (INFERRED) |
| **Components/systems export** | "Publish Components" → System Publisher (see §3.1). v126 (10/17/2022) "Origami remembers the last published directory when exporting local components." v123 "Manually check for new versions of local components without reopening your file." | VERIFIED |

**Viewer shortcuts.**
- Tutorial: Toggle Frame `⌥⇧⌘D`, Toggle Hand `⌥H`, Minimize `⌥⌘F`, Fullscreen `⇧⌘F`, Restart `⇧⌘R`.
- Shortcuts page: Restart Prototype `⌘R`, Toggle Device `⌥D`, Mini Viewer `⌘⌥F`, 1:1 Viewer `⌘⌥0`.
- **DOC-DRIFT:** Restart is listed as `⌘R` on the [shortcuts page](https://origami.design/documentation/workflow/keyboardshortcuts) but `⇧⌘R` in the [previewing tutorial](https://origami.design/tutorials/getting-started/previewing-and-sharing). VERIFIED conflict.

### 3.1 Components, libraries and systems (sharing)

Sources: [Components](https://origami.design/documentation/workflow/components), [Creating an Origami System](https://origami.design/documentation/workflow/systemcreation), [shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts). All VERIFIED unless noted.

**Component kinds**
- **Patch Components:** patches only, "analogous to programming functions".
- **Layer Components:** layers plus patches.

**Creating and editing**
- **Create:** Component > Create Component / Group Into Component (**⌃⌘G**).
  - **DOC-DRIFT:** the Canvas page says "⌘⌥G to group them into a component".
- **Component Info** (⇧⌘I) → Port Setup tab: port types, defaults, min and max.
- **Publish Port** (⌥P) adds purple (input) or blue (output) published-port patches. These appear in the binary as `builtin.group.input` and `builtin.group.output`. INFERRED mapping; the identifiers themselves are VERIFIED.
- **Port tags:** *Enable* (shows an eye toggle) and *Custom*.
- **Enter / Exit Component:** ⌥↓ / ⌥↑. The components page shows exit as ⌃⌥↑, another small **DOC-DRIFT**.

**Libraries**
- **Layer Library** (⌘↩ or the toolbar "+") has four categories: Platform Components (iOS/Android), Device Components (Camera/Viewfinder, Text Field), Document Components, and User Library Components.
- **User Library:** Add to User Library (⌘⌥L), Add to Other Library (⌘⌥⇧L), Show Patch Folder, Unlink Component from Library. Re-opening documents "prompts users to upgrade to the new version."
- **Shared libraries:** a Dropbox folder, added through the Systems tab in Preferences, or "Add to Other Library".
- **Platform restriction:** set in Patch Info → Patch Setup.

**Origami System (current workflow)**
1. All components must live in **one `.origami` file**.
2. **Publish Components** opens the System Publisher: choose which components to include; enter System Name, Author/Organization and Description.
3. **Advanced Options:** System Identifier, version number, custom icon, and "Attach JSON files for text styling, color libraries, or data".
4. **Save** writes one distributable file. The docs don't name its extension (UNKNOWN).
5. **Install** by double-clicking it, or via Preferences > Components > "+".
6. **Updates:** "When the system is installed from a shared location, everyone will receive updates … existing documents with older components will be prompted to upgrade."
7. v87 (04/21/2021): "Component System Publishing flow: can publish a component system directly inside your document."
8. There's also a legacy "System Maker" workflow with a migration guide.

**Model (INFERRED):** components are vendored into documents (v185 "saving of component dependencies"), each with a library identity and version. On open, the app compares them with installed systems and offers an upgrade. That's a lockfile-plus-vendoring model, and it's what we recommend in §5.7.

---

## 4. Adjacent document formats: what to borrow

### 4.1 Rive: `.riv` runtime format (binary)

Source: [rive.app/docs/runtimes/advanced-topic/format](https://rive.app/docs/runtimes/advanced-topic/format). VERIFIED.

- **Header**
  - Fingerprint: 4 bytes, ASCII `RIVE` (`0x52 0x49 0x56 0x45`).
  - **Major version** varuint: "Runtimes are compatible with only a single major Rive export format version. The current major format is 7." "Major versions are not cross-compatible."
  - **Minor version** varuint: compatible within the same major.
  - **File ID** varuint.
- **Table of contents:** a list of known property keys terminated by 0, then a bit array of 2-bit backing types (Uint/Bool=0, String=1, Float=2, Color=3). A runtime can **skip unknown properties**.
- **Encoding**
  - Primitives: little-endian; varuint = LEB128; string = uint length + UTF-8; float = IEEE-754 32-bit.
  - Objects: a varuint *type key* followed by (property key, value) pairs, ending with 0. For example, Shape has type key 3, and "property key 13 will always be the X value of a Node object".
  - **Hierarchy:** a parent ID is "the index within the Artboard of the ContainerComponent derived object that makes a valid parent". Parents are referenced by index, not UUID.
- **Compatibility rule:** "When a file uses newer features that an older compatible runtime does not understand, the file still loads and supported features continue to work. Unsupported features are treated as no-ops."
- **Borrow:**
  - Globally stable property keys, so type and property identifiers are never reused.
  - Forward compatibility: unknown data is preserved or ignored, never fatal.
  - A split between the *editor* format and a *runtime* format. Our editor document is JSON; a future player export could be compact.
- **Don't borrow:** binary as the source of truth. It's not diffable or LLM-editable.

### 4.2 Lottie JSON (Lottie Animation Community spec)

Sources: [lottie-spec composition](https://lottie.github.io/lottie-spec/latest/specs/composition/), [properties](https://lottie.github.io/lottie-spec/latest/specs/properties/), [LF press release](https://www.linuxfoundation.org/press/lottie-animation-community-announces-lottie-v1.0-specification). VERIFIED.

- **Governance:** the Lottie Animation Community (LAC), a Joint Development Foundation / Linux Foundation project, formed in 2023. **Lottie spec v1.0 announced Sept 17, 2024**; a 1.0.1 page exists. A machine-readable **JSON Schema** is published.
- **Top-level Animation fields:**
  - `nm` (name), `ver` (spec version, integer MMmmpp), `fr` (fps), `ip` (in point, frame), `op` (out point).
  - `w`, `h`, `layers[]`, `assets[]`, `markers[]`, `slots` (dictionary of slot ID → replaceable property).
- **Layers:** `refId` points to assets; `ind` is the layer index and `parent` is used for parenting.
- **Animated properties:**
  - `a` (0/1). `k` holds the value when `a=0`, or a keyframe array when `a=1`.
  - Keyframe: `t` (frame), `s` (value), `h` (hold 0/1), `i`/`o` easing handles `{x, y}` (per-dimension arrays for vectors).
  - Position keyframes add `ti` and `to` spatial tangents.
- **Borrow:**
  - A published JSON Schema.
  - `slots` for overridable parameters, which parallels component inputs.
  - Cubic-bezier easing handles as data.
- **Avoid:** two-letter keys. They're compact but opaque to LLMs and humans, and the spec itself needs a glossary.
- **Interop:** our app should *import Lottie as a layer type*, as Origami does since v144. Lottie *export* of simple timeline animations is a possible stretch goal.

### 4.3 Figma REST JSON (and the Plugin API export)

Sources: [files endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/), [node types](https://developers.figma.com/docs/rest-api/file-node-types/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [exportAsync](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/). VERIFIED.

**Structure**
- A node tree: `DOCUMENT` → `CANVAS` (pages) → children. The response includes `components`, `componentSets`, `styles` and `schemaVersion`.
- **Node types:** `DOCUMENT`, `CANVAS`, `FRAME`, `GROUP`, `TRANSFORM_GROUP`, `SECTION`, `VECTOR`, `BOOLEAN_OPERATION`, `STAR`, `LINE`, `ELLIPSE`, `REGULAR_POLYGON`, `RECTANGLE`, `TABLE`, `TABLE_CELL`, `TEXT`, `TEXT_PATH`, `SLICE`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `STICKY`, `SHAPE_WITH_TEXT`, `CONNECTOR`, `WASHI_TAPE`.
- **Global node props:** `id`, `name`, `visible` (default true), `type`, `rotation`, `pluginData`, `sharedPluginData`, `componentPropertyReferences`, `boundVariables`, `explicitVariableModes`.
- **FRAME props relevant to import:**
  - Geometry: `absoluteBoundingBox`, `absoluteRenderBounds`, `relativeTransform`, `size`.
  - Paint: `fills: Paint[]`, `strokes: Paint[]`, `strokeWeight`, `cornerRadius`, `rectangleCornerRadii`, `cornerSmoothing`, `effects: Effect[]`, `blendMode`, `opacity`, `clipsContent`.
  - Auto layout: `layoutMode` (NONE / HORIZONTAL / VERTICAL / GRID), `itemSpacing`, `paddingLeft/Right/Top/Bottom`, `primaryAxisAlignItems`, `layoutSizingHorizontal/Vertical`.
  - Other: `constraints`, `isMask`.

**Endpoints**
- `GET /v1/files/:key`: params `version`, `ids`, `depth`, `geometry=paths` (vector path data), `plugin_data`, `branch_data`. Tier 1, scope `file_content:read`.
- `GET /v1/files/:key/nodes?ids=…`: Tier 1.
- `GET /v1/images/:key`:
  - `ids`, `scale` 0.01–4, `format` jpg / png / svg / pdf.
  - SVG options: `svg_outline_text`, `svg_include_id`, `svg_include_node_id`, `svg_simplify_stroke`; plus `contents_only`, `use_absolute_bounds`.
  - "Image assets will expire after 30 days"; images over 32 megapixels are scaled down.
- `GET /v1/files/:key/images` (image fills): "Image URLs will expire after no more than 14 days". Tier 2.
- `GET /v1/files/:key/meta`: Tier 3, scope `file_metadata:read`.

**Rate limits (updated Nov 17, 2025)**
- Tier 1 (file, nodes, images):
  - Dev/Full seats: 10/min (Starter), 15/min (Pro), 20/min (Org), unlimited (Enterprise).
  - **View/Collab seats: up to 20 per month.**
- On 429 you get `Retry-After`, `X-Figma-Rate-Limit-Type` and `X-Figma-Upgrade-Link`.
- **Implication:** a REST-only importer is unusable for free or View-seat users. A plugin path is required.

**Plugin API `node.exportAsync`** overloads return:
- `Uint8Array` for PNG, JPG, PDF, MP4, GIF and WebM.
- `string` for `SVG_STRING`.
- **`Object` for `JSON_REST_V1`**: "the same REST formatted JSON for a node as the Figma REST API", added in Plugin API update 68, 2023-06-21.
- Settings: `constraint`, `contentsOnly`, `useAbsoluteBounds`, `svgIdAttribute`, and for video `fps`, `quality`, `loopCount`.

**Borrow**
- `schemaVersion` in responses.
- `pluginData` / `sharedPluginData` namespaces, which we'd use as `meta` / extension data.
- `boundVariables` for token binding.

### 4.4 Figma `.fig` / clipboard (Kiwi): unofficial

Sources: [fig-kiwi on npm](https://www.npmjs.com/package/fig-kiwi), [Grida io-figma](https://grida.co/docs/wg/feat-fig). VERIFIED (secondary).

- `.fig` uses Evan Wallace's **Kiwi** binary schema format, with an 8-byte prelude `fig-kiwi` (also `fig-jam.` and `fig-deck`).
- The **file embeds its schema**, so it's self-describing.
- **Clipboard HTML** carries `<!--(figmeta)…-->` and `<!--(figma)…-->` comments holding base64 Kiwi data **without a schema**. Grida keeps a pre-extracted schema that has to be refreshed as Figma evolves.
- "This is an unofficial feature": Figma can change the format without notice.
- **Borrow:** a self-describing schema inside the file. That argues for a `$schema` URL and a `formatVersion` in our JSON.
- **Don't rely on it:** Figma-clipboard parsing is fragile and legally grey.

### 4.5 tldraw: store snapshot and `.tldr`

Sources: [persistence docs](https://tldraw.dev/docs/persistence), [file.ts source](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/utils/tldr/file.ts), [TLBaseShape](https://tldraw.dev/reference/tlschema/TLBaseShape), [SerializedSchema](https://tldraw.dev/reference/store/SerializedSchema). VERIFIED.

- **`.tldr` file:** `interface TldrawFile { tldrawFileFormatVersion: number; schema: SerializedSchema; records: UnknownRecord[] }`.
  - MIME `application/vnd.tldraw+json`, extension `.tldr`, file format version **1**.
- **SerializedSchema V2:** `{ schemaVersion: 2, sequences: { [sequenceId]: version } }`. Each record type or custom shape has its own migration sequence. V1 used `storeVersion` + `recordVersions`.
- **Records:** a flat array of `{ id, typeName, … }`.
  - Shape ID format **`"shape:abc123"`**, with the typeName as prefix.
  - `TLBaseShape`: `id`, `typeName: "shape"`, `type`, `x`, `y`, `rotation`, **`index: IndexKey` (fractional index)**, `parentId` (page or frame), `isLocked`, `opacity`, `props`, `meta`.
- **Snapshot split:** `getSnapshot(store)` returns `{ document, session }`.
  - `document` = shapes, pages, bindings; persist it.
  - `session` = camera, selection, UI state; keep it per user.
- **On load:** migrations run automatically.
  - `parseTldrawJsonFile` validates, rejects too-new versions, and calls `schema.migrateStoreSnapshot()`.
  - Error types: v1-file detection, invalid file, unsupported version, migration failure, corrupted records.
- `serializeTldrawJson` inlines assets as base64 data URLs where possible. That's bad for git diffs; avoid it.
- **Borrow:**
  - The document/session split, which fixes Origami's `editorData.expandedLayerGroups` noise.
  - Typed ID prefixes.
  - **Per-subsystem migration sequences**, useful for plugin or custom patch types.
  - Explicit error taxonomy on load.
  - `props` + `meta` separation.

### 4.6 Excalidraw JSON

Sources: [JSON schema doc](https://docs.excalidraw.com/docs/codebase/json-schema), [element types.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts). VERIFIED.

- **File:** `{ type: "excalidraw", version, source: "https://excalidraw.com", elements[], appState, files }`. The clipboard variant uses `type: "excalidraw/clipboard"`.
- **Element base fields:** `id`, `x`, `y`, `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `strokeStyle`, `roundness`, `roughness`, `opacity`, `width`, `height`, `angle`, `seed`, `version`, `versionNonce`, `index`, `isDeleted`, `groupIds`, `frameId`, `boundElements`, `updated`, `created`, `link`, `locked`, `customData`.
- `index`: "String in a fractional form defined by https://github.com/rocicorp/fractional-indexing. Used for ordering in multiplayer scenarios".
- `version`: "sequentially incremented on each change". `versionNonce`: "Random integer that is regenerated on each change. Used for deterministic reconciliation".
- **Arrows** bind via `startBinding` / `endBinding` `{ elementId, fixedPoint, mode }`.
- **Borrow:**
  - The **clipboard type discriminator**.
  - `customData` for extensions.
  - `files` keyed by ID, kept separate from elements.
- **Avoid in a git-first file:** per-element `version`, `versionNonce`, `updated` and `isDeleted` tombstones. They're for live sync and churn every diff. Keep them in the live-collab layer if we ever add one, not in saved files.

### 4.7 Blender node trees: NodeToPython and Tree Clipper

Sources: [NodeToPython](https://github.com/BrendanParmer/NodeToPython), [Tree Clipper](https://github.com/Algebraic-UG/tree_clipper). VERIFIED.

**NodeToPython** (GPLv3, v4.2.0, Blender 4.2–5.2)
- Converts Geometry, Shader and Compositing node trees into "legible Python code".
- **Script** mode creates a function that rebuilds the tree. **Add-on** mode produces a zip with operator registration.
- "automatically handles node layout, default values, subgroups, naming, colors".
- Generated code must comply with the GPL because it uses the Blender Python API.

**Tree Clipper**
- "Easier version control and sharing of node trees via `.json` or copy-pasteable strings".
- Plain JSON or compressed `TreeClipper::<base64>` strings.
- Includes tree interfaces and an "Explicit interface for referenced 'external' items that are not part of the export".
- Aims for backwards compatibility.
- Its critique of NodeToPython: Python-as-storage "is inherently not backwards-compatible and doesn't allow reading without Blender."

**Borrow**
- **Data, not code, as storage.** A code-gen view (for example "export as TypeScript that rebuilds this graph") is a nice *projection*, but it shouldn't be the canonical format.
- A **magic-string clipboard** (`<App>::<base64 json>`) for sharing snippets in Discord or Slack.
- **Explicit external references.**

### 4.8 ComfyUI workflow JSON

Sources: [v1.0 spec](https://docs.comfy.org/specs/workflow_json), [v0.4 spec](https://docs.comfy.org/specs/workflow_json_0.4), subgraph docs via [DeepWiki](https://deepwiki.com/Comfy-Org/ComfyUI_frontend/3.4-group-nodes-and-subgraph-system). VERIFIED (subgraphs: secondary).

**v0.4 (legacy, JSON Schema draft-07)**
- Required: `last_node_id`, `last_link_id`, `nodes`, `links`, `version`. Optional: `groups`, `config`, `extra`, `models`.
- **Links are 6-element tuples:** `[link_id, origin_node_id, origin_slot, target_node_id, target_slot, type]`.

**v1.0**
- Required: `version` (const 1), `state` {`lastGroupid`, `lastNodeId`, `lastLinkId`, `lastRerouteId`}, `nodes`. Optional: `config`, `groups`, `links`, `reroutes`, `extra`, `models`.
- **Nodes:** `id`, `type`, `pos`, `size`, `flags`, `order`, `mode`, `properties`, plus optional `inputs[]` {`name`, `type`, `link`}, `outputs[]` {`name`, `type`, `links[]`}, `widgets_values`, `color`, `bgcolor`.
- **Links become objects:** `{ id, origin_id, origin_slot, target_id, target_slot, type, parentId? }`.
- Groups: `{ title, bounding[4], color, font_size, locked }`. Models: `{ name, url, directory, hash?, hash_type? }`.

**Subgraphs**
- Definitions keyed by UUID, each with its own interior `nodes` and `links` plus I/O slot metadata.
- Instances are `SubgraphNode`s. Inside, the input node uses id `-10` and the output node id `-20`.

**Two formats**
- **UI workflow** (above) vs **API "prompt" format**: `{ "<id>": { class_type, inputs: { name: literal | ["<nodeId>", outputIndex] } } }`.
- In the API format, a connection is stored *on the input*. VERIFIED (secondary).

**Borrow**
- **Input-side connection storage** (API format).
- **Links + reroutes** as first-class objects.
- **Subgraph definitions separate from instances.**
- `models[]` with URL and hash as external dependencies, which maps to our library lock.

**Avoid**
- **Link data stored twice** (the `links` array *and* `inputs[].link` / `outputs[].links`), which breaks consistency.
- **Positional slot indices.** They break when ports are reordered; use named ports.
- `widgets_values` as positional arrays, which LLMs misalign easily.

### 4.9 Noodl (open source) `project.json`

Source: [noodlapp/noodl](https://github.com/noodlapp/noodl), read via GitHub API. VERIFIED from source code.

- **Licensing:** editor GPLv3; runtime and generated apps MIT.
- **`ProjectModel`** (`projectmodel.ts`) has `id`, `version`, `settings`, `metadata`, `components: ComponentModel[]`, `variants[]` and `rootNodeId`. It's read from `project.json`.
- **Upgraders:** `ProjectModel.Upgraders[version]` runs in a loop:
  - "0" → "1" → "2" ("support for variants, state parameters and transitions") → "3" ("support for comments") → "4".
  - A missing version is treated as '0'.
- **Component:** `{ name, id, graph }`.
- **`NodeGraphModel` JSON:**
  - `roots: NodeGraphNode[]`: nested nodes with children; visual children form a tree.
  - `visualRoots: string[]`.
  - `connections: [{ fromId, fromProperty, toId, toProperty }]`.
  - Ports are addressed by **property name**.
  - Renaming a port walks every connection and rewrites `fromProperty` / `toProperty`.
- **Custom git merge:** `packages/noodl-git/src/merge-strategy.ts` detects conflicts in `project.json` (or `*/project.json`) and resolves them through a JSON-aware 3-way `mergeProject(ancestors, ours, theirs)`.
- **Borrow:**
  - **Named-property ports.**
  - **Sequential upgraders.**
  - A **JSON-aware merge driver**.
  - Components as the unit of graph.
- **Avoid:** one giant `project.json`, which makes merge conflicts likely. Noodl had to write a custom merge strategy.

### 4.10 Pencil → pen.dev `.pen`

Sources: [the .pen format](https://docs.pencil.dev/for-developers/the-pen-format), [.pen files](https://docs.pencil.dev/core-concepts/pen-files), [CLI](https://docs.pencil.dev/for-developers/pen-cli). VERIFIED.

**Document shape**
- `export interface Document { version: "2.18"; themes?: {[axis]: string[]}; imports?: {[alias]: string}; variables?: {[name]: VariableDefinition}; children: Child[] }`.
- An object tree "not unlike HTML or SVG" on an infinite canvas.
- **IDs:** unique, **must not contain `/`**, and **auto-generated if omitted**. Nested overrides use slash paths, e.g. `"parent-id/child-id"`.

**Entity fields**
- `id`, `name`, `context`, `reusable` (makes it a component), `theme`, `enabled`, `opacity`, `flipX`/`flipY`, `layoutPosition` ("auto" | "absolute"), `rotation`.

**Types**
- Shapes: `rectangle`, `ellipse`, `polygon`, `path`.
- Text-like: `text` (growth "auto" | "fixed-width" | "fixed-width-height"), `note`, `prompt`, `context`.
- Containers: `frame` (flex layout, clip, slots), `group`.
- Special: `icon` (lucide, feather, Material Symbols, phosphor), `script` (generates children from JS), `browser`, `ref`.

**Layout**
- `layout` "none" | "vertical" | "horizontal", `gap`, `padding` (number | [v, h] | [t, r, b, l]), `justifyContent`, `alignItems`.
- Sizing: "fit_content" | "fill_container".

**Components and variables**
- **Instances:** `{ type: "ref", ref: "<componentId>", descendants?: {"a/b": {...}} }`.
  - Without `type` in a descendant = property override.
  - With `type` = replacement.
  - `children` key = replace only the child array.
- **Slots:** `slot?: false | string[]` (recommended component IDs).
- **Variables:** `{ type: "boolean" | "color" | "number" | "string", value | [{ value, theme }] }`, referenced as `"$color.primary"`. Last matching theme wins.
- **Graphics:** multiple fills (color, gradient linear/radial/angular, image, shader, mesh_gradient); one stroke; effects (blur, background_blur, shadow).

**Tooling**
- **Git guidance:** close files before switching branches; use relative asset paths; resolve conflicts in the UI.
- Docs warn "breaking changes to the .pen format are possible".
- **CLI `pen`:** `--in`, `--out`, `--prompt`, `--model`, `--export` (PNG, JPEG, WEBP, PDF) and `--tasks` ("JSON tasks file for batch operations"). Exposes MCP tools `execute` and `read_skill`.

**Borrow**
- A **TypeScript schema as the authoritative spec**.
- **Omit-ID-and-autogenerate** for agent writes.
- **`ref` + `descendants` slash-path overrides** for component instances.
- **`context` / `note` / `prompt` entities** that carry AI intent inside the doc.
- A **headless CLI that runs the same engine** as the app.
- **Variables with theme axes.**

### 4.11 Vuo `.vuo`: Graphviz DOT

- Vuo, an open-source-core QC successor, stores compositions in **Graphviz DOT**. "default graph type and ID to be generated for new .vuo (Graphviz dot format) composition files". You can render one with `dot -Grankdir=LR -Nshape=Mrecord … RenderTextLayer.vuo`. VERIFIED (secondary: [Vuo API docs](https://api.vuo.org/0.4.9/classVuoCompilerComposition.html), [Vuo CLI manual](https://doc.vuo.org/2.0.0-beta2/manual/rendering-a-composition-on-the-command-line.xhtml), via search snippets; pages returned 406).
- **Borrow:** a text-DSL *view* of a patch graph is very compact and readable, one edge per line.
- **Avoid as canonical:** DOT can't carry rich typed values or a layer tree cleanly. See §5.2.

### 4.12 Sketch and Penpot (ZIP-of-JSON design formats)

- **Sketch:** a ZIP of `document.json`, `meta.json`, `user.json`, `pages/*.json`, `images/` and `previews/`. Uses a `_class` discriminator, `do_objectID` UUIDs and `userInfo` for third-party data. JSON Schemas are published (`@sketch-hq/sketch-file-format`). VERIFIED ([developer.sketch.com/file-format](https://developer.sketch.com/file-format/)).
- **Penpot `.penpot` (binfile v3):**
  - A ZIP with `manifest.json` (format version `1`, Penpot version, file inventory, enabled **feature flags** such as `components/v2`, `variants/v1`, `design-tokens/v1`, `layout/grid`).
  - `files/` holds pages, colors, components, typographies, `tokens.json` and media.
  - `objects/` holds binaries, each with a JSON sidecar.
  - **Format version (ZIP structure) is separate from data version (per-file model).**
  - VERIFIED ([help.penpot.app](https://help.penpot.app/user-guide/export-import/penpot-file-format/)).
- **Borrow:**
  - A manifest plus feature flags.
  - Two-level versioning: container vs data.
  - Asset sidecars.
  - A split of pages and components into separate files.

### 4.13 Comparison matrix

| Format | Text? | Schema published | Stable IDs | Graph edges | Components/instances | Versioning | Git-friendly | LLM-friendly |
|---|---|---|---|---|---|---|---|---|
| Origami 2016 | YAML | No | 64-bit random ints | On output ports | Vendored | `_version` + `_compatibilityVersion` | Medium (noisy) | Low (opaque IDs) |
| Origami 2025 | Binary (FlatBuffers `ORGM`) | No | UUID + ints | ? | Vendored + system upgrade prompts | Internal v129; cliff at v205 | No | No (JSON CLI v221) |
| Rive `.riv` | Binary | Spec doc | Index-based | n/a | n/a | Major/minor + ToC | No | No |
| Lottie | JSON | JSON Schema | `ind`, `refId` | n/a (parenting) | `assets` + `slots` | `ver` MMmmpp | Medium | Medium (terse keys) |
| Figma REST | JSON (read-only) | Docs + TS types | `"1:23"` | n/a (prototype reactions) | `componentId` | `schemaVersion` | n/a | High |
| tldraw `.tldr` | JSON | TS + validators | `shape:xyz` + fractional index | Bindings records | Custom shapes | Per-sequence migrations | Medium (flat records, base64 assets) | High |
| Excalidraw | JSON | Docs + TS | Random string + fractional index | Bindings | Libraries | `version` + element versions | Medium (churn fields) | High |
| Tree Clipper | JSON | ? | Node names | Links | Node groups + external refs | Backwards-compat aim | High | High |
| ComfyUI v1 | JSON | JSON Schema | Integer counters | Link objects (duplicated) | Subgraph definitions | `version` | Low–Medium | Medium |
| Noodl | JSON | TS source | GUIDs | `{fromId, fromProperty, toId, toProperty}` | Components | Upgraders "0"→"4" | Low (single file) + custom merge | Medium |
| pen.dev `.pen` | JSON | TS schema | Author-chosen, no `/`, autogen | n/a | `reusable` + `ref` + `descendants` | `"2.18"` | High | **High (designed for agents)** |
| Vuo | DOT | DOT grammar | Node names | Edge lines | Subcompositions | ? | High | Medium |
| Sketch / Penpot | ZIP of JSON | JSON Schema / docs | UUID | n/a | Symbols / components | Manifest + data version | Medium (zipped) | Medium |

---

## 5. Recommendation: our document format

### 5.1 Goals, ranked

1. **LLM-editable.** Claude can read, write and patch it directly, with low error rates, and MCP tools can apply structured operations.
2. **Git-diffable and mergeable.** Small edits produce small, local, readable diffs, and conflicts are rare and resolvable.
3. **Deterministic.** Same document → byte-identical output.
4. **Forward/backward evolvable.** Permanent migrations, and unknown fields survive a round trip.
5. **Fast enough** for large prototypes. A binary *runtime* export can come later, like Rive's split.

### 5.2 JSON vs YAML vs TypeScript-like DSL

| Criterion | **JSON** (recommended canonical) | YAML | TS-like / DOT-like DSL |
|---|---|---|---|
| LLM generation reliability | Excellent. Native structured-output and tool-call formats are JSON. | Good, but indentation errors are common. | Good for small graphs; custom syntax gets hallucinated. |
| Typing | Explicit (strings, numbers, booleans, null) | **Implicit typing hazards.** Origami needed 76 `!!int` / `!!float` / `!!str` / `!!id` tags in one file (VERIFIED §1.3). | Needs a custom type system. |
| Schema and validation | JSON Schema + TS types; free editor autocomplete | Can reuse JSON Schema, but the YAML 1.1/1.2 split is ambiguous. | Custom parser, custom errors. |
| Partial edits by tools | JSON Pointer (RFC 6901), JSON Patch (RFC 6902), Merge Patch (RFC 7396) | Rarely supported | Needs an AST |
| Diffs | Good *if* canonical, pretty-printed, and map-keyed | Good | Excellent |
| Comments | None; use `notes` fields | Yes | Yes |
| Ecosystem (every language) | Universal | Wide, but many parsers disagree | None |

**Decision**
- **JSON is the canonical storage.**
- Offer a **read-only compact text projection** (DOT/TS-like outline) as an MCP resource so the model spends fewer tokens on context. It's never parsed back as storage.
- Optionally offer a "graph as TypeScript builder code" export for developers, the NodeToPython idea, as a projection only.

### 5.3 Single file vs folder

**Recommend a folder package as the working format**, plus a **zipped single-file bundle** for sharing and AirDrop. Both have the same internal layout, like Sketch, Penpot, and Origami's `.diamond/` folder inside a ZIP.

```
Checkout Flow.proto/                    # folder (registered as a macOS document package/UTI)
├── project.json                        # manifest (small, rarely changes)
├── components/
│   ├── main.json                       # root prototype (layer tree + patch graph)
│   ├── primary-button.json             # one file per document component
│   └── bottom-sheet.json
├── scripts/
│   └── pch_4f9k2m.js                   # JS patch sources as real .js files (diffable, lintable)
├── shaders/
│   └── lyr_glass01.wgsl                # shader layer sources (if/when supported)
├── assets/
│   ├── assets.json                     # asset registry: id -> {file, kind, name, w, h, scale, sha256}
│   └── sha256-9c1e…d2.png              # content-addressed files (dedupe for free; cf. Origami v101)
├── libraries.lock.json                 # pinned external component libraries (id, version, sha256)
├── vendor/                             # vendored copies of used library components (offline-safe)
│   └── acme-ds@1.4.0/…
└── .proto/                             # per-user session state — gitignored by default
    └── session.json                    # camera, selection, expanded groups, panel sizes (tldraw "session")
```

Why this layout (INFERRED design rationale, grounded in the evidence above):
- **One JSON per component** keeps edits local and merge conflicts rare. Noodl's single `project.json` needed a custom merge driver.
- **Scripts and shaders as separate files:** diffs read as code, linters work, and LLMs edit them as code. Origami v177 had to deep-copy scripts when patches were duplicated, which suggests the scripts were embedded in patches.
- **Content-addressed assets:** no base64 in JSON (tldraw inlines base64), automatic dedupe, and stable diffs.
- **Session state out of the document:** fixes the Origami `editorData.expandedLayerGroups` noise.
- **Single-file `.protoz` (ZIP, stored)** for sharing, with the same internal layout. Opening one either unzips to a temp package or reads in place.

### 5.4 Stable IDs

- **String IDs with a kind prefix and short random body**, e.g. `lyr_7fK2p9QaB1`, `pch_4f9k2m…`, `cmp_…`, `ast_…`. Use 10–12 base58 characters (nanoid-style) so they're typeable and tokenize well.
  - The prefix makes cross-references self-describing: `pch_` vs `lyr_` in an edge is obvious to an LLM. It parallels tldraw's `shape:`.
  - Avoid 64-bit integers, which exceed JS safe integers (Origami used them), and avoid positional indices (Rive, ComfyUI slots).
- **Agents may omit IDs** when creating nodes (the pen.dev pattern). The app assigns them on apply and returns the mapping. Saved files always contain IDs.
- **`name` is separate** and human-editable. Never key references by display name.
- **IDs must not contain `/` or `.`**, so we can use `a/b` descendant paths (pen.dev) and `node.port` references.
- **Ports use semantic keys, not random IDs:**
  - Built-in patch ports have fixed camelCase keys (`enabled`, `progress`, `position`).
  - Component ports get author-assigned keys, with a separate `label`.
  - Renaming a key is a migration or refactor op that rewrites references (Noodl's pattern).

### 5.5 Representing layers, patches, connections, loops, components

**Core modeling decision (INFERRED from Origami's own structure, VERIFIED in §1.3):** in Origami a *layer is also a patch*. Layer properties are patch inputs, and `layer_hierarchy` just orders layer-patch IDs. We keep that unification in the runtime, but store the two surfaces the way users think about them:
- `layers`: an ordered, nested tree, because order matters and nesting is intuitive.
- `patches`: a **map keyed by ID**, because graph order is irrelevant and maps diff and merge better.

**Connections live on the input they drive.**
- An input value is **either a literal or a link**: `"progress": {"link": "pch_pop1.progress"}`.
- This makes "two drivers into one input" impossible to represent. It matches the ComfyUI API format and Origami's single-driver inputs (INFERRED), and removes the need for a separate edge list that can go out of sync.
- A derived edge list can be computed for UI and outline purposes.
- Layer properties can be linked the same way.

**Illustrative example** (field names are proposals; types are TypeScript-ish in comments):

```jsonc
// components/main.json
{
  "$schema": "https://example.org/schema/component/v1.json",
  "formatVersion": 1,
  "id": "cmp_main",
  "name": "Main",
  "kind": "prototype",                  // "prototype" | "layerComponent" | "patchComponent"
  "device": { "preset": "iphone-17-pro" },
  "notes": "Tap the card to expand it with a spring.",   // AI/human intent (pen.dev 'context' idea)

  "interface": {                         // published ports (Origami: Publish Port / Component Info)
    "inputs":  { "expanded": { "type": "boolean", "default": false, "label": "Expanded" } },
    "outputs": {}
  },

  "layers": [                            // ordered back-to-front; nesting = children
    {
      "id": "lyr_card01", "type": "rect", "name": "Card",
      "props": {
        "position": [16, 120], "size": [358, 220], "cornerRadius": 24,
        "fills": [{ "type": "solid", "color": "#FFFFFFFF" }],
        "scale": { "link": "pch_scale1.output" }        // driven by a patch
      },
      "children": [
        { "id": "lyr_title1", "type": "text", "name": "Title",
          "props": { "text": "Popular Events", "font": { "family": "SF Pro", "size": 20, "weight": 600 } } }
      ]
    }
  ],

  "patches": {                           // map keyed by ID (order-free, merge-friendly)
    "pch_tap01":   { "type": "interaction", "name": "Tap Card",
                     "inputs": { "layer": { "layerRef": "lyr_card01" } },
                     "ui": { "x": 40, "y": 60 } },
    "pch_switch1": { "type": "switch",
                     "inputs": { "flip": { "link": "pch_tap01.tap" } },
                     "ui": { "x": 220, "y": 60 } },
    "pch_pop1":    { "type": "popAnimation",
                     "inputs": { "number": { "link": "pch_switch1.on" }, "bounciness": 5, "speed": 10 },
                     "ui": { "x": 400, "y": 60 } },
    "pch_scale1":  { "type": "transition",
                     "inputs": { "progress": { "link": "pch_pop1.progress" }, "start": 1, "end": 1.08 },
                     "ui": { "x": 580, "y": 60 } },
    "pch_js01":    { "type": "javascript", "script": "scripts/pch_js01.js",
                     "inputs": { "count": 3 }, "ui": { "x": 40, "y": 240 } }
  },

  "comments": [                          // Origami has builtin.comment patches (VERIFIED in binary strings)
    { "id": "cmt_01", "text": "Spring feel matches iOS sheet", "rect": [30, 20, 600, 120] }
  ],

  "meta": {}                             // extension/plugin data (Figma pluginData, Excalidraw customData analog)
}
```

**Value typing**
- **Rule:** JSON-native where unambiguous. Otherwise use small tagged literals, and have the port type in the patch definition disambiguate.
- **Number:** a JSON number. The canonical writer rounds to 4–6 decimals to avoid float noise.
- **Vectors:** `position` / `size` / `anchor` / `point3D` / `point4D` are fixed-length arrays (`[x, y]`, …).
- **Color:** `"#RRGGBBAA"` strings, with an optional `{ "space": "display-p3", "r": …, "g": …, "b": …, "a": … }` object for wide gamut. Origami JS COLOR is RGBA in 0–1 (VERIFIED), so the importer converts.
- **Gradient:** a native type, as in Origami v218 ("Gradients as native type").
- **Enum:** a string key, never a positional index. Origami shows index tooltips for enum popups (v201), which suggests index-based storage internally (INFERRED). We avoid that.
- **Pulse:** no literal. It's only ever linked.
- **Image / video / font:** `{ "asset": "ast_…" }`.
- **Layer reference:** `{ "layerRef": "lyr_…" }`.
- **JSON:** an inline object. Large data goes in `assets/*.json` via `{ "asset": … }`.

**Loops (Origami-style value arrays)**
- Loops are just **values that are arrays flowing through ports**. Origami's JS API exposes `PatchInput.values` when `loopAware` (VERIFIED).
- Store static loop data as arrays: `"values": [10, 20, 30]` or a `loopBuilder` patch with `"inputs": { "values": [[0,0],[0,80],[0,160]] }`.
- Layer duplication over a loop is a property of the layer group, e.g. `"repeat": { "link": "pch_loop1.index" }`. No separate loop structure is needed in the file.
- The **file format stays loop-agnostic**. Evaluation semantics belong to the runtime spec.

**Components**
- **Definition:** a component file (`components/<slug>.json`) with `interface`, `layers` and `patches`.
- **Instance in a layer tree:**
  ```jsonc
  { "id": "lyr_btn01", "type": "instance", "component": "cmp_primaryButton",
    "inputs": { "label": "Buy", "enabled": { "link": "pch_valid1.output" } },
    "overrides": { "lyr_icon01": { "props": { "opacity": 0 } } } }   // pen.dev 'descendants'-style
  ```
- **Patch-component instance in `patches`:** `{ "type": "component", "component": "cmp_debounce", "inputs": {…} }`.
- **Library component:** `"component": "lib:acme-ds/primaryButton"`, resolved through `libraries.lock.json`, e.g. `{ "acme-ds": { "version": "1.4.0", "source": "https://…/acme-ds-1.4.0.protolib", "sha256": "…" } }`.
  - A vendored copy lives in `vendor/`. That's Origami's upgrade-prompt model (VERIFIED §3.1), made explicit and diffable.
- **Library package:** a `.protolib` ZIP containing `library.json` (id, name, author, description, version, icon, tokens/JSON attachments; mirrors Origami's System Publisher fields) plus `components/`.

**Patch type identifiers**
- **Namespaced strings:**
  - Built-ins are bare camelCase (`popAnimation`), or `core.popAnimation` if we want Origami-like namespacing (`builtin.bouncy`).
  - Third-party types are `pkg:<package>/<type>@<major>`.
- **A registry of patch definitions** (JSON Schema per patch type: ports, types, defaults, min/max) is published alongside the document schema. MCP exposes it so the model never guesses port keys.

### 5.6 Canonical serialization (git-friendliness)

- UTF-8, LF, 2-space indent, trailing newline.
- **Object keys are sorted in schema order** (a fixed order such as `id`, `type`, `name`, `props`, `inputs`, `children`, …), otherwise alphabetical. Map-keyed collections (`patches`) are sorted by ID.
- **Short leaf objects stay on one line** when under about 100 characters (`{ "link": "pch_pop1.progress" }`), so each connection change is a one-line diff.
- Number formatting: fixed max precision; `-0` → `0`; no exponent notation for UI-range numbers.
- **No volatile fields** in saved documents: no timestamps, per-save nonces, or cached derived data such as the duplicated layer tree in Origami 2016.
- **Tooling:** `proto fmt`, `proto validate`, `proto migrate` (headless CLI, same engine as the app, like pen.dev's `pen`), and a **`.gitattributes` merge driver** for `components/*.json` that does ID-aware 3-way merging (Noodl's approach, but file-scoped).

### 5.7 Versioning and migrations

- **`project.json` fields:**
  - `formatVersion` (integer, monotonic).
  - `minReaderVersion`. This is Origami's `_version` / `_compatibilityVersion` pattern (VERIFIED §1.3), which lets old apps refuse files gracefully.
  - `generator` (`"AppName 0.9.3 (build 1234)"`, like the build string in Origami binaries).
  - `features: ["layout/stack/v1", "shaders/v1", …]` (Penpot-style feature flags).
- **Every component file carries `formatVersion`**, so files migrate independently and partial checkouts work.
- **Migrations are pure functions `migrate_vN_to_vN1(json) → json`**, run in sequence on load (Noodl Upgraders pattern). Plugin and custom patch packages get **their own migration sequences** (tldraw `sequences`).
- **Load pipeline:** detect version → reject too-new (a clear error naming the required app version) → migrate step by step → validate against JSON Schema → load.
  - Error taxonomy modeled on tldraw: `invalidFormat`, `tooNew`, `migrationFailed`, `corrupt`.
- **Preserve unknown fields** within `meta` / extension namespaces on round-trip (Rive "no-op" forward-compat philosophy).
- **Never delete a migration.** Keep a fixture corpus of saved files from every format version in CI. Origami's v205 cliff (VERIFIED §1.5) is the anti-pattern.

### 5.8 Clipboard and fragment format

- **One fragment schema** for copy-paste between documents, from our Figma plugin, from agents, and for Slack/Discord sharing:
  ```jsonc
  { "type": "proto/clipboard", "formatVersion": 1,
    "layers": [ … ], "patches": { … }, "assets": { "ast_…": { "sha256": "…", "dataBase64": "…" } } }
  ```
  - Base64 assets are allowed **only in clipboard fragments**, never in saved docs.
  - Inspired by Excalidraw's `excalidraw/clipboard` type, Origami v221 Copy-Paste As JSON, and Tree Clipper's magic strings.
- **Magic-string variant:** `PROTO::<base64(zstd(json))>` for chat sharing.
- **On paste, remap IDs** that collide, and rewrite links inside the fragment.

### 5.9 LLM/MCP editing surface (how the format is *used* by Claude)

- **Resources**
  - `outline`: a compact, token-efficient text projection, similar to Figma MCP `get_metadata`'s "sparse XML". For example:
    ```
    layer lyr_card01 rect "Card" 358x220 @16,120 scale<-pch_scale1.output
    patch pch_pop1 popAnimation number<-pch_switch1.on bounciness=5 speed=10
    ```
  - `component/<id>` returns full JSON.
  - `schema/patches/<type>` returns the port definitions.
- **Tools:** `apply_ops` with batched, transactional ops: `addLayer`, `addPatch`, `setInput`, `link`, `unlink`, `moveLayer`, `groupIntoComponent`, `publishPort`, `setScript`, `importFigmaSelection`. Plus `validate`, `render_screenshot`, `record_video` and `run_prototype_step` (simulate taps).
  - Ops accept omitted IDs, return an ID map, and fail atomically with schema-path errors.
- **Raw-file editing still works:** because the format is canonical JSON with a schema, Claude Code can edit files in a repo. The app watches the package folder and reloads, validating and migrating on the way in.

---

## 6. Importing `.origami` files (stretch goal): feasibility and legal reasonableness

### 6.1 Technical feasibility

| Layer | Difficulty | Notes |
|---|---|---|
| ZIP container, `*.diamond/graph`, `resources/` | Trivial | Stored ZIP; tolerate duplicate entries and arbitrary top folder names. VERIFIED |
| Legacy YAML graph (≈2016–?, `_version` ≈112) | Moderate | Standard YAML with explicit tags. Map `prototype` identifiers, ports (`typeInfo`, `defaultValue`), `outgoing_connections`, `layer_hierarchy`. The 64-bit IDs must be read as strings or BigInt. |
| Current binary graph (`ORGM`, internal version 129) | **Hard and fragile** | FlatBuffers-like, with **no published schema**. Field meanings would have to be inferred from byte patterns across many files, and Meta changes internal versions frequently (129 by Oct 2025). |
| **Origami JSON via Meta's CLI / Copy-Paste As JSON (v221+)** | **Moderate, and the recommended route** | The user runs Meta's own tool on their own file; we parse text JSON. Schema undocumented, but self-describing text. |
| Semantic mapping | **The real cost** | Hundreds of `builtin.*` patches and `origami.*` / `material.*` / iOS components. Needs a mapping table and evaluation-semantics parity (Pop spring parameters, transitions, loops, `builtin.wirelessBroadcaster` / `Receiver`, `builtin.multiplexer`, `builtin.splitter`). Unsupported patches import as **placeholder nodes** that keep their ports and values. |

**Importer design (INFERRED)**
1. Accept `.origami` or Origami JSON.
2. If it's `.origami` and the graph is YAML, parse it directly. If the graph starts with the `ORGM` identifier, show "Convert with Origami Studio's CLI (v221+) and import the JSON" instructions, or run the user's installed CLI when detected on the system (subprocess, with explicit user consent).
3. Normalize to our IR.
4. Map patch types through a versioned mapping table. The identifiers can be discovered from the public documentation URL names (e.g. `builtin.bouncy.html`), so no binary decoding is needed.
5. Produce an import report listing unmapped patches.

### 6.2 Legal considerations (not legal advice; confirm with counsel)

- **File formats and functionality aren't protected expression in the EU.** CJEU *SAS Institute v World Programming* (C-406/10, 2012): "neither the functionality of a computer program nor the programming language and the format of data files … constitute a form of expression of that program and are not protected by copyright". Observing, studying and testing a lawfully acquired program to reproduce its functionality isn't infringement. Directive 2009/24/EC Art. 6 allows decompilation when needed for interoperability. VERIFIED (secondary: [Wikipedia SAS v WPL](https://en.wikipedia.org/wiki/SAS_Institute_Inc_v_World_Programming_Ltd), [Gerrish Legal](https://www.gerrishlegal.com/blog/2020/04/16/2020-4-7-reverse-engineering-when-can-users-lawfully-decompile-software)).
- **US.** *Sega v. Accolade*, 977 F.2d 1510 (9th Cir. 1992): intermediate copying and disassembly "to discover functional interface specifications that were then independently implemented" was fair use. VERIFIED (secondary: [Justia](https://law.justia.com/cases/federal/appellate-courts/F2/977/1510/305345/), [copyright.gov summary](https://www.copyright.gov/fair-use/summaries/segaenters-accolade-9thcir1992.pdf)).
  - **DMCA §1201(f)** allows circumventing technological measures "for the sole purpose of identifying and analyzing those elements of the program that are necessary to achieve interoperability" and sharing that information solely for interoperability. VERIFIED ([17 U.S.C. §1201(f), LII](https://www.law.cornell.edu/uscode/text/17/1201)).
  - **The samples showed no encryption or DRM** (a plain stored ZIP with YAML or FlatBuffers-style data), so §1201 anti-circumvention is probably not implicated (INFERRED).
- **Contract risk is the main risk.**
  - Origami Studio's EULA or terms of use **could not be located** online (UNKNOWN). The download link redirects straight to a DMG on fbcdn.
  - EULAs often forbid reverse engineering; in the US such clauses have sometimes been enforced (e.g. *Bowers v. Baystate*; INFERRED general knowledge, not researched here).
  - **Action:** read the license shipped inside the Origami Studio app bundle before any binary decoding work.
  - Parsing JSON that Meta's own CLI emits for a user's own document doesn't require reverse-engineering the app or its binary format. That's the cleanest position.
- **Clean-room practice**
  - Don't copy Origami code, patch implementations, icons, device frames or component art (`material.*` / `origami.*` component visuals), or documentation text.
  - Re-implement behaviors from observed functionality and our own tests.
  - Don't commit Meta's example `.origami` files as test fixtures. Use user-created or synthetic files; the samples in this research were only inspected transiently in a scratch directory.
  - The Origami Classic framework license (VERIFIED §1.1) permits use and distribution of *that* framework, not Studio.
- **Trademarks:** don't use "Origami" in our product name. Nominative use ("Import Origami Studio files") is generally acceptable (INFERRED).
- **Verdict:**
  - **Legally reasonable:** import from Origami JSON (CLI or clipboard) and legacy YAML.
  - **Hold for counsel and EULA review:** decoding current `ORGM` binaries.
  - Either way, rank this below core product work, since the semantic mapping is the expensive part.

---

## 7. Importing Figma frames as layers: recommended approach

### 7.1 Options evaluated

| Option | How | Pros | Cons | Status |
|---|---|---|---|---|
| **A. REST API** | PAT or OAuth (`file_content:read`) → `GET /v1/files/:key/nodes?ids=<frameId>&geometry=paths`; rasters via `GET /v1/images/:key?ids=…&format=png&scale=2` or `svg`; image fills via `GET /v1/files/:key/images` | Official; no plugin install; supports "refresh from Figma" by `fileKey` + `nodeId` + `version` | **Tier 1 limits.** View/Collab seats: **20 requests per month**; Dev/Full 10–20/min (non-Enterprise). Signed image URLs expire (14–30 days). Requires a token. | VERIFIED |
| **B. Our own Figma plugin** (Origami Pasteboard model) | Plugin walks the selection, calls `node.exportAsync({format:'JSON_REST_V1'})` for REST-shaped JSON plus `SVG_STRING` / PNG for vectors and rasters, gathers image bytes, and converts to **our clipboard fragment** → clipboard, or a localhost/WebSocket handoff to the desktop app | Works for all seat types, no REST rate limits, proven UX (Origami does this) | Plugin maintenance; payload size for big frames; plugin sandbox clipboard limits (INFERRED) | VERIFIED API; UX proven by Origami |
| **C. Figma MCP server** (agent path) | Claude uses `get_metadata` (sparse XML outline), `get_design_context` (structured design + code), `get_screenshot`, `download_assets`, `get_variable_defs`; it then calls *our* MCP `apply_ops` to build layers | AI-native; good for "rebuild this screen as a prototype"; uses the user's Figma auth | Output is geared to code (React/Tailwind by default), so it's lossy for exact geometry; rate limits | VERIFIED ([tools list](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)) |
| **D. `.fig` / clipboard Kiwi parsing** | fig-kiwi-style decoding | No auth; offline | **Unofficial and fragile**; clipboard lacks a schema; ToS risk | VERIFIED (secondary) |
| **E. SVG paste fallback** | User does "Copy as SVG" in Figma → paste; we parse SVG into vector/text/group layers | Universal, no plugin | Loses auto layout, components, text semantics (unless text isn't outlined) | INFERRED |

### 7.2 Recommendation

1. **Ship B first** (plugin → clipboard JSON → ⌘V). It matches designers' existing Origami muscle memory and avoids rate limits.
   - Build the payload from Plugin API node properties (or `JSON_REST_V1`) and tag every imported layer with `meta.figma = { fileKey?, nodeId, pluginVersion }`.
   - **Beat Origami's limitation:** keep **all** fills, strokes and effects. Origami keeps only the first (VERIFIED §2.1).
2. **Add A as "Link and Refresh"** for users with Dev/Full seats. Re-fetch linked nodes by `nodeId`, diff against the imported layers by `meta.figma.nodeId`, and update props without breaking patch links. That's something Origami lacks (INFERRED).
3. **Expose C** in our MCP docs as the Claude workflow: Claude reads the design with Figma MCP, then writes into our document with our tools.
4. **Keep E** as a zero-setup fallback.
5. **Don't build D.**

### 7.3 Node → layer mapping table (proposed)

| Figma | Our layer | Notes |
|---|---|---|
| `FRAME` / `COMPONENT` / `INSTANCE` (auto layout or not), `SECTION` | `group` (frame) with `clip = clipsContent`; if `layoutMode ≠ NONE` → `stack` layout (`direction`, `gap = itemSpacing`, `padding*`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutSizingHorizontal/Vertical` → hug/fill/fixed) | `COMPONENT` → offer "create document component"; `INSTANCE` → instance of an imported component, or flatten |
| `GROUP`, `TRANSFORM_GROUP` | `group` (no clip) | Bake `relativeTransform` into position, rotation and scale |
| `RECTANGLE` | `rect` | `cornerRadius` / `rectangleCornerRadii`, `cornerSmoothing` (Origami added smoothing in v177) |
| `ELLIPSE` | `oval` | Arc data → shape if partial |
| `VECTOR`, `BOOLEAN_OPERATION`, `STAR`, `LINE`, `REGULAR_POLYGON` | `shape` (path data from `fillGeometry` / `strokeGeometry` with `geometry=paths`, or plugin `vectorPaths`) | Or raster fallback via `/v1/images` |
| `TEXT` | `text` | `characters`, `style`, per-range overrides; embed fonts where licenses allow |
| Paints: `SOLID`, `GRADIENT_LINEAR/RADIAL/ANGULAR/DIAMOND`, `IMAGE` (`imageRef`) | `fills[]` entries; images → content-addressed assets | Diamond gradient may need an approximation |
| `effects`: `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR` | `effects[]` | |
| `isMask` | Mask group | Origami represents masks as `maskedLayers` (VERIFIED §1.3) |
| `opacity`, `blendMode`, `visible`, `constraints`, `rotation` | Same-named props | Pass-through blend modes (Origami v219) |
| `boundVariables` | Token bindings (optional) | Map to our variables/tokens if present |
| Prototype reactions (`reactions`) | Optional: generate starter patches (Tap → Switch/Transition) | Stretch goal; good fit for AI-assisted conversion (INFERRED) |

---

## 8. Open questions

1. **Origami JSON CLI (v221):** what's the binary's name and location, its flags, does it convert JSON→`.origami`, and what's the JSON schema? Is it the same schema as "Copy-Paste As JSON"? This needs a machine with Origami Studio ≥ v221, to be run on a user-created file.
2. **When did Origami switch from YAML to binary `ORGM`?** Which internal versions (112→129) used which payload? Can current Origami still *write* YAML?
3. **Origami Studio EULA text:** does it restrict reverse engineering of file formats? (Look in the app bundle or in the in-app About/License screens.)
4. **Origami System file extension** and container format (the published system file).
5. **Video export container, codec list and resolution/fps options** (v159 "Advanced Recording options"). Is there GIF export?
6. **Origami Pasteboard clipboard payload:** pasteboard UTI and schema. Does Origami accept pasted SVG or Figma HTML clipboard directly?
7. **Does the current Origami release still open the 2016 `Getting-Started-(Completed).origami`** that origami.design serves, given the v205 cutoff?
8. **For our format:** confirm with a prototype that input-side links plus map-keyed patches produce clean 3-way merges on realistic concurrent edits, and measure LLM op-error rates for JSON vs the compact outline DSL.
9. **Figma plugin sandbox limits:** max clipboard payload size, and whether a localhost WebSocket handoff to a desktop app is allowed under Figma plugin network access rules.
10. **Pop Animation / spring parameter semantics:** exact mapping of Origami bounciness/speed to spring tension and friction (Rebound formulas). That belongs to the animation research track but is needed for a faithful `.origami` import.

---

## Appendix A: Evidence log (commands and observations)

- `file completed.origami` → `Zip archive data, at least v1.0 to extract, compression method=store`
- `unzip -l completed.origami` → `Getting-Started-(Completed).diamond/graph` (76,911 B), `resources/Image 28.png`, `resources/Image 30.png`, dated 10-26-2016
- 2016 graph: `ASCII text`, 2,710 lines. Top-level keys `_compatibilityVersion`, `_version`, `layer_hierarchy`, `resources`, `root`. Ruby `YAML.load_file` OK. Key frequency: `type` 459, `value` 330, `id` 201, `name` 195, `typeInfo` / `tag` / `port` / `defaultValue` 171, `inports` 27, `outports` 9, `outgoing_connections` 9, `fromPatch` / `fromPort` / `toPatch` / `toPort` 11 each
- 2025 graph (`Facebook-Popular-Events`): `xxd` → `3000 0000 4f52 474d …`. Python check: root_offset 48, file_identifier `ORGM`, vtable_pos 12, vtable_size 36, object_size 52, 16 fields, sane offsets
- Build string in binary: `203.0 (799429869)`. Release v203 = 9/29/2025; ZIP entries 09-30-2025
- Audio Metering (Final) `.origami` graph begins `2c00 0000 ORGM` (root offset 44)
- GitHub code search `extension:origami` → 85 hits, none from Origami Studio; `"Origami Studio" extension:origami` → 0

## Appendix B: Source index

- Origami: [releases](https://origami.design/releases/) · [home](https://origami.design/) · [docs intro](https://origami.design/documentation/) · [components](https://origami.design/documentation/workflow/components) · [system creation](https://origami.design/documentation/workflow/systemcreation) · [previewing & sharing](https://origami.design/documentation/workflow/previewsharing) · [shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts) · [canvas](https://origami.design/documentation/canvas/canvas) · [JS API](https://origami.design/documentation/concepts/scriptingapi) · [Getting Started tutorial](https://origami.design/tutorials/getting-started/getting-started) · [Previewing tutorial](https://origami.design/tutorials/getting-started/previewing-and-sharing) · [Origami Studio 3 article](https://tech.facebook.com/engineering/2020/9/origami-studio-3-makes-app-design-easier-than-ever/) · [Origami Classic repo](https://github.com/facebookarchive/origami) · [Origami Live 2015](https://engineering.fb.com/2015/02/24/ios/introducing-origami-live/) · [Pasteboard plugin (secondary)](https://figmaelements.com/plugins/origami-pasteboard/)
- Rive: [.riv format](https://rive.app/docs/runtimes/advanced-topic/format)
- Lottie: [spec composition](https://lottie.github.io/lottie-spec/latest/specs/composition/) · [properties](https://lottie.github.io/lottie-spec/latest/specs/properties/) · [LF v1.0 press](https://www.linuxfoundation.org/press/lottie-animation-community-announces-lottie-v1.0-specification)
- Figma: [file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/) · [node types](https://developers.figma.com/docs/rest-api/file-node-types/) · [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/) · [exportAsync](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/) · [MCP tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) · [fig-kiwi](https://www.npmjs.com/package/fig-kiwi) · [Grida io-figma](https://grida.co/docs/wg/feat-fig)
- tldraw: [persistence](https://tldraw.dev/docs/persistence) · [file.ts](https://github.com/tldraw/tldraw/blob/main/packages/tldraw/src/lib/utils/tldr/file.ts) · [TLBaseShape](https://tldraw.dev/reference/tlschema/TLBaseShape) · [SerializedSchema](https://tldraw.dev/reference/store/SerializedSchema)
- Excalidraw: [JSON schema](https://docs.excalidraw.com/docs/codebase/json-schema) · [types.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/types.ts)
- Blender: [NodeToPython](https://github.com/BrendanParmer/NodeToPython) · [Tree Clipper](https://github.com/Algebraic-UG/tree_clipper)
- ComfyUI: [workflow JSON v1](https://docs.comfy.org/specs/workflow_json) · [v0.4](https://docs.comfy.org/specs/workflow_json_0.4)
- Noodl: [noodlapp/noodl](https://github.com/noodlapp/noodl) (`projectmodel.ts`, `NodeGraphModel.ts`, `noodl-git/src/merge-strategy.ts`)
- pen.dev: [.pen format](https://docs.pencil.dev/for-developers/the-pen-format) · [pen files](https://docs.pencil.dev/core-concepts/pen-files) · [CLI](https://docs.pencil.dev/for-developers/pen-cli)
- Vuo: [API ref](https://api.vuo.org/0.4.9/classVuoCompilerComposition.html) · [CLI manual](https://doc.vuo.org/2.0.0-beta2/manual/rendering-a-composition-on-the-command-line.xhtml)
- Sketch: [file format](https://developer.sketch.com/file-format/) · Penpot: [.penpot format](https://help.penpot.app/user-guide/export-import/penpot-file-format/)
- QC: [File Juicer QTZ](https://echoone.com/filejuicer/formats/qtz) · [Wikipedia](https://en.wikipedia.org/wiki/Quartz_Composer)
- Legal: [17 U.S.C. §1201](https://www.law.cornell.edu/uscode/text/17/1201) · [Sega v. Accolade (Justia)](https://law.justia.com/cases/federal/appellate-courts/F2/977/1510/305345/) · [SAS v WPL](https://en.wikipedia.org/wiki/SAS_Institute_Inc_v_World_Programming_Ltd) · [EFF RE FAQ](https://www.eff.org/issues/coders/reverse-engineering-faq)
