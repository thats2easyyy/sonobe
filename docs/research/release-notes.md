# Origami Studio — Release Notes: Full History, Current Feature Inventory, and Stale-Docs Audit

Research date: 2026-09-16. Scope: every Origami Studio version I could find, with emphasis on 2022 through 2026.
Purpose: factual/behavioral knowledge for a clean-room, open-source, AI-native alternative. No proprietary code or assets were copied.

Legend: **VERIFIED** = seen directly in a primary source during this session (raw HTML, official doc page, App Store listing, decoded tweet ID). **INFERRED** = my reasoning from verified facts, or taken from a search-engine summary I could not open.

---

## 0. Sources and method

| Source | URL | What it gave | Status |
|---|---|---|---|
| Official release notes | https://origami.design/releases/ | 136 release entries, **Version 72 (09/24/2020) to Version 228 (09/07/2026)**, split into "Features" and "Fixes" | VERIFIED: raw HTML (848 KB) downloaded with curl and parsed. The page has a detailed list (`li.release` with `h1.version-num`, `p.release-date`, `div.features`, `div.fixes`) and a compact list (`div.attributes`). Both hold the same 136 version/date pairs. |
| Official docs | https://origami.design/documentation/ (and ~60 sub-pages fetched) | Docs nav (all documented layers and patches), concept pages, per-patch port lists | VERIFIED |
| Origami homepage | https://origami.design/ | "Origami Studio 3" branding, performance claims | VERIFIED |
| Origami Live (iOS) App Store | https://apps.apple.com/us/app/origami-live/id942636206 | Version 228.0 (Sep 7), iOS 15.1+, 189.7 MB, seller Meta Platforms, Inc. | VERIFIED |
| Engineering at Meta | https://engineering.fb.com/ios/introducing-origami-live/ | Origami 2.0 + Origami Live (Feb 24, 2015) | VERIFIED |
| The Next Web | https://thenextweb.com/news/facebook-origami-studio | Origami Studio announcement (Apr 13, 2016) | VERIFIED |
| @FacebookOrigami tweets | x.com/facebookorigami/status/… | Tweet IDs decoded with the Twitter snowflake formula `(id >> 22) + 1288834974657 ms` | VERIFIED (dates computed locally) |
| Kami (community AI copilot) | https://github.com/alexwidua/kami | GPT-4 JS-patch generator; how it injects the JS Patch API docs | VERIFIED |
| Figma Elements mirror of the "Origami Pasteboard" plugin | https://figmaelements.com/plugins/origami-pasteboard/ | What the Figma→Origami plugin copies | VERIFIED (figma.com returned 403) |
| Uptodown (Android Origami Live) | https://origami-live.en.uptodown.com/android/download | v2.8.1, labeled "Discontinued app" | VERIFIED (third-party) |

Method notes and caveats:
- The release notes were parsed from **raw HTML**, not from an AI page summary. The WebFetch summarizer invented at least one bullet ("Right-click support on Mouse Patch" under v74, which is not in the HTML), so every item in this report comes from the parsed HTML (Appendix A is the verbatim extract).
- The official releases page **starts at Version 72 (09/24/2020)**, shortly after Origami Studio 3 shipped (08/20/2020). Pre-v72 history comes from secondary sources; see §1.
- The Wayback Machine CDX API returned "Temporarily Offline" on every attempt, so archived pre-2020 release-notes pages and archived doc snapshots could not be retrieved.
- The session's web-search budget ran out near the end; a few history items (Nov 2018 release contents, Oct 27 2016 public launch date, May 28 2020 beta date) rest on search-engine summaries and are marked INFERRED.
- Version numbers **missing** from the releases page (never listed; probably internal or unreleased builds; INFERRED): 75, 77, 79, 81, 93, 95, 96, 105, 106, 112, 124, 131, 132, 157, 158, 162, 181, 184, 202, 209, 210. (VERIFIED absent)
- Release cadence: roughly every two weeks since 2020 (VERIFIED from dates). The iOS Origami Live companion ships the same build number (App Store v228.0 on Sep 7 matches Studio v228 on 09/07/2026). (VERIFIED)

---

## 1. History before the release-notes page (2013 to Sept 2020)

| Date | Event | Evidence |
|---|---|---|
| ~2013 | Origami launched as a free Facebook toolkit (patch library) for Apple's **Quartz Composer**. | INFERRED. TNW (2016) says "Facebook originally released Origami as a toolkit for Apple's Quartz Composer a few years before"; the 2013 date is my background knowledge and was not re-verified. |
| **2015-02-24** | **Origami 2.0** (still Quartz Composer based) + **Origami Live for iOS**. Features: **Code Export** ("export your prototype as code" with snippets for iOS, Android and web), **Presentation Mode** (full-screen with phone mockups and hand cursors, mirroring to external displays), **Sketch integration** (Origami layers linked to Sketch files so assets update while the prototype runs), live editing on device. | VERIFIED, https://engineering.fb.com/ios/introducing-origami-live/ |
| **2016-04-13** | **Origami Studio announced** as a standalone native app ("We're excited to show you Origami Studio, a new design tool from @facebookdesign"). Native for OS X, uses Core Animation; preview on an iPhone over USB; prototypes run as side-loaded apps; free. | VERIFIED. Tweet 720358764411375617 decodes to 2016-04-13T21:11Z; TNW article of the same date. |
| 2016-10-27 | Origami Studio public launch (Product Hunt listing date). | INFERRED (search summary of the Product Hunt page; not opened) |
| 2017-10 | "Origami Studio October 2017 release" (Facebook Notes post). | VERIFIED title in search results; content is behind a Facebook login |
| 2018-02 | "Origami Studio February 2018 release" (Facebook Notes post). | VERIFIED title; content behind login |
| **2018-05-24** | Update: "Network Requests, rich text styling, improved performance, and more!" | VERIFIED. Tweet 999751605284057089 decodes to 2018-05-24T20:38Z. |
| 2018-11 | New iOS and Android devices, new patches, tutorials, support for macOS 10.14 and Sketch 52. | INFERRED (search-engine summary of a tweet; not opened) |
| 2020-05-28 | **Origami 3 Beta** at beta.origami.design ("new canvas interface, dynamic layout, Figma/Sketch support, and a ton of performance improvements and new patches"). | Date INFERRED (search summary); description VERIFIED on https://prototypr.io/toolbox/origami-3-beta. `beta.origami.design` no longer resolves (VERIFIED ENOTFOUND). |
| 2020-06-03 | "Origami Pasteboard" Figma plugin listed (copies Figma layers to Origami "Beta"). | VERIFIED (figmaelements.com listing date) |
| **2020-08-20** | **Origami Studio 3 released**: "Origami Studio 3 is here. With a new canvas interface, dynamic layout, Figma & Sketch support and a ton of performance improvements and new patches." Homepage performance claims: "4.5x Faster Patch Editor", "2x Faster Origami Viewer", "2.1x Faster Origami Live Viewer". | VERIFIED. Tweet 1296533685068533760 decodes to 2020-08-20T19:44Z; https://origami.design/ |
| 2020-09-24 | **Version 72**, the first entry on the official releases page. | VERIFIED |

---

## 2. Version-by-version timeline (v72 to v228)

All rows are VERIFIED against the raw release-notes HTML unless a cell says INFERRED. "—" means nothing in that category. Exact wording is in Appendix A.
Columns: **Headline** (main features/fixes) · **New patches** · **New layer types / layer capabilities** · **UI / workflow** · **Removed / deprecated / platform / compatibility**.

### 2026 (v211 to v228)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 228 | 09/07/2026 | "Minor bugfixes." | — | — | — | — |
| 227 | 08/31/2026 | Layer Effects rendering-topology fix; fixed JS HTTP execution when looped; **"Increased token limit for JS Patch and Layer Shader when using Anthropic provider."** | — | — | AI provider setting exists (Anthropic is one provider; INFERRED that others exist) | — |
| 226 | 08/19/2026 | **Embed fonts into a prototype**; **Variable Font rendering**; fixed **"sparkle menu"** validation | **Variable Font builder** (from Patch Picker) | Variable fonts on text | "Sparkle menu" = AI entry point (INFERRED from the name) | — |
| 225 | 08/03/2026 | Crash fix on "3d groups callout layer"; Welcome Window header fix | — | (mentions **3D groups**; INFERRED as a layer/group capability) | — | — |
| 224 | 07/20/2026 | **More configurations for Reflective Layer**; **QuickLook Generation Plugin** (video previews of .origami files in Finder); app 260 MB smaller | — | **Reflective Layer** (first mention; undocumented) | Finder QuickLook previews | App size −260 MB |
| 223 | 07/07/2026 | **Shader Layer LLM generation Integration**; new devices; better Device Picker order; default device **iPhone 17 Pro**; iOS status bar fix for newer iPhones | **Fluid Spring Animation** | — | Device picker ordering | Default device changed |
| 222 | 06/23/2026 | Fixed mixed precision types in Shader Layer; **"Clone and Shader Layer are no longer hidden."** | — | Clone and Shader layers un-hidden (general availability) | — | — |
| 221 | 06/08/2026 | **JavaScript Patch LLM generation Integration**; **New Layer Effects**; **Liquid Glass Support**; **Copy-Paste As JSON**; **CLI to convert Origami file to JSON** | (new layer-effect patches; INFERRED) | Liquid Glass material/effect | Copy/paste graph and layers as JSON | Headless CLI tool (file→JSON) |
| 220 | 05/27/2026 | **Clone Layer**; **Shader Layer with Layer Inputs** | — | **Clone Layer**, **Shader Layer** (initially hidden, see v222) | — | — |
| 219 | 05/11/2026 | JS Patch support for **Variant** (type variance); **pass-through blend modes** | — | Pass-through blend mode | — | — |
| 218 | 04/27/2026 | **Gradients as native type** | — | Gradient becomes a first-class port/value type | — | — |
| 217 | 04/13/2026 | **Layer Effects on iOS**; **Plus Lighter/Darker** blend modes; **Hard Edges** for Blur effect; JS Patch **network requests + base64 encode/decode** | **Bluetooth LE patches**; **Hand Detection** | Blend modes and blur options | — | Layer effects reach iOS (Origami Live) |
| 216 | 03/30/2026 | **Visual JSON Editor**; **120 fps** when available (iOS and macOS) | — | — | Visual JSON editor | — |
| 215 | 03/18/2026 | JS Patch `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`; JSON editor multiline + embedded image preview; perf when FPS drops; fixes (zoom, crash on connect/disconnect, Pulse popover, output ports editable, Point 4D shown twice in splitter type list, JSON Splitter input display) | — | — | JSON editor | — |
| 214 | 03/02/2026 | (entry with no notes) | — | — | — | — |
| 213 | 02/17/2026 | "Add full support file drag support on layer list." | — | — | Drag files onto the layer list | — |
| 212 | 02/11/2026 | Trackpad zoom on macOS Tahoe fix; audio no longer autoplays on ports | **Text To Speech** | — | — | Tahoe fixes |
| 211 | 01/20/2026 | WebP images readable from JS Patch | — | — | — | — |

### 2025 (v185 to v208)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 208 | 12/08/2025 | Enter renames a patch when a single patch is selected | — | — | Enter-to-rename | — |
| 207 | 11/25/2025 | Tahoe fixes (autoscroll, Publish components layout, Visual effect updates, video after restart); no autocorrect/styling on normal text inputs | **Text to JSON** | — | — | **Renamed "Text from JSON" to "JSON to Text"** |
| 206 | 11/12/2025 | Option Equals fix with type variants; recording on external displays; boolean popover sizing | — | — | — | — |
| 205 | 10/27/2025 | **Cannot open files created ~2 years earlier** (upgrade them in v204 first); Option Equals returns **−1** when Value matches no option | — | — | — | **File-format cutoff** |
| 204 | 10/13/2025 | **Last version that opens pre-Oct-2023 files**; upgrades to internal file version **129**; **Smooth Value** has separate rising and falling hysteresis | — | — | — | Compatibility bridge release |
| 203 | 09/29/2025 | Undo for device selection and device color; Camera capture crash fix; Tahoe fixes; dragging a connection to empty space shows the suggested-patch picker **only with Option held**; text field no longer expands on connection hover; graph doesn't move on selection | — | — | Connection-drag behavior change | — |
| 201 | 09/02/2025 | "Bottom HUD with consoles, asset manager, loop counts, performance gauge, FPS counter"; Enum popup tooltip with index; **Appearance property on MapLayer** | — | Map Appearance | Bottom HUD | NOTE: the first two bullets are word-for-word the same as v107's; possibly a copy-paste in the notes (INFERRED) |
| 200 | 08/21/2025 | Welcome window dark mode fix | — | — | — | — |
| 199 | 08/04/2025 | **Reset a Patch/Layer to default values**; honors system **Accent color**; Network Request video thumbnails; Mouse patch reports position on right/middle click (non-trackpad); contrast tweaks | — | — | Reset-to-defaults | — |
| 198 | 07/21/2025 | **⌘7 collapse/open inspector**; Recent Files sizing; Tahoe text-field lockup fix; accessibility label on search | — | — | Inspector toggle shortcut | Tahoe |
| 197 | 07/07/2025 | General fixes | — | — | — | — |
| 196 | 06/23/2025 | Crash on unknown image types in JS fixed | — | — | — | — |
| 195 | 06/09/2025 | Warning when installed libraries need updating; **"places" port on Round patch** | — | — | — | — |
| 194 | 05/28/2025 | Large image values slowing pan/zoom; natural size; color casting; quit hang during network calls | — | — | — | — |
| 193 | 05/12/2025 | **Loop Sum** now native with type variance; Rectangle zero-dimension fix; Transform port on Text layers fixed | **Object Join** (merge JSON objects; duplicate keys overwrite) | — | — | **Origami Live requires iOS 15.1+** |
| 192 | 04/29/2025 | Error when ungrouping components with sublayers; Comment patches grow as you type | — | — | Comments auto-grow | — |
| 191 | 04/15/2025 | **WebSockets**: send/receive text and JSON | **WebSocket Connection / Send / Receive** (names from docs) | — | — | — |
| 190 | 03/31/2025 | Sound previews in Patch Info; connection icon on patch/inspector; middle-truncated file names; stable size animations; default save format is `.origami`; component info shortcut; media patch dark mode | — | — | — | Default file format enforced |
| 189 | 03/17/2025 | **Text truncation**; **NDJSON streams** from Network Request; **Wide Gamut** images; reset empty layer name; renaming a main component renames un-renamed instances; skip no-op layer effects; Snapshot captures in Wide Gamut | — | Text truncation, wide-gamut images | — | — |
| 188 | 03/03/2025 | Pulse on Change first-evaluation fix | — | — | — | — |
| 187 | 02/18/2025 | **Pulses can pulse on consecutive frames** (previously a pulse had to turn off first); delete ports with Delete key in Component Info; "Exit Component" in context menu; invert-zoom preference persists | — | — | — | Pulse semantics change |
| 186 | 02/03/2025 | Sound Player fixes; Comment tidy-up sizing; undoable comment color; Viewer center-bottom for keyboard prototypes; improved Scroll momentum | — | — | — | — |
| 185 | 01/21/2025 | **Independent x/y/z scaling**; JSON booleans; smaller files (component dependency saving); Tab through layer title editing; percentage scrub with keys; enter component on main component; shortcuts shown in context menus; dark-mode icons; many fixes | — | Independent xyz scale | Several | — |

### 2024 (v159 to v183)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 183 | 12/18/2024 | JS console crash on older macOS fixed | — | — | — | — |
| 182 | 11/12/2024 | Camera patch recording matches preview quality; quality presets fixed; better QR Code detection; JSON port hover; group insertion sizing | — | — | — | — |
| 180 | 11/11/2024 | **Patch graph search surface lists every patch tied to a layer** (interactions, blue bound properties, layer outputs); **Origami Pasteboard supports corner smoothing from Figma**; port-handle fixes (Or, Option Picker); loop popover labels | — | — | Layer-scoped graph search | — |
| 179 | 10/28/2024 | Replace-patch preview shows exact result; layer list resize | — | — | — | — |
| 178 | 10/16/2024 | General | — | — | — | — |
| 177 | 09/30/2024 | **Snippets removed**; **macOS 11 dropped (macOS 12+)**; docs links open on website; **WebP** support; duplicating a JS patch **deep-copies** its script (group into a component to share one script) | — | — | — | **Removed Snippets; macOS 12 minimum**; JS duplication semantics changed |
| 176 | 09/16/2024 | Layer properties hidden after Viewer click; iPhone 14 default Space Black | — | — | — | — |
| 175 | 09/03/2024 | **Corner radius smoothing on all layers with corner radius**; Video Stream corner radius + smoothing; smoothing clamped to 0–1 | — | Corner smoothing everywhere | — | — |
| 174 | 08/19/2024 | Patch thumbnail generation; hover layers stuck; alpha slider color | — | — | — | — |
| 173 | 08/06/2024 | **⌥L collapse selected layers recursively**; **⌃⌥↓ inspect instance**; font search; recently used fonts; **Transition patch can transition percentage values** | — | — | Shortcuts, font picker | — |
| 172 | 07/22/2024 | **Port categories for component outputs**; inspect values per loop for component instances; **Enable port on Time and Device Time**; click bound ports to jump to the binding patch in linked components; text values in popover; Esc cancels shift-drag of connections; JSON-as-text formatting fix; "Replace With" and "Replace With…" merged | — | — | Several | — |
| 171 | 07/08/2024 | Color picker: click well to close; scrubbing/keyboard on RGBA; popover values; Exif orientation | — | — | — | — |
| 170.1 | 06/24/2024 | Layout spacing with percentage sizing; center-aligned grid shift; comment resize when zoomed; binding patches update on layer rename; Convert Position perf | — | — | — | — |
| 169 | 06/10/2024 | Faster logic for long text lengths | — | — | — | — |
| 168 | 05/27/2024 | Preview JSON ports; select all text on first inspector edit | — | — | — | — |
| 167 | 05/13/2024 | **Layers inserted/pasted inside the selected group by default**; new **Paste Over Selection** | — | — | Paste semantics change | — |
| 166 | 04/29/2024 | **Show/hide Point Of Interest on Static Map Layer**; text cursor positioning; ESC ends comment edit | — | Map POI | — | — |
| 165 | 04/15/2024 | Enum option selection fix | — | — | — | — |
| 164 | 04/02/2024 | Patch picker double-click; system color palettes | — | — | — | — |
| 163 | 03/18/2024 | JSON popover perf; layer list perf while library loads; patch picker fixes; Face Detection Max Faces respected; wireless receiver click; enforced min/max on Effects | — | — | — | — |
| 161 | 02/26/2024 | Recording settings; UI fixes | — | — | — | — |
| 160 | 02/06/2024 | **Connections snap to the closest port**; warning to upgrade old files (fb.watch/q0IdovRxjH/) | — | — | Magnetic connection snapping | First deprecation warning for old files |
| 159 | 01/23/2024 | **Advanced Recording options (codec and quality)**; system publishing fixes (version starting at 0) | — | — | Recording | — |

### 2023 (v133 to v156)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 156 | 12/11/2023 | **Enter a component without unlinking** (double-click, ⌃⌥↓, or right-click "Inspect Instance"); **New Component Publishing Flow** | — | — | Component inspection | — |
| 155 | 11/27/2023 | Media patch redesign; patch→layer navigation; Sonoma blurry text; measurement guides; checkered transparent background | — | — | — | Sonoma fixes |
| 154 | 11/17/2023 | **Three new entry points for the patch picker**; Material 3 curves component fix | — | — | Patch picker access | — |
| 153 | 10/29/2023 | **Lower-contrast patch style is now default** + High Contrast preference; port highlighting shows only that port's connections; dimmed patches get an opaque background; **Value at Index / Value at Path / Value for Key support multiple types** | — | — | Visual restyle | Removed low-contrast option from Experiments (now default) |
| 152 | 10/16/2023 | Emoji counted as one character in text style ranges; asset manager rows | — | — | — | — |
| 151 | 10/03/2023 | Canvas clickability/hover fix | — | — | — | — |
| 150 | 09/21/2023 | Sublayer Container deletion validation; **multipart/form-data in Network Request**; media upload via Body JSON | — | — | — | — |
| 149 | 09/05/2023 | **Sound and Video types in Network Request**; Lottie After Effects expressions crash; large-integer JSON crash | — | — | — | — |
| 148 | 08/21/2023 | Longer network requests (timeout can be disabled); JS console can clear messages; edit text values in a popover | — | — | Text popover | **Removed old Origami System Maker file format**; **Removed quick interactions from Canvas** |
| 147 | 08/07/2023 | **Encode/Decode supports Sound**; preference for pasted-image origin scale (replaces popover) | — | — | Preference | Paste-scale popover removed |
| 146 | 07/25/2023 | **Image types accessible from JS Patch** | — | — | — | — |
| 145 | 07/10/2023 | Opening a Pattern no longer prompts component upgrade | — | — | — | — |
| 144 | 06/26/2023 | **Lottie animations support**; Color Picker remembers last tab | (JSON to Lottie; name from docs, INFERRED to date from here) | **Lottie Animation layer** | — | — |
| 143 | 06/12/2023 | **New Patch Redesign** | — | — | Patch visual redesign | — |
| 142 | 05/30/2023 | General | — | — | — | — |
| 141 | 05/15/2023 | General | — | — | — | — |
| 140 | 05/02/2023 | General | — | — | — | — |
| 139 | 04/17/2023 | General | — | — | — | — |
| 138 | 04/03/2023 | Right-side modifier keys work with Keyboard patch; stuck modifier fix; Ventura multi-video freeze | — | — | — | Ventura |
| 137 | 03/20/2023 | New component creation logic; network image caching; layer reuse on reload | — | — | — | — |
| 136 | 03/06/2023 | **Layer Search** by name + filter by type (bottom of layer panel); Soft Keyboard for all iPhone 14 | — | — | Layer search | — |
| 135 | 02/21/2023 | Custom system colors in color picker; **⌘⇧A deselect all patches** | — | — | — | **macOS minimum 10.15 → 11.0** |
| 134 | 02/07/2023 | General | — | — | — | — |
| 133 | 01/24/2023 | Missing resources (unknown extension); component previews | — | — | — | — |

### 2022 (v108 to v130)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 130 | 12/14/2022 | **iPhone 14 devices**; Layer insert crash; iOS components use "iOS" prefix; template with new Material components | — | — | — | Component naming change |
| 129 | 11/28/2022 | Inspector bindings after component upgrade; scroll patch reset position | — | — | — | — |
| 128 | 11/14/2022 | Component instance count in layer list; **enum support in JavaScript patch**; layer map perf | — | — | — | "Browse all versions" disabled (crash) |
| 127 | 11/02/2022 | Icon input when publishing a System; asset details in Asset Manager; JS loopAware crash; JS console double logging | — | — | — | — |
| **126** | **10/17/2022** | **"Released the new JavaScript patch allowing the use of JavaScript logic in prototypes."**; Publish Components inside components; remembers last published directory; layers/patches separated when publishing; preview image for patch components | **JavaScript Patch (new)** | — | System publishing | — |
| 125 | 10/03/2022 | **Smooth Corner Radius (Squircles)**; shadows/borders with independent corner radius | — | Squircle corners | — | — |
| 123 | 09/06/2022 | **Component > Check for Local Component Updates** (no reopen needed) | — | — | — | — |
| 122 | 08/22/2022 | Asset usage in Asset Manager; duplicate layer outputs; **invert zoom direction** option; virtual sublayer and scroll fixes | — | — | — | — |
| 121 | 08/08/2022 | Screen share Origami Studio on **Zoom**; low-battery warning on iOS Viewer; color conversions | — | — | — | — |
| 120 | 07/25/2022 | Copy/paste ports in Component Popover Editor; **brand new Asset Manager**; **Spring Animation supports Point, Color** | — | — | Asset Manager | **macOS min 10.15, iOS min 13.4** |
| 119 | 07/12/2022 | Copy/paste ports (same bullet as v120); Inputs/Outputs (purple patches) placed at screen center | — | — | — | — |
| 118 | 06/28/2022 | Upgrade prompts only when needed; Set Value For Key / JSON Object conversion | — | — | — | — |
| 117 | 06/13/2022 | Viewer orientation stuck; **Slow animations in Cubic Bezier**; callout shows first loop index; ~15 fixes | — | — | — | — |
| 116 | 06/02/2022 | **"Added new patches and a port in the inspector for applying effects to layers."** (Layer Effects v1) | Layer effect patches (names undocumented) | Effects port on layers | — | — |
| 115 | 05/16/2022 | **Ports can expand to show more content**; fixes | — | — | — | — |
| 114 | 05/03/2022 | **Keyboard patch: Arrow keys and Shift, CapsLock, Control, Option, Command, Escape, Delete, Tab**; **Safe Area in Device Info**; **Point 4D, Edges, Corner Radius** pack/unpack + type variants | (Point 4D / Edges / Corner Radius pack/unpack) | — | — | — |
| 113 | 04/25/2022 | **Blend modes for layers**; **AirPods motion tracking** in Device Motion (iOS); hover layer-preview icon on patches; more Patch Editor zoom levels; looped layers show Hover state | — | Blend modes | Zoom levels | — |
| 111 | 03/21/2022 | Minor | — | — | — | — |
| 110 | 03/07/2022 | **Game Controller L2/R2 progress values**; perf; peer-to-peer sharing fix in Origami Live; virtual soft keyboard | — | — | — | — |
| 109.1 | 02/23/2022 | New soft keyboard properties; **embedded Virtual Soft Keyboard in viewer ("no need for 'Fake Keyboard' patch anymore")**; ports expand on hover/edit | — | — | — | Fake Keyboard patch effectively deprecated |
| 108 | 02/09/2022 | Minor | — | — | — | — |

### 2021 (v80 to v107)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 107 | 01/27/2022 | Audio Metering for videos; **Snippets** (precomposed patch sets); duplicate ports via right-click in component info; JSON previews in ports | — | — | Snippets (removed in v177) | — |
| 104 | 12/20/2021 | **iPhone 13 devices**; network caching; more loop-aware patches; **Deceleration Rate in Scroll Settings** | — | — | — | — |
| 103 | 12/03/2021 | **Vertical Split View preference**; renderer sparse updates | — | — | Split orientation | — |
| 102 | 11/15/2021 | Perf, memory leaks | — | — | — | — |
| 101 | 11/01/2021 | Auto-removes duplicate resources (smaller files) | — | — | — | — |
| 100 | 10/18/2021 | **Reorder ports: ⌘↑/↓, ⌘⇧↑/↓** (Loop Builder, Option Picker, Math, Logic…); Samsung S10/S10+/S20/S20+; ~20% smaller binary | — | — | Port reordering | — |
| 99 | 10/05/2021 | Engine perf; canvas anchor manipulation; **"JavaScript patch multi-threading fix"** (a JS-backed patch existed before v126; INFERRED to be Math Expression, whose doc ID is `builtin.javascript.expression`); GPS fix; layer rasterization; virtual sublayer sync | — | — | — | — |
| 98 | 09/21/2021 | **Layer sizes as % of parent**; **"Replace with"** via right-click; **Container Components** ("Sublayer Container" layer + "Virtual Sublayer"); Equals Exactly added to comparable replacements | — | **Sublayer Container / Virtual Sublayer** | Replace-with | "Improve Resource management (backwards incompatible change)" |
| 97 | 09/08/2021 | Big perf gain on data patches; missing resources don't block opening; JSON→Number conversion | — | — | — | — |
| 94 | 07/26/2021 | Patch search animates scroll; alignment respects selected comments; JSON / quick interactions / component I/O arranged more clearly; double-click insertion on input ports pushes patches | — | — | — | — |
| 92 | 06/28/2021 | Patch autolayout renamed **"Tidy Up" (Control+T)**; value tracing for transition/animation patches; shortcut mappings in context menu | — | — | Tidy Up | — |
| 91 | 06/16/2021 | **Patch autolayout (beta)**; comments resizable from any edge; JSON perf; scroll-zoom on ⌘; drag-over-connection insertion behind ⌘; Classic Animation supports size | — | — | — | — |
| 90 | 06/02/2021 | Engine + renderer perf; Math Expression perf; scroll/pinch zoom fixes | — | — | — | — |
| 89.1 | 05/20/2021 | **SF Pro** default font; wireless receiver click bounces broadcaster; **middle-mouse panning**; ⌘-drag connection into multi-input patch pushes others; selected patch drawn in front; **drag a patch over a connection to insert it**; double-click insertion pushes patches; ungroup selects patches; click bound values bounces patches | — | — | Many graph UX | Renamed "Canvas & Patch Editor" → "Split View" |
| 88 | 05/05/2021 | Smarter component grouping; **Component Info popover: inputs grouped by category, multiselect drag/drop, detachable, resizable**; **millisecond output on Device Time** | — | — | — | — |
| 87 | 04/21/2021 | **Component System Publishing flow** (in-document); **Dark mode**; **Rasterize/Unrasterize layer hierarchies**; tags tied to types for component ports; **Portal and Portal Mini devices** | — | Rasterize | Dark mode | — |
| 86 | 04/05/2021 | Splitters named from connected ports; layer name shown outside container; Viewer default scale; patch aliases; Dimension/Spacing conversion; **Components can have examples** | — | — | — | — |
| 85 | 03/16/2021 | **Apple M1 support**; comparison view for upgrading components; cleaner version number | — | — | — | Apple silicon |
| 84 | 03/10/2021 | **Individual component upgrades**; builtin patches auto-upgrade; ultrawide window size; low-battery warning in Viewer | — | — | — | — |
| 83 | 02/22/2021 | Window menu shortcuts for Welcome sections; static preview images in patch docs; non-blocking component upgrade; iOS Viewer auto-closes previous file; When Prototype Starts fires on insertion | — | — | — | — |
| 82 | 02/09/2021 | **Combined picker for patches and layers**; **"Copy to Figma plugin now include Auto Layout information"**; Featured Templates; auto sizing on Video Stream layer | — | Video Stream auto sizing | Unified picker | — |
| 80 | 01/25/2021 | **macOS Big Sur redesign**; value popover without double-click; welcome progress indicator; **M1**; **Mouse Scrolling in Mouse patch**; **Loops of Loops**; Game Controller Home/Acceleration/rotation ports; segmented controls in inspector; ~18 fixes | — | — | Big Sur look | — |

### 2020 (v72 to v78)

| Ver | Date | Headline | New patches | New layers / layer caps | UI / workflow | Removed / platform / compat |
|---|---|---|---|---|---|---|
| 78 | 12/16/2020 | Preserve wireless receivers on copy/paste; Haptics + ViewFinder together (iOS 13+); **drag files from Origami to Finder**; preference to not play media on Canvas; **JSON as input for Text Attributes**; much faster screen recording | — | — | — | — |
| 76 | 11/21/2020 | **New Toolbar enabled by default**; **Loading output on Image layer**; **virtual cameras**; renames duplicated layers; editable component search keywords; one-click artboard selection; alpha 0–100 in color picker | — | Image loading output | New toolbar | — |
| 74 | 10/21/2020 | **Patch Output Popovers**; **new Interaction Handlers in Canvas**; better Patch Picker docs; **new Welcome Window (Patterns, Examples, Tutorials)**; ⌘+Scroll sensitivity; Viewer defaults to device size | — | — | Welcome window | — |
| 73 | 10/07/2020 | **Dual Camera** (iOS + macOS); recording improvements; component cleanup; better Smart Layout heuristics; emoji fixes in Text Length/Substring | — | — | — | — |
| 72 | 09/24/2020 | **New Cursor Patch**; recording perf/fidelity; upgraded Game Controller; **⌘+Scroll zoom in Canvas**; **custom AHAP haptics files**; better artboard positioning when pasting from Sketch/Figma; **New Color Picker (Experiments tab)**; Classic/Pop Animation support types like Position; **Device Info exposes dark mode**; **Encode/Decode base64**; Sound Player current time + duration; Visual Layout uses change sets; ~20 fixes (incl. "Ability to export as image layers outside artboards", "Crashing on High Sierra for the touch menu") | **Cursor** (docs: "Mouse Cursor"), **Encode**, **Decode** | — | Color picker | Still supported macOS 10.13 High Sierra (INFERRED from the fix) |

### 2.1 Cross-cutting tracks derived from the timeline

**Platform minimums** (VERIFIED): macOS 10.13 still supported at v72 (INFERRED from the High Sierra fix) → **10.15 at v120 (07/25/2022)** → **11.0 at v135 (02/21/2023)** → **12 at v177 (09/30/2024)**. Origami Live iOS: **13.4 at v120** → **15.1 at v193 (05/12/2025)**. Apple silicon: v80/v85. OS-specific fix waves: Big Sur (v80), Ventura (v137–138), Sonoma (v153–155), Tahoe (v198–v212).

**File-format compatibility** (VERIFIED): v98 backwards-incompatible resource management → v148 System Maker format removed → v160 warning to upgrade old files → v190 default save format `.origami` → **v204 last version to open pre-Oct-2023 files (internal file version 129)** → **v205 can no longer open ~2-year-old files**.

**Removed / deprecated** (VERIFIED): Fake Keyboard patch made unnecessary by the embedded soft keyboard (v109.1; patch still documented); old System Maker file format (v148); quick interactions on Canvas (v148); low-contrast patch option moved out of Experiments, now default (v153); Snippets (added v107, **removed v177**); macOS 11 (v177); in-app documentation (docs now open on the web, v177); "Text from JSON" renamed "JSON to Text" (v207); "Canvas & Patch Editor" renamed "Split View" (v89.1); "Wireless Broadcaster/Receiver" renamed "Variable Broadcaster/Receiver" (Variables doc, VERIFIED; release date not in notes).

**Devices** (VERIFIED): Portal and Portal Mini (v87); Samsung S10/S10+/S20/S20+ (v100); iPhone 13 (v104); iPhone 14 (v130), Space Black default (v176); "New Devices", default iPhone 17 Pro (v223).

**AI track** (VERIFIED): v221 JS Patch LLM generation → v223 Shader Layer LLM generation → v226 "sparkle menu" validation fix → v227 increased token limit "when using Anthropic provider".

**Rendering / visual track** (VERIFIED): Blend modes (v113) → Layer Effects patches + inspector port (v116) → Squircles (v125) → Lottie (v144) → Wide gamut (v189) → corner smoothing on all layers (v175) → Layer Effects on iOS + Plus Lighter/Darker + Blur Hard Edges (v217) → native Gradient type (v218) → pass-through blend (v219) → Clone Layer + Shader Layer (v220) → New Layer Effects + Liquid Glass (v221) → Reflective Layer configs (v224) → Variable fonts + font embedding (v226).

**Data / scripting track** (VERIFIED): base64 Encode/Decode (v72) → JSON Text Attributes (v78) → JS patch (v126) → enums in JS (v128) → Images in JS (v146) → Sound in Encode/Decode (v147) → longer requests (v148) → Sound/Video from Network Request (v149) → multipart (v150) → NDJSON (v189) → WebSockets (v191) → Object Join (v193) → Text to JSON (v207) → WebP in JS (v211) → JS timers (v215) → Visual JSON Editor (v216) → JS Http + Base64 (v217) → JS Variant (v219) → Copy-Paste As JSON + CLI file→JSON (v221).

---

## 3. Current feature inventory (as of Version 228, 09/07/2026)

The documented inventory comes from the official docs nav (VERIFIED). Newer items that appear only in release notes are flagged **[release-notes only]**.

### 3.1 App shell and panels
- Six main panels (VERIFIED, docs Introduction): **Canvas**, **Patch Editor**, **Layer List**, **Inspector**, **Viewer**, **Patch Library** (⌥⏎).
- Split View (horizontal or vertical, v103), New Toolbar (v76), Welcome Window with Patterns/Examples/Tutorials and Featured Templates (v74, v82), Dark mode (v87), accent color (v199), high-contrast patch style preference (v153).
- **Bottom HUD**: consoles, asset manager, loop counts, performance gauge, FPS counter (v107/v201). JavaScript Console (View > Hide/Show JavaScript Console; max 50 messages; `console.watch`). (VERIFIED)
- Asset Manager with usage tracking (v120, v122, v127). Layer Search by name and type (v136). Patch-graph search scoped to a layer (v180).
- **QuickLook Generation Plugin** for Finder previews, including video (v224) [release-notes only].
- **CLI to convert an Origami file to JSON** (v221) [release-notes only; command name/flags unknown].
- Internal codename "Diamond": custom devices install to `~/Library/Application Support/Diamond/Devices` (VERIFIED, Custom Devices doc).

### 3.2 Canvas and layout (VERIFIED, docs Canvas and Layout)
- Artboards sized from the toolbar's Device Size. Freeform drawing of shapes and text, live text editing, measurement guides, ⌘+Scroll zoom, middle-mouse panning.
- Layers: group (⌘G; groups have size and clip), mask (⌘⌥M alpha masks; add to mask ⌘⌥⇧M), lock, hide, reorder, rasterize/unrasterize (v87).
- **Layout** (Flexbox-like, enabled per Artboard/Group): Position **Relative | Absolute**; Size **Auto | Grow | Fixed** plus **percentage of parent** (v98); Direction **Horizontal | Vertical | Grid** (Grid needs a fixed width); Alignment (9-point anchor); Spacing **Between | Evenly | Fixed number**; Padding; Margins; **Cap & Baseline** text measuring toggle.
- Coordinates in pt/dp. Anchor points (0–1) and Pivot (0–1). Doc says the default origin is the screen center (see §4 for the conflict).
- Insert/paste into the selected group by default; Paste Over Selection (v167). Replace With… (v98). Reset to defaults (v199).

### 3.3 Layer types
Documented (VERIFIED, docs nav "Layers"): **Layer, Clone Layer, Color Fill, Gradient Fill, Group, Hit Area, Image File, Image Layer, Live Image, Lottie Animation, Map, Oval, Particle System, Progress Ring, Rectangle, Shader, Shape, Text Layer, Video File, Video Keyframes, Video Layer, Video Stream, Viewfinder.**
Material components (VERIFIED nav): Alert View, Checkbox, Circular Progress, Fake Keyboard, Page Control, Screen, Status Bar, Switch, Text Field.
iOS components (VERIFIED nav): Action Sheet, Activity Indicator, Alert View, Fake Keyboard, Navigation Bar, Notification, Page Control, Screen, Segmented Control, Slider, Status Bar, Switch, Tab Bar, Text Field, Visual Effect.
[release-notes only]: **Sublayer Container / Virtual Sublayer** (v98), **Reflective Layer** (v224), **3D groups** (v225 mention), **Liquid Glass** (v221; may be an effect rather than a layer type, INFERRED).

Common layer ports (VERIFIED, per-layer docs): Enable, Position (Point 3D for Z), Anchor, Size, Opacity, Scale, Rotation (Point 3D for X/Y rotation), Pivot, Shadow Color, Shadow Opacity (default 0 = off), Shadow Radius, Shadow Offset. Plus type-specific ports:
- Text Layer: Text, Font Name, Font Size (dp), Color, Character Spacing, Line Height, Paragraph Spacing (+ Style Override input, referenced by the Text Style doc).
- Image File: Image, Fill Style (fit | fill | stretch | tile).
- Video File: Video, Play, Fill Style, Video Rate, Loop, Scrub, Scrub Time, Volume (0–1), Playback (asynchronous | synchronous) → Current Time, Duration, Natural Size.
- Lottie Animation: Lottie Animation, Fill Style (fit | fill | stretch), Play, Rate (negative = backwards), Loop, Scrub, Scrub Time → Current Time, Duration, Natural Size. Accepts dotLottie directly or JSON via JSON to Lottie.
- Shape: Fill, Shape (path from shape patches), Stroke Color, Stroke Width (default 0), Start/End (0–1 stroke trim).
- Particle System: Color, Lifetime, Birthrate, Color Change, Velocity, Velocity Variance, Angle, Angle Range, Acceleration (vector), Size Delta, Image.
- Map: Map Center (lat/long), Map Span; [release-notes only] Appearance (v201), Point Of Interest show/hide (v166).
- Clone Layer: Layer (source). Live copy with independent transforms, opacity and effects; caveat: "The Clone layer must exist before its source layer in the layer hierarchy."
- Shader: Shader (SkSL code), Uniforms (doc says a JSON object; the concept doc says uniforms become ports).
- Gradient Fill: Type (linear | radial), Start/End Position, Start/End Color, Opacity.

Layer capabilities that are undocumented per layer but VERIFIED in release notes: **blend modes** (v113) incl. **Plus Lighter/Plus Darker** (v217) and **pass-through** (v219); **layer effects** port + effect patches (v116), **Blur with Hard Edges** (v217), "New Layer Effects" (v221), effects on iOS (v217); **independent corner radius** (v125 fixes) + **smooth corners / squircles** (v125) with **corner smoothing on all layers** (v175, clamped 0–1); **independent x/y/z scale** (v185); **text truncation** (v189); **variable fonts** + **font embedding** (v226); **wide-gamut images** (v189); **WebP** (v177); **120 fps** (v216).

### 3.4 Patches: documented library (VERIFIED, docs nav)
- **Animation**: Bouncy Converter, Classic Animation, Cubic Bezier Animation, Cubic Bezier Curve, Curve, Pop Animation, Repeating Animation, Smooth Value, Spring Animation, Spring Converter. [release-notes only]: **Fluid Spring Animation** (v223).
- **Color**: Color to HSL, Color to Hex, Color to RGB, Gradient Builder, HSL Color, Hex Color, RGB Color.
- **Data**: Array Append, Array Count, Array Join, Array Reverse, Array Sort, Decode, Encode, Get Keys, Index Of, JSON Array, JSON Object, JSON to Text, Network Request, Open URL, Set Value for Key, Settings JSON, Subarray, Value at Index, Value at Path, Value for Key, WebSocket Connection, WebSocket Receive, WebSocket Send. [release-notes only]: **Object Join** (v193), **Text to JSON** (v207).
- **Device**: Browser Buttons, Browser Chrome, Camera, Device Buttons, Device Info, Device Motion, Device Time, Game Controller, Haptic, Interface Orientation, Location, Microphone, Mouse Cursor, Sound Kit, Sound Player, Sound Player Settings, Touches, Trackpad, Trackpad Haptic, Vibrate. [release-notes only]: **Bluetooth LE patches** (v217), **Text To Speech** (v212).
- **Indicator** (nav heading).
- **Interaction**: Double Tap, Drag, Drag Settings, Gesture, Hover, Interaction, Keyboard, Long Press, Momentum Scrolling, Mouse, Pop Switch, Scroll, Scroll Settings, Scrollaway.
- **Logic**: And, Equals, Equals Exactly, Greater Than, Greater Than or Equal, Less Than, Less Than or Equal, Not, Or.
- **Loops**: Any, Grid Layout, Loop, Loop Builder, Loop Count, Loop Dedupe, Loop Filter, Loop Insert, Loop Insert at End, Loop Option Switch, Loop Over Array, Loop Remove, Loop Remove Last, Loop Reverse, Loop Select, Loop Shuffle, Loop Sum, Loop to Array, Running Total.
- **Math**: ÷, −, √, ×, +, Absolute Value, Arctangent, Cosine, Length, Math Expression, Max, Min, Mod, Power, Round, Sine.
- **Media**: Audio Metering, Photo Albums, Photo Library, Photo Library Media.
- **Progress** (heading); **Shapes**: Circle, Oval, Rounded Rectangle, Triangle, Union; **Structure** (heading).
- **Text**: Split Text, Text Ends With, Text Input Info, Text Length, Text Replace, Text Size, Text Starts With, Text Style, Text Style Builder, Text Transform, Trim Text. [release-notes only]: **Variable Font builder** (v226).
- **Utility**: Arc Transition, Clip, Comment, Convert Position (×2), Counter, Date & Time Formatter, Delay, Delay 1, Face Detection, Image, Image Info, JSON to Lottie, JSON to Shape, JavaScript Patch, Layer Info, Object Detection, Option Equals, Option Picker, Option Sender, Option Switch, Point, Point 3D, Point 3D Unpack, Point Unpack, Progress, Pulse, Pulse on Change, QR Code Detection, Random, Repeating Pulse, Restart Prototype, Reverse Progress, Sample and Hold, Snapshot, Spacing, Spacing Unpack, Splitter, Stopwatch, Switch, Time, Transition, Variable Broadcaster, Variable Receiver, Vec4, Vec4 Unpack, Velocity, Video, Video Info, Wait, When Prototype Starts. [release-notes only]: **Hand Detection** (v217); Layer Effects patches (v116/v221); Point 4D / Edges / Corner Radius pack/unpack (v114).
- Internal patch identifiers in doc URLs (useful naming precedent; VERIFIED, Appendix B): `builtin.*` (e.g. `builtin.javascript`, `builtin.javascript.expression`, `builtin.layer.shader`, `builtin.layer.clone`, `builtin.websocket.connect`, `builtin.network.request`, `builtin.structure.format`), `origami.*` (e.g. `origami.gridlayout`, `origami.loopsum`, `origami.soundkit`), `ios.*`, `material.*`, `fake_builtin.layer.*`.

Selected documented patch behaviors (VERIFIED):
- **Transition**: `output = start + progress × (end − start)`, unclamped (progress −.5 with 50→100 gives 25; progress 2 gives 150). Type-variant (number, position, color).
- **Smooth Value**: `next = prev × risingHysteresis + current × (1 − risingHysteresis)` when rising; Falling Hysteresis defaults to **−1** (= symmetric); Reset pulse.
- **Spring Animation**: inputs Number, Mass, Tension, Friction, Gesture Active, Gesture Velocity (sampled when Gesture Active goes On→Off, for throw continuation). Supports Point and Color since v120.
- **Network Request**: URL, URL Parameters (JSON), Body (JSON), Headers (JSON), Method (GET | POST), Content Type (Auto | application/json | multipart/form-data), Disable Timeout (default timeout **60 s**), Expect GraphQL Stream → Request (pulse), Loading, Result, Error (bool), Error (JSON). Type set by right-click: text, JSON, image, video, sound. Origami Live iOS supports HTTPS only.
- **WebSocket Connection**: Connect, URL, Headers → Connection, Connected, Error (cannot be looped). **Send**: Connection, Send (pulse), Message (text or JSON; loopable). **Receive**: Connection → Message (type-filtered; outputs a loop when several arrive in one frame).
- **Encode**: Input (image | JSON | text; Sound since v147), Queue → Loading, Text (base64).
- **Math Expression**: any JavaScript-valid expression over numbers; outputs named with `name =`; several outputs separated by `;`; edited via Patch Info (⌘I).
- **Camera**: Enable, Camera (front | back), Record Video, Capture Image (pulse) → Stream, Video, Image.
- **Time**: Time (s), Frame. **Device Time**: Seconds since epoch (+ ms output v88, + Enable v172, undocumented).

### 3.5 Patch editor mechanics (VERIFIED, docs + release notes)
- Ports: inputs on the left, outputs on the right. An output fans out to many inputs; an input takes one cable. Shift-click inputs to connect one output to several. Connections snap to the closest port (v160). Drag a patch onto a cable to insert it (v89.1). Option-drag a connection to empty space shows the suggested-patch picker (v203).
- Port value types (docs Patches page): Number, Boolean, Text, Image, Video, Sound, Color, Index, JSON, Point (2D/3D/4D). JS API types: NUMBER, PROGRESS, POSITION, SIZE, ANCHOR, POINT3D, POINT4D, COLOR, BOOLEAN, PULSE, INTEGER, ENUM, STRING, JSON, IMAGE, VARIANT. Also Gradient (v218), Edges, Corner Radius (v114), Lottie, shape.
- **Type variance** via right-click (change patch type), e.g. Transition, Pulse on Change, Loop Builder.
- **States and Pulses**: a state persists; a pulse is On for a single frame. A state wired into a pulse input infers a pulse on off→on. Since v187 a pulse can fire on consecutive frames.
- **Loops**: zero-indexed; green patches and green-tinted cables; Loop, Loop Builder, Loop Over Array; looped layers auto-arrange in Layout-enabled groups; loop-aware patches; Loops of Loops (v80); per-loop inspection (v172).
- **Variables**: Variable Broadcaster/Receiver (formerly Wireless). Scope Local or **Global**: globals cascade down the component hierarchy, and the nearest global broadcaster of the same name and type wins (overrides).
- Organization: rename (⇧⏎ or Enter), Comment patches (⌃⌥C; auto-grow v192), Tidy Up (⌃T), align ⌘[ ⌘] ⌘⇧[ ⌘⇧], port reorder ⌘↑/↓, value popovers, output popovers (v74), value tracing (v92), expanding ports (v115), Visual JSON Editor (v216).

### 3.6 Components and systems (VERIFIED)
- **Patch Components** (patches only; ⌃⌘G) and **Layer Components** (layers + patches). Enter ⌥↓ (docs) / double-click; exit ⌥↑. Published I/O = purple (input) and blue (output) patches; Publish Port ⌥P; Component Info ⇧⌘I (Port Setup tab: type, default, min, max; special tags such as Enable).
- **Container Components**: Sublayer Container + Virtual Sublayer (v98).
- Instances: Inspect Instance without unlinking (⌃⌥↓, v156/v173); Unlink from Library; instance counts (v128); rename propagation (v189); port categories for outputs (v172); component examples (v86); search keywords (v76); platform restriction (Patch Setup tab).
- Libraries: User Library (⌘⌥L), Other Library (⌘⌥⇧L), Show Patch Folder, loaded folders in Preferences.
- **Origami Systems**: Component > **Publish Components** (all components must live in one file); name, author, description; Advanced Options (System Identifier, version, icon, attached JSON for text styles, color libraries, data). Install by double-clicking or Preferences > Components "+". Shared-folder installs push updates and upgrade prompts; Check for Local Component Updates (v123); individual upgrades with comparison view (v84/v85).

### 3.7 JavaScript Patch (VERIFIED, Scripting Basics + JavaScript Patch API)
- Runtime: **Hermes** (ES6*). Add by dropping a `.js` file on the graph or via the Patch Picker. The script is an IIFE that must `return patch`.
- `new Patch()`; `patch.inputs = [new PatchInput(name, types.X, default?)]`; `patch.outputs = [new PatchOutput(name, type, default?)]` (set only at top level); `patch.loopAware` (default false; otherwise one JS environment per loop item); `patch.alwaysNeedsToEvaluate` (default false = evaluate only on input change); `patch.evaluate = function(){}`; `patch.type` (runtime type); `patch.variants` (array, >1 type, with at least one port `types.VARIANT`).
- `PatchInput`: `.value`, `.values` (loop array), `.defaultValue`, `.isDirty()`, `.readRising()`, `.readFalling()`. `PatchOutput`: `.value`, `.values`, `.pulse()`.
- `Image`: `new Image(arrayBuffer RGBA 0–255, w, h)`, `new Image(image, SIZE)` (resize), `new Image(SIZE)`; `.width`, `.height`, `.format`, `.getPixelAt(x,y)`, `.setPixelAt(x,y,color)` (only for JS-created images).
- `Http.request(method, url, opts)` → Promise with `.cancel()`; methods GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; opts: `headers`, `urlParameters`, `body` (string | object | ArrayBuffer), `contentType` ("json" | "formData"), `disableTimeout`, `responseType` ("raw" → ArrayBuffer, "image" → Image, omitted → HttpResponse), `onData` (stream chunks; NDJSON example also uses `graphqlStream: true`). Helpers `Http.get`, `Http.post`, `Http.getJson`, `Http.postJson(url, data, opts)`. `HttpResponse`: `.ok`, `.headers`, `.text()`, `.json()` (undefined on parse failure), `.arrayBuffer()`.
- `Base64.encode(string | ArrayBuffer | Image)` → Promise<string>; `Base64.decode(str, "text" | "arraybuffer" | "image")`.
- `variants` helpers: `isNumeric`, `isBoolean`, `isScalar`, `isVector`, `isVec2`, `isPoint`, `isPlusable`, `isNetworkType`, `isInterpolable`; constants `NUMERIC`, `SCALAR`, `VECTOR`, `VEC2`, `POINT`, `PLUSABLE`, `NETWORK`, `BASE64`, `INTERPOLABLE`.
- Timers `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` (v215) [release-notes only]; WebP reading (v211); enum support (v128).
- Console: `console.log`, `console.watch`; max 50 messages. No DOM/BOM, no modules or imports, no Sound/Video types. Edit via "Open in default editor" / "Open With"; the temp file is deleted when Origami closes.
- Duplicating a JS patch deep-copies the script (v177); wrap it in a component to share one script.
- **LLM generation integration** (v221) and increased token limit with the Anthropic provider (v227) [release-notes only].

### 3.8 Shader Layer (VERIFIED, Shader Layer concept + Shader patch doc)
- **SkSL** (Skia Shading Language), fragment shader only, ShaderToy-like environment. Entry point `half4 main(vec2 coords)`; coords in **pixels**, not normalized (`uv = fragCoord/iResolution.xy`). Origami works in points while the shader works in pixels.
- Injected uniforms: `float3 iResolution` (layer size in px, z=0), `uniform shader iImage1` (texture of the Shader Layer's child layers). Sample in local pixel coordinates with `iImage1.eval(coords)`.
- Uniform type map: float/half → FLOAT; int → INTEGER; float2/vec2/half2/int2 → VEC2; float3/vec3/half3/int3 → VEC3; float4/vec4/half4/int4 → VEC4; float2x2/half2x2/half3x3 → UNSTRUCTURED. `shader`, `colorFilter` and `blender` uniforms are unsupported. `layout(color) uniform half4 iColor;` → Color type (color-space aware).
- Default-value annotation: `//@origami default: 0.04` on the line above the uniform.
- Composition: nest Shader Layers to stack effects (costly). Syntax errors show with line numbers in the Shader Code editor ("Shader Code" button).
- [release-notes only]: "Shader Layer with Layer Inputs" (v220), LLM generation (v223), mixed-precision fix (v222), token limit with Anthropic (v227).

### 3.9 Viewer, recording, device preview, Origami Live (VERIFIED)
- Viewer shortcuts: ⌘R restart, ⌥D toggle device frame, ⌥H toggle hand, ⌘⌥F mini viewer, ⌘⇧F fullscreen, ⌘⌥0 1:1.
- Device picker with colors (undo, v203); default iPhone 17 Pro (v223); 120 fps (v216); embedded virtual soft keyboard (v109.1); Safe Area in Device Info (v114); Portal devices (v87).
- **Custom devices**: `.origamidevice` bundle with `info.json` (key, displayName, platform, type ∈ computer | phone | tablet | tv | watch | window | custom, screenScale, screenSize [pt], mouseInput, viewerWindowNative, deviceInsets, shadowOffset, deviceImages, deviceImageDefault, deviceImageOffset, deviceImageScale, deviceOverlayImages, handsImages, handsImageScale, handsImageOffset, handsOnTop, defaultDeviceOrientation, supportsDeviceOrientation*). Double-click to install or refresh.
- **Recording**: prototype recording with Advanced Recording (codec + quality, v159); external displays (v206).
- **Origami Live iOS** (App Store): v228.0, iOS 15.1+, iPhone/iPad/iPod touch, 189.7 MB, free, seller Meta Platforms. USB mirroring of the frontmost document with live updates; export a prototype to the device from the toolbar; open shared files (email, Dropbox, AirDrop); peer-to-peer sharing (v110). Layer Effects run on iOS since v217. Custom fonts: the docs say they aren't mirrored, but v226 adds font embedding.
- **Origami Live Android**: documented (Google Play + USB debugging). Uptodown lists v2.8.1 as a "Discontinued app"; my guessed Google Play ID returned 404. INFERRED effectively unsupported.
- Screen sharing on Zoom (v121); low-battery warnings (v84, v121).

### 3.10 Import (VERIFIED)
- **Sketch**: copy in Sketch (⌘C), paste into Origami (⌘V); text, images and gradients carry over (Getting Started tutorial).
- **Figma**: "Origami Pasteboard" plugin (Figma Community ID 832268423801619787): select frames or layers → "Copy Selected Layers" → paste. Copies custom shapes, frames, text, images, masks; only the **first** fill, stroke and shadow ("Origami doesn't support multiple fills, strokes, or shadows"). Corner smoothing (v180); Auto Layout info (v82, "Copy to Figma plugin now include Auto Layout information").
- Drag and drop images, video, sound, `.js`, Lottie/dotLottie JSON; file drag onto the layer list (v213); virtual cameras (v76).

### 3.11 Export and interchange (VERIFIED unless marked)
- Save as `.origami` (v190). Export to device (toolbar). Video recording. "Export as image layers outside artboards" (v72 fix) and "Export with device scale from the layer list" (v76 fix) show image export exists.
- Drag files from Origami to Finder (v78). **Copy-Paste As JSON** and **CLI to convert Origami file to JSON** (v221). QuickLook plugin (v224). Snapshot patch captures images (wide gamut, v189).
- Publish Components → Origami System file.
- Code export existed in **Origami 2.0 (2015)**; no Studio release note since v72 mentions code export (VERIFIED absence; INFERRED not a current Studio feature).

### 3.12 Plugins and extensibility (VERIFIED)
- No general third-party plugin API appears in any release note or doc. Extension points are: JavaScript patches, Shader layers, custom devices (`.origamidevice`), patch/component libraries and Systems, Settings JSON, the QuickLook generator (first-party), the Figma Pasteboard plugin (first-party, in Figma), and the CLI file→JSON (v221).
- Community precedent, **Kami** (github.com/alexwidua/kami): macOS menu-bar app generating JS Patches with GPT-4 and your own OpenAI key. Integrates via shortcut (default ⌘J, which emulates ⌘C to copy the patch) or "Open with … > Kami". Prepends a truncated JS Patch API doc (~2,000 input tokens) to every request.

### 3.13 Collaboration (VERIFIED absence, INFERRED conclusion)
- None of the 136 release notes mentions real-time multiplayer, cloud documents, comments-for-review, or version history. "Browse all versions" was disabled in v128 because it crashed.
- Sharing is file-based (AirDrop, email, Dropbox), Systems on shared folders auto-update teams, Origami Live export, recordings, Zoom screen share.

### 3.14 AI features (VERIFIED items + INFERRED mechanics)
- VERIFIED: "JavaScript Patch LLM generation Integration" (v221, 06/08/2026); "Shader Layer LLM generation Integration" (v223, 07/07/2026); "Fix sparkle menu validation." (v226); "Increased token limit for JS Patch and Layer Shader when using Anthropic provider." (v227).
- INFERRED: the AI entry point is a "sparkle" (✨) menu on the JS Patch and Shader Layer; the LLM provider is configurable (Anthropic named, so at least one other probably exists); generation writes JS or SkSL source, not whole patch graphs. There is no evidence of whole-prototype generation, graph editing by an agent, or MCP support.
- AI-adjacent machine-readable surfaces (VERIFIED): Copy-Paste As JSON, CLI file→JSON (v221).
- Docs: none of the fetched doc pages mentions LLM generation, providers, API keys or the sparkle menu (VERIFIED absence).

### 3.15 Keyboard shortcuts (consolidated; VERIFIED sources)
- From docs: ⌥⏎ Insert Patch; ⌘⏎ Insert Layer; ⌘/ Documentation. Single-key patch inserts: I Interaction, S Switch (the States doc shows ⇧S), A Pop Animation, C Classic Animation, T Transition, K Keyboard, D Delay, ⇧I Option Switch, O Option Picker, X Splitter, W Wireless Broadcaster, ⇧W Wireless Receiver, U Pulse, + Add, − Minus, * Multiply, / Divide, % Modulus, ⇧A AND, ⇧O OR, ⇧N NOT, E Equals, > Greater Than, < Less Than, ⇧R Progress, R Reverse Progress. Organizing: ⇧⏎ Rename; ⌘[ / ⌘] align left/right; ⌘⇧[ / ⌘⇧] align top/bottom; ⌥⌃C comment around; ⌃⌘G create component; ⌥P publish port; ⌥▼ / ⌥▲ enter/exit component; ⌘⇧I Patch/Layer Info; ⌘⇧A "Select All Patches" (docs); ⌘⌥L / ⌘⌥⇧L add to User / Other Library. Layers: ⇧⏎ rename; ⌘⇧H hide; ⌥L collapse; ⌘⇧L lock; ⌘⌥▲/▼ forward/backward; ⌘⌥⇧▲/▼ front/back; ⌘⌥M mask; ⌘⌥⇧M add to mask; ⌘G group; ⌘⇧G ungroup; ⌘⌃G layer component. Viewer: ⌘R, ⌥D, ⌥H, ⌘⌥F, ⌘⇧F, ⌘⌥0. Number inputs: ▲/▼ ±1, ⇧ ±10, ⌥ ±0.1. Canvas doc: ⌘⇧N layer insertion popover; ⌘⌥G group into component; ⌘⌥C add to library (conflicts, see §4).
- From release notes only: ⌃T Tidy Up (v92); ⌘↑/↓ and ⌘⇧↑/↓ reorder ports (v100); ⌘⇧A **deselect** all patches (v135); ⌃⌥↓ Inspect Instance (v156, v173); ⌥L collapse recursively (v173); ⌘7 toggle inspector (v198); Enter rename single patch (v208); Esc cancels shift-drag (v172); Option while dragging a connection to empty space → suggested patches (v203); middle mouse pan (v89.1); ⌘+Scroll zoom (v72/v91).

---

## 4. Where the docs are stale or inconsistent with the release notes

Every "doc says" item was VERIFIED by fetching the page on 2026-09-16. Every "release notes say" item is VERIFIED from the releases HTML.

### 4.1 Docs that are current (for calibration)
Updated recently and consistent with 2025–2026 releases (VERIFIED): **Shader Layer** concept + Shader patch (v220+), **Clone Layer** (v220), **WebSockets** (v191), **JavaScript Patch API** (Http, Base64, variants: v217/v219), **Scripting Basics** network/base64/type-variance sections, **Smooth Value** rising/falling hysteresis (v204), **Network Request** (Disable Timeout v148, multipart v150, Expect GraphQL Stream ~v189), **JSON to Text** naming (v207), **Lottie Animation / JSON to Lottie** (v144), **Gradient Builder** (INFERRED ~v218), **Variables** (global scope). Branding now reads "Meta" and "Copyright © Meta".

### 4.2 Stale or missing, feature by feature

| # | Area | Docs currently say / show | Release notes say | Verdict |
|---|---|---|---|---|
| 1 | AI generation | Nothing about LLM generation, sparkle menu, providers, token limits (Scripting Basics, JS API, JS patch, Shader pages) | v221 JS LLM generation; v223 Shader LLM generation; v226 sparkle menu; v227 Anthropic provider | **Missing** |
| 2 | JS patch duplication | "Duplicated JavaScript Patches point to the same file source. Therefore modifying the file would have effect in all those same patches." | v177: duplicating deep-copies the script; group into components to share | **Stale** |
| 3 | JS timers | JS API documents no timers | v215 setTimeout/setInterval/clearTimeout/clearInterval | **Missing** |
| 4 | Shader uniforms | Concept doc: uniforms become input ports; Shader patch doc: "Uniforms: A JSON object"; patch doc links "Shader Basics" (nav title is "Shader Layer") | v220 "Shader Layer with Layer Inputs" | **Internally inconsistent / partial** |
| 5 | System Maker | "Origami still supports legacy System Maker files" | v148 "Removed support for the old Origami System Maker file format" | **Stale** |
| 6 | Custom fonts on device | "Origami Studio doesn't mirror custom fonts to your device" + Apple Configurator/AnyFont workaround | v226 "Ability to Embed fonts into a prototype"; variable fonts | **Stale (INFERRED embedding fixes on-device fonts)** |
| 7 | Android Origami Live | Google Play download, Developer Mode/USB Debugging steps | No Android release notes; Uptodown "Discontinued app" (v2.8.1); guessed Play URL 404 | **Probably stale (INFERRED)** |
| 8 | Quick interactions / Touch button | Introduction and Interactions pages: "hover on it and click the Touch button to select from … Tap, Scroll, or Swipe" | v148 "Removed quick interactions from Canvas" | **Probably stale (a layer-list Touch button may still exist; INFERRED)** |
| 9 | Fake Keyboard | Fake Keyboard (iOS and Material) still in the nav; the `ios.fakekeyboard` page body is **empty** | v109.1 embedded soft keyboard, "no need for 'Fake Keyboard' patch anymore" | **Stale / broken page** |
| 10 | Wireless naming | Keyboard Shortcuts and Patch Organization: "Wireless Broadcaster (W) / Wireless Receiver (⇧W)" | Variables doc: renamed to Variable Broadcaster/Receiver | **Inconsistent naming** |
| 11 | ⌘⇧A | Keyboard Shortcuts: "⌘⇧A Select All Patches" | v135 "Added CMD+SHIFT+A to deselect all patches" | **Conflict** |
| 12 | Missing shortcuts | Shortcuts page lacks ⌃T Tidy Up, ⌘7 inspector, ⌃⌥↓ Inspect Instance, ⌘↑/↓ port reorder, Enter rename, Option-drag suggestions | v92, v198, v156/v173, v100, v208, v203 | **Missing** |
| 13 | Library shortcut and insertion | Canvas doc: "Add it to your Library … ⌘⌥C", "⌘⇧N" layer popover, "⌘⌥G" component | Components/Shortcuts docs: ⌘⌥L, ⌘⏎, ⌃⌘G | **Internally inconsistent** |
| 14 | Component updating | "Close and re-open any documents using this patch group … Origami Studio will prompt you to upgrade" | v83 non-blocking upgrade flow; v84 individual upgrades; v85 comparison view; v123 Check for Local Component Updates without reopening; v195 library warnings | **Stale** |
| 15 | Component features | No port categories, Inspect Instance, Container Components/Sublayer Container, rename propagation | v172, v156, v98, v189 | **Missing** |
| 16 | Layer property docs | Rectangle/Group/Text/Image/Video/Shape port lists show only transform, shadow and basic fill/text ports | Blend modes (v113, v217, v219), Layer Effects port (v116, v221), corner radius + smoothing (v125, v175), independent xyz scale (v185), text truncation (v189), variable/embedded fonts (v226), rasterize (v87), percentage sizing (v98) | **Missing** |
| 17 | Patches with no doc page | Not in docs nav | Text To Speech (v212), Bluetooth LE (v217), Hand Detection (v217), Fluid Spring Animation (v223), Object Join (v193), Text to JSON (v207), Variable Font builder (v226), Layer Effects patches (v116/v221), Point 4D/Edges/Corner Radius pack/unpack (v114) | **Missing** |
| 18 | Layers/features with no doc page | Not in docs | Reflective Layer (v224), Liquid Glass (v221), Sublayer Container/Virtual Sublayer (v98), 3D groups (v225) | **Missing** |
| 19 | App features with no doc page | Not in docs | Visual JSON Editor (v216), Copy-Paste As JSON + CLI (v221), QuickLook plugin (v224), Bottom HUD (v201), Asset Manager (v120), Layer Search (v136), Tidy Up (v92), Advanced Recording (v159), Reset to defaults (v199), 120 fps (v216) | **Missing** |
| 20 | Device Info | Ports: Screen Size, Screen Scale, Orientation, Uses a Mouse, Device | + Dark mode (v72), + Safe Area (v114) | **Stale** |
| 21 | Round | Input → Rounded, Rounded Down, Rounded Up | v195 new "places" port | **Stale** |
| 22 | Map layer | Enable, Opacity, Position, Scale, Rotation, Pivot, Map Center, Map Span | v166 Point Of Interest show/hide; v201 Appearance property | **Stale** |
| 23 | Time / Device Time | Time: Time, Frame. Device Time: Seconds | v172 Enable port on both; v88 millisecond output on Device Time | **Stale** |
| 24 | Mouse | Down, Location only | v80 Mouse Scrolling; v199 right/middle-click position | **Stale** |
| 25 | Keyboard patch | Key (text), Down | v114 Arrow keys + modifier keys; v138 right-side modifiers | **Partially stale** |
| 26 | Game Controller | L2/R2 described as booleans; no Home, Acceleration, rotation | v80 Home/Acceleration/rotation; v110 L2/R2 progress values | **Stale** |
| 27 | Device Motion | Acceleration, Rotation Rate | v113 AirPods motion tracking (iOS) | **Missing** |
| 28 | Camera | Camera front/back, Record Video, Capture Image | v73 Dual Camera; v182 quality presets | **Missing** |
| 29 | Encode | "Encodes an image, JSON or plain text" | v147 Sound type | **Stale** |
| 30 | Value for Key | "Use a Splitter to cast the output to the expected type." (JSON output) | v153 multiple types | **Stale** |
| 31 | Option Equals | Doc page is "Option Equals (Legacy) … Use the new Option Equals instead" | v205: returns −1 when no option matches; v206 type-variant fix | **Missing (new patch undocumented)** |
| 32 | Pulses | "pulses are On ✓ only for a single frame" (no re-pulse semantics) | v187: pulses can fire on consecutive frames | **Incomplete** |
| 33 | Coordinates | "By default, the origin (x: 0, y: 0) is in the center of the device screen"; example device iPhone 7 | Shader doc: "Origami's coordinate system is Top-Left (0,0)" (pixel space); default device iPhone 17 Pro (v223) | **Inconsistent / dated examples** |
| 34 | Previewing | USB mirroring only | v110 peer-to-peer sharing in Origami Live | **Incomplete (INFERRED)** |
| 35 | Network Request method | Patch: GET or POST only | JS Http supports PUT/DELETE/PATCH/HEAD/OPTIONS (JS API doc) | **Different capability by surface (VERIFIED both)** |
| 36 | Tutorials/Examples | Sketch-first Getting Started; examples use Studio 3-era patches ("iTunes App Store", "Fake Keyboard") | Figma-era workflow, JS/Shader/AI features | **Dated** |
| 37 | Branding/versioning | Site header "Origami Studio 3" | Build versions 72→228; no "Studio 4" | **Naming frozen at "3"** |
| 38 | Loops | Loop, Loop Builder, Loop Over Array; looped components | v80 Loops of Loops; v172 per-loop inspection | **Incomplete (INFERRED; only the first ~3,500 chars were reviewed)** |

### 4.3 Anomalies inside the release notes themselves (VERIFIED)
- v201 (09/02/2025) repeats v107's (01/27/2022) first bullets word for word ("Bottom HUD with consoles, asset manager, loop counts, performance gauge, FPS counter"; "Tooltip with index number for Enum popups."). Either a re-launch or a copy-paste error (INFERRED).
- v103 and v104 share three identical Fixes bullets; v119 and v120 share "Ability to copy/paste ports from the Component Popover Editor."
- v214 has no notes. v168's "Ability to preview JSON Ports." is filed under Fixes.
- v163 "AUTO would show on Components that support it." is oddly worded (a fix).
- v99 fixes a "JavaScript patch multi-threading" issue a year before v126 "Released the new JavaScript patch".
- v82 says "Copy to Figma plugin" while the only first-party Figma plugin is "Origami Pasteboard" (Figma → Origami); direction ambiguous (INFERRED).

---

## 5. Implications for our open-source, AI-native Origami alternative

1. **Parity baseline.** Must-haves for 2026 parity: patch graph with type variance, loops, pulses/state, global variables, components with published ports/categories and systems; flexbox-like layout; the §3.3 layer set incl. Lottie, Clone, Shader (SkSL-like), blend modes (normal through plus-lighter/darker, pass-through), layer effects (blur with hard edges), squircle corner smoothing, gradients as a native type, variable fonts and font embedding; data (HTTP, NDJSON, multipart, WebSockets, JSON editing); a JS scripting node with timers, HTTP, base64, images and variants; device preview on phones at 120 fps; recording.
2. **Origami's AI is narrow.** It generates single JS-patch or shader source through a "sparkle" menu with a pluggable provider (Anthropic is one). Nothing indicates graph-level generation, agent editing, or MCP. That leaves the AI-native position open: expose the whole document (layers, patches, connections, components, variables) as MCP tools and resources for Claude, with transactional edits, validation, and graph diff/undo.
3. **Open, text-first file format.** Meta only recently added "Copy-Paste As JSON" and a CLI file→JSON (v221), which tells us machine readability is in demand. Make JSON (or a JSON-compatible schema) the native `.origami`-equivalent format, versioned, with a migration story. Origami's own history shows the cost of breaking changes: backwards-incompatible resource management (v98), System Maker format removal (v148), dropping pre-Oct-2023 files (v205).
4. **Shader and scripting nodes built for LLMs.** Borrow proven ergonomics: auto-exposed uniforms as typed ports, `//@origami default:`-style annotations, injected `iResolution`/child-texture uniform, ShaderToy-like pixel coordinates; the JS API pattern (`inputs`/`outputs`/`evaluate`/`loopAware`/`alwaysNeedsToEvaluate`/`variants`). Ship compact, current API docs meant for prompt injection (Kami needed ~2,000 tokens of truncated docs).
5. **Docs as a product.** Origami's docs drift badly (38+ gaps in §4). Generate node and layer reference pages from the same schema that defines ports, so docs, MCP tool schemas and UI never diverge, and give every node an ID (Origami uses `builtin.*`, `origami.*`, `ios.*`, `material.*`).
6. **Accessibility and learnability.** Origami's UX investment (Tidy Up, snap-to-port, suggested patches, drag-onto-cable insertion, per-loop inspection, Bottom HUD with FPS/perf) is expected table stakes. Add agent-explainable graphs ("why is this layer moving?") on top of value tracing.
7. **Import paths matter.** Figma import today goes through a clipboard plugin that keeps only the first fill, stroke and shadow; Sketch is copy/paste. A better Figma importer (multiple fills, strokes, effects, auto layout mapped to layout) is a clear advantage.
8. **Device preview.** Origami Live is iOS-only in practice (Android appears discontinued). A web/PWA or cross-platform viewer (iOS, Android, web) would widen reach.
9. **Collaboration gap.** No multiplayer, cloud docs, comments, or version history in Origami. Collaboration, including agent-as-collaborator, is a differentiator.
10. **Licensing hygiene.** Reimplement behaviors from these public notes and docs only. Avoid Meta's names where they are trademarks ("Origami", "Origami Live"); generic node names (Transition, Switch, Pop Animation) are descriptive, but consider neutral names for Meta-branded pieces (e.g., "Pop" relates to Facebook's Pop framework).

---

## 6. Open questions (could not be verified this session)
1. Which LLM providers can be chosen (Meta Llama? OpenAI? Anthropic only?), is it bring-your-own-key, and what does the sparkle menu UI look like? (No docs; v227 names only "Anthropic provider".)
2. What is the CLI's name, invocation and JSON schema (v221)? Does "Copy-Paste As JSON" round-trip, and is JSON also accepted on paste?
3. Liquid Glass (v221) and Reflective Layer (v224): are they layer types, effects or material properties, and which parameters do they have?
4. Names and ports of the Layer Effects patches (v116, "New Layer Effects" v221), the Bluetooth LE patches, Hand Detection, Text To Speech, Fluid Spring Animation (its spring formula), and Variable Font builder.
5. Detailed pre-v72 release notes (2016–2020): the Wayback Machine was offline, and Facebook Notes posts are behind a login.
6. Is Android Origami Live officially discontinued, and when?
7. What is "Shader Layer with Layer Inputs" (v220): multiple input textures (iImage2…) or layer-referencing ports?
8. What does "3d groups" (v225) cover (3D transforms or perspective containers)?
9. Did v201 truly re-ship the Bottom HUD, or is that bullet a duplicate?
10. Is there any real-time collaboration or cloud feature inside Meta's internal build that isn't in public notes? (Out of scope; no evidence.)

---

## Appendix B. Documented patch/layer identifiers (from docs nav URLs, VERIFIED)
Non-`builtin` IDs and concept/workflow paths:
`documentation/canvas/canvas`, `canvas/layout`, `concepts/coordinates`, `concepts/loops`, `concepts/mathexpressions`, `concepts/pulsesignal`, `concepts/scriptingapi`, `concepts/scriptingbasics`, `concepts/shaderlayer`, `concepts/variables`, `concepts/websockets`, `patch-editor/animations`, `patch-editor/interactions`, `patch-editor/patches`, `patch-editor/states`, `workflow/components`, `workflow/customdevices`, `workflow/keyboardshortcuts`, `workflow/patchorganization`, `workflow/previewsharing`, `workflow/systemcreation`; patches `fake_builtin.layer.emptyimage`, `fake_builtin.layer.emptyvideo`, `fake_builtin.layer.liveimage`, `ios.actionsheet`, `ios.activityindicator`, `ios.alertview`, `ios.fakekeyboard`, `ios.navigationbar`, `ios.notification`, `ios.pagecontrol`, `ios.screen`, `ios.segmentedcontrol`, `ios.slider`, `ios.statusbar`, `ios.switch`, `ios.tabbar`, `ios.textfield`, `ios.visualeffectview`, `material.alertview`, `material.checkbox`, `material.fakekeyboard`, `material.pagecontrol`, `material.progressring`, `material.screen`, `material.statusbar`, `material.switch`, `material.textfield`, `origami.arctransition`, `origami.doubletap`, `origami.drag`, `origami.drag-settings`, `origami.gridlayout`, `origami.haptic.ios`, `origami.haptic.macos`, `origami.hitarea`, `origami.legacyscrollaway`, `origami.longpress`, `origami.loopoptionswitch`, `origami.loopsum`, `origami.popswitch`, `origami.progressring`, `origami.reverseprogress`, `origami.settingsjson`, `origami.soundkit`, `origami.soundplayer.settings`, `origami.velocity`, `origami.vibrate`, `origami.viewfinder`.

`builtin.*` IDs (verbatim list):

builtin.audiometering builtin.bouncy builtin.bouncyconverter builtin.browser.buttons builtin.browser.chrome builtin.camera builtin.classicanimation 
builtin.color.hex builtin.color.hsl builtin.color.rgb builtin.color.tohex builtin.color.tohsl builtin.color.torgb builtin.comment builtin.compare.eq 
builtin.compare.equalapprox builtin.compare.gt builtin.compare.gteq builtin.compare.lt builtin.compare.lteq builtin.convertposition builtin.counter 
builtin.cubicanimation builtin.cubicbezier builtin.curve builtin.data.base64.decode builtin.data.base64.encode builtin.delay builtin.delay1 
builtin.demultiplexer builtin.devicebutton builtin.deviceinfo builtin.deviceorientation builtin.facedetection builtin.gamecontroller builtin.getpoint 
builtin.getpoint3d builtin.getspacingvec2 builtin.getvec4 builtin.gps builtin.gradient.builder builtin.image builtin.indexswitch builtin.javascript 
builtin.javascript.expression builtin.keyboard builtin.layer.clone builtin.layer.convertposition builtin.layer.ellipse builtin.layer.fill builtin.layer.gesture 
builtin.layer.gradient builtin.layer.hls builtin.layer.hover builtin.layer.image builtin.layer.imageinfo builtin.layer.interaction builtin.layer.keyframes 
builtin.layer.layer builtin.layer.lottie builtin.layer.particle builtin.layer.rectangle builtin.layer.scroll builtin.layer.scroll.settings builtin.layer.shader 
builtin.layer.shape builtin.layer.size builtin.layer.staticmap builtin.layer.text builtin.layer.textinput.info builtin.layer.video builtin.layer.videoinfo 
builtin.logic.and builtin.logic.not builtin.logic.or builtin.loop builtin.loop.any builtin.loop.builder builtin.loop.count builtin.loop.fromarray 
builtin.loop.mutations.append builtin.loop.mutations.dedupe builtin.loop.mutations.delete builtin.loop.mutations.insert builtin.loop.mutations.remove 
builtin.loop.mutations.reverse builtin.loop.mutations.shuffle builtin.loop.select builtin.loop.selectreorder builtin.loop.sum builtin.loop.toarray 
builtin.makespacingvec2 builtin.math.abs builtin.math.add builtin.math.atan builtin.math.cos builtin.math.div builtin.math.length builtin.math.max 
builtin.math.min builtin.math.mod builtin.math.mul builtin.math.pow builtin.math.round builtin.math.sin builtin.math.sqrt builtin.math.sub builtin.microphone 
builtin.momemtumscrolling builtin.motion builtin.mouse builtin.mousecursor builtin.multiplexer builtin.network.request builtin.open.url builtin.optionequals 
builtin.photoalbums builtin.photolibrary builtin.photomediainfos builtin.point builtin.point3d builtin.progress builtin.pulse builtin.pulseonchange 
builtin.pulseonstart builtin.qrdetection builtin.random builtin.range builtin.repeatingmotion builtin.repeatingpulse builtin.restart.prototype 
builtin.saliencydetection builtin.sample builtin.shape.circle builtin.shape.ellipse builtin.shape.roundrect builtin.shape.triangle builtin.shape.union 
builtin.smoothvalue builtin.snapshot builtin.soundplayer builtin.splitter builtin.springanimation builtin.springconverter builtin.stopwatch 
builtin.structure.array.append builtin.structure.array.builder builtin.structure.array.index builtin.structure.array.indexof builtin.structure.array.join 
builtin.structure.array.keys builtin.structure.array.reverse builtin.structure.array.sort builtin.structure.count builtin.structure.dictionary.key 
builtin.structure.format builtin.structure.lottie builtin.structure.object builtin.structure.path builtin.structure.setobjectforkey builtin.structure.shape 
builtin.structure.subarray builtin.switch builtin.textlength builtin.textprefix builtin.textreplace builtin.textsize builtin.textsplitbytoken builtin.textstyle 
builtin.textstylebuilder builtin.textsubstring builtin.textsuffix builtin.texttransform builtin.time builtin.time.device builtin.time.formatter builtin.touches 
builtin.trackpad builtin.transition builtin.vec4 builtin.video builtin.waittimer builtin.websocket.connect builtin.websocket.receive builtin.websocket.send 
builtin.wirelessbroadcaster builtin.wirelessreceiver

---

## Appendix A. Release notes

The full release history is published by Meta at https://origami.design/releases/. This report summarizes it in section 2 rather than reproducing it.

## Appendix C. Source URLs
- https://origami.design/releases/ (primary; raw HTML parsed)
- https://origami.design/ (homepage; "Origami Studio 3"; performance claims)
- https://origami.design/documentation/ (docs nav)
- https://origami.design/documentation/concepts/shaderlayer
- https://origami.design/documentation/concepts/scriptingbasics
- https://origami.design/documentation/concepts/scriptingapi
- https://origami.design/documentation/concepts/websockets
- https://origami.design/documentation/concepts/variables
- https://origami.design/documentation/concepts/loops
- https://origami.design/documentation/concepts/pulsesignal
- https://origami.design/documentation/concepts/mathexpressions
- https://origami.design/documentation/concepts/coordinates
- https://origami.design/documentation/canvas/canvas
- https://origami.design/documentation/canvas/layout
- https://origami.design/documentation/patch-editor/patches
- https://origami.design/documentation/patch-editor/interactions
- https://origami.design/documentation/patch-editor/states
- https://origami.design/documentation/patch-editor/animations
- https://origami.design/documentation/workflow/components
- https://origami.design/documentation/workflow/systemcreation
- https://origami.design/documentation/workflow/previewsharing
- https://origami.design/documentation/workflow/keyboardshortcuts
- https://origami.design/documentation/workflow/patchorganization
- https://origami.design/documentation/workflow/customdevices
- https://origami.design/documentation/patches/builtin.javascript
- https://origami.design/documentation/patches/builtin.layer.clone
- https://origami.design/documentation/patches/builtin.layer.shader
- https://origami.design/documentation/patches/builtin.network.request
- https://origami.design/documentation/patches/builtin.layer.layer
- https://origami.design/documentation/patches/builtin.layer.text
- https://origami.design/documentation/patches/builtin.layer.rectangle
- https://origami.design/documentation/patches/builtin.layer.image
- https://origami.design/documentation/patches/builtin.layer.video
- https://origami.design/documentation/patches/builtin.layer.lottie
- https://origami.design/documentation/patches/builtin.layer.shape
- https://origami.design/documentation/patches/builtin.layer.particle
- https://origami.design/documentation/patches/builtin.layer.staticmap
- https://origami.design/documentation/patches/builtin.layer.gradient
- https://origami.design/documentation/patches/builtin.gradient.builder
- https://origami.design/documentation/patches/builtin.springanimation
- https://origami.design/documentation/patches/builtin.smoothvalue
- https://origami.design/documentation/patches/builtin.transition
- https://origami.design/documentation/patches/builtin.math.round
- https://origami.design/documentation/patches/builtin.deviceinfo
- https://origami.design/documentation/patches/builtin.time
- https://origami.design/documentation/patches/builtin.time.device
- https://origami.design/documentation/patches/builtin.optionequals
- https://origami.design/documentation/patches/builtin.mouse
- https://origami.design/documentation/patches/builtin.keyboard
- https://origami.design/documentation/patches/builtin.gamecontroller
- https://origami.design/documentation/patches/builtin.motion
- https://origami.design/documentation/patches/builtin.camera
- https://origami.design/documentation/patches/builtin.data.base64.encode
- https://origami.design/documentation/patches/builtin.structure.dictionary.key
- https://origami.design/documentation/patches/builtin.structure.format
- https://origami.design/documentation/patches/builtin.structure.lottie
- https://origami.design/documentation/patches/builtin.soundplayer
- https://origami.design/documentation/patches/builtin.textstyle
- https://origami.design/documentation/patches/builtin.javascript.expression
- https://origami.design/documentation/patches/ios.fakekeyboard (empty body)
- https://origami.design/tutorials/ ; https://origami.design/examples/ ; https://origami.design/patterns/
- https://origami.design/tutorials/getting-started/getting-started
- https://apps.apple.com/us/app/origami-live/id942636206
- https://engineering.fb.com/ios/introducing-origami-live/
- https://thenextweb.com/news/facebook-origami-studio
- https://x.com/facebookorigami/status/720358764411375617 (decoded 2016-04-13)
- https://x.com/facebookorigami/status/999751605284057089 (decoded 2018-05-24)
- https://x.com/facebookorigami/status/1296533685068533760 (decoded 2020-08-20)
- https://prototypr.io/toolbox/origami-3-beta
- https://figmaelements.com/plugins/origami-pasteboard/ (mirror of https://www.figma.com/community/plugin/832268423801619787/origami-pasteboard)
- https://github.com/alexwidua/kami ; https://kami.alexwidua.com/
- https://origami-live.en.uptodown.com/android/download
