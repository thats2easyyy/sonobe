# Origami Studio: Application UI, Controls & Interaction Design

Clean-room research report for an open-source, AI-native alternative to Meta's Origami Studio.

- Research date: 2026-09-16
- Latest Origami Studio build seen: **Version 228, 09/07/2026** ("Minor bugfixes"). VERIFIED ([release notes](https://origami.design/releases/))
- Latest Origami Live (iOS) seen: **228.0 (September 7)**, requires iOS 15.1+. VERIFIED ([App Store](https://apps.apple.com/us/app/origami-live-design-prototyping/id942636206))
- Method: I downloaded the raw HTML of origami.design documentation, tutorials, and the complete release notes page (v72, 09/24/2020 through v228, 09/07/2026), converted them to text, and read them in full. I also used web search, Meta posts, third-party cheat sheets and blogs. I did not install any software or copy any code or assets.
- Legend: **VERIFIED** means I saw it in the cited source. **INFERRED** means I reasoned it from indirect evidence (explained each time). **CONFLICT** means sources disagree, with notes on which is likelier to be current.

> Note on sources: the origami.design docs and tutorials are largely frozen at about 2018–2021. Many screenshots and shortcuts come from Origami Studio 1.x/2.x. The release notes page is the most current source and has been updated roughly every two weeks through 2026. When a doc and a release note disagree, this report treats the release note as correct and marks the doc claim as stale.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Platform, file format, distribution](#2-platform-file-format-distribution)
3. [Window layout and chrome](#3-window-layout-and-chrome)
4. [Toolbar, Welcome Window, Preferences, HUD, consoles](#4-toolbar-welcome-window-preferences-hud-consoles)
5. [Layer List (Layers panel)](#5-layer-list-layers-panel)
6. [Canvas (design surface)](#6-canvas-design-surface)
7. [Layout system (auto layout)](#7-layout-system-auto-layout)
8. [Inspector](#8-inspector)
9. [Color picker, font picker, value popovers](#9-color-picker-font-picker-value-popovers)
10. [Patch Editor (node graph)](#10-patch-editor-node-graph)
11. [Patch Library / Patch Picker (insert menu)](#11-patch-library--patch-picker-insert-menu)
12. [Wiring: connections, cables, modifiers](#12-wiring-connections-cables-modifiers)
13. [Selection, organization, comments, Tidy Up, variables](#13-selection-organization-comments-tidy-up-variables)
14. [Layer-to-patch bridges: Touch button, property patches, bindings](#14-layer-to-patch-bridges-touch-button-property-patches-bindings)
15. [Components, Systems, libraries](#15-components-systems-libraries)
16. [States and animation model (as surfaced in UI)](#16-states-and-animation-model-as-surfaced-in-ui)
17. [Viewer (preview window)](#17-viewer-preview-window)
18. [Devices, frames, screen sizes, coordinates](#18-devices-frames-screen-sizes-coordinates)
19. [Recording and exporting](#19-recording-and-exporting)
20. [Origami Live (device preview and sharing)](#20-origami-live-device-preview-and-sharing)
21. [Import: Figma, Sketch, files, JSON](#21-import-figma-sketch-files-json)
22. [Layer types and their properties](#22-layer-types-and-their-properties)
23. [Patch categories and port types](#23-patch-categories-and-port-types)
24. [Visual style: theme, patch colors, cable colors](#24-visual-style-theme-patch-colors-cable-colors)
25. [AI features inside Origami (2026)](#25-ai-features-inside-origami-2026)
26. [COMPLETE keyboard shortcut compendium](#26-complete-keyboard-shortcut-compendium)
27. [Docs vs release notes: staleness and conflicts](#27-docs-vs-release-notes-staleness-and-conflicts)
28. [Implications for our product (parity checklist and AI-native opportunities)](#28-implications-for-our-product)
29. [Open questions](#29-open-questions)
30. [Sources](#30-sources)

---

## 1. Executive summary

- Origami Studio is a **free, macOS-only** prototyping tool by Meta. It has six panels: **Canvas, Patch Editor, Layer List, Inspector, Viewer, Patch Library**. VERIFIED ([docs intro](https://origami.design/documentation/))
- The core loop is **"ISAT": Interaction → Switch → Animation → Transition → layer property**. VERIFIED ([Animations doc](https://origami.design/documentation/patch-editor/animations): "Interaction, Switch, Animation, Transition (ISAT) are your bread and butter")
- Three direct-manipulation bridges between layers and logic make it approachable:
  1. Hover a layer in the Layer List and click the **Touch** button, then pick Tap, Scroll X, Scroll Y, etc. A pre-wired patch appears.
  2. **Click any property in the Inspector.** A blue "layer property patch" appears in the graph.
  3. **Drag a cable from a patch output onto an Inspector property or a layer name** in the Layer List. The layer row expands to show its properties.

  All three VERIFIED ([Canvas doc](https://origami.design/documentation/canvas/canvas), [Getting Started](https://origami.design/tutorials/getting-started/getting-started)).
- Speed comes from:
  - single-key patch insertion (I, S, A, C, T, …)
  - ⌥⏎ to open the patch picker
  - hover-a-port-and-press-a-key insertion (e.g. `s` inserts a Splitter)
  - Option-drag to duplicate while keeping input connections
  - ⌘-drag to insert into multi-input patches
  - dropping a patch onto a cable to splice it in
  - Tidy Up (⌃T)

  VERIFIED across docs and release notes.
- Recent direction (2024–2026 release notes):
  - Shader Layer (SkSL) and Clone Layer
  - Layer Effects, blend modes, **Liquid Glass**
  - **LLM generation for JavaScript Patch (v221) and Shader Layer (v223)**
  - Copy-Paste as JSON and a **CLI to convert Origami files to JSON (v221)**
  - Visual JSON editor, 120 fps, variable fonts, embedded fonts
  - Bottom HUD with consoles, FPS and a performance gauge

  All VERIFIED ([release notes](https://origami.design/releases/)). Meta is already moving toward machine-readable documents and AI-assisted authoring. An open, MCP-first competitor would be arriving while that shift is underway.
- Documentation hygiene is poor. Official shortcuts disagree across the shortcuts page, tutorials, doc pages and release notes (see [§27](#27-docs-vs-release-notes-staleness-and-conflicts)). One consistent, discoverable command system would be an easy way for us to beat it.

---

## 2. Platform, file format, distribution

| Fact | Status / source |
|---|---|
| macOS only, free | VERIFIED ([docs intro](https://origami.design/documentation/); [Hack Design](https://www.hackdesign.org/toolkit/origami-studio/)) |
| Minimum macOS 12. macOS 11 support dropped in v177 (09/30/2024); earlier minimums were 10.15 (v120) and 11.0 (v135) | VERIFIED ([release notes](https://origami.design/releases/)) |
| Apple M1 support added in v80 (01/25/2021) and v85 (03/16/2021) | VERIFIED |
| Default saving format is `.origami` (v190 "Make sure the default saving format is origami") | VERIFIED |
| Internal file format version **129**. v204 (10/13/2025) is the last version that can open files from before Oct 2023; v205+ cannot open files about 2 years old | VERIFIED |
| **CLI to convert an Origami file to JSON** (v221, 06/08/2026) | VERIFIED |
| **Copy-Paste As JSON** (v221) | VERIFIED |
| QuickLook generation plugin with video previews (v224, 07/20/2026); app size reduced by 260MB | VERIFIED |
| Automatic de-duplication of resources to reduce file size (v101) | VERIFIED |
| Custom device bundles install to `~/Library/Application Support/Diamond/Devices` ("Diamond" appears to be the internal codename) | VERIFIED path ([Custom Devices doc](https://origami.design/documentation/workflow/customdevices)); codename INFERRED |
| JavaScript runs on Hermes (ES6*) | VERIFIED ([Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics)) |
| Shader Layer uses SkSL (Skia), which suggests a Skia-based renderer | SkSL VERIFIED ([Shader Layer concept](https://origami.design/documentation/concepts/shaderlayer)); renderer INFERRED |
| Companion apps: Origami Live for iOS (App Store, v228.0) and historically Android (Google Play `com.facebook.Origami`) | iOS VERIFIED ([App Store](https://apps.apple.com/us/app/origami-live-design-prototyping/id942636206)). Android is documented in [previewsharing doc](https://origami.design/documentation/workflow/previewsharing), but on 2026-09-16 the Play Store listing returned **HTTP 404** for both `hl=en_US` and `hl=en_IN`, and APKMirror search results show only "Origami Live 2.0.1". INFERRED: the Android app is **delisted or unmaintained** |

---

## 3. Window layout and chrome

### 3.1 The six panels (official)

VERIFIED from the [documentation intro](https://origami.design/documentation/):

1. **Canvas**: "Visually drag, drop and resize to layout your prototype. Draw and edit shape layers, text, images, videos and layers imported from Sketch & Figma. Setup adaptive layouts in your artboards and groups using layout."
2. **Patch Editor**: "Add interaction, animation, and behavior to your prototype using blocks called patches. Connect patch outputs to layer properties in the Inspector."
3. **Layer List**: "Add a new layer with the + button in the toolbar. To add interactions to a layer, hover on it and click the Touch button to select from a list of interactions like Tap, Scroll, or Swipe."
4. **Inspector**: "Select a layer and adjust its properties in the inspector."
5. **Viewer**: "View, interact with and record the prototype."
6. **Patch Library (⌥⏎)**: "View a list of all patches and their descriptions. To open the Patch Library, double click the Patch Editor or use the keyboard shortcut. To add a patch to a prototype, select it and press return."

### 3.2 Spatial arrangement

VERIFIED ([Getting Started tutorial](https://origami.design/tutorials/getting-started/getting-started)):

> "On the left side of the screen is the Layer List… To the right of that is the Viewer; where we see and interact with our prototype. On the right hand side is the Inspector… The middle area is split between the Canvas on the top and the Patch Editor on the bottom."

Schematic (INFERRED from the text description; proportions approximate):

```
+----------------------------------------------------------------------------------+
| [Device picker] ...  Toolbar (+ insert, split/view mode, share, export, ...)     |
+-------------+----------+-------------------------------------------+------------+
| Layer List  | Viewer   |   Canvas (artboards, drawing, layout)     | Inspector  |
| (tree,      | (device  |-------------------------------------------| (layer     |
|  Touch btn, | frame,   |   Patch Editor (node graph)               |  props,    |
|  search at  | toolbar) |                                           |  layout,   |
|  bottom)    |          |                                           |  effects)  |
+-------------+----------+-------------------------------------------+------------+
| Bottom HUD: consoles, asset manager, loop counts, perf gauge, FPS (v201)         |
+----------------------------------------------------------------------------------+
```

### 3.3 View modes and panel management

- **"Split View"**: canvas and patch editor together. It was renamed from "Canvas & Patch Editor" to prevent toolbar shifting in v89.1 (05/20/2021). VERIFIED. Other toolbar view modes were presumably Canvas-only and Patch-Editor-only. INFERRED from the rename and from v117's "Fix viewer inset when Canvas is collapsed".
- **Vertical Split View preference** (v103, 12/03/2021). VERIFIED. This suggests canvas and patch editor can sit side-by-side instead of stacked. INFERRED.
- **"Full patch graph mode"** exists (v172: "Fixed the 'search' button not working while entering link components in full patch graph mode"). VERIFIED.
- **Inspector collapse/open: ⌘7** (v198, 07/21/2025). VERIFIED. Likely follows the macOS ⌘-number convention for other panels (e.g. ⌘1… for the layer list). INFERRED and unverified.
- **Layer List is resizable** (v179 perf fixes for resizing). VERIFIED.
- **Viewer** can be minimized and floated over the Patch Editor, snapped to corners, popped into its own window, or made fullscreen (see [§17](#17-viewer-preview-window)). VERIFIED.
- Popovers (Component Info, loop inspector, value inspector) can be **detached into their own windows** (v88; v80 "Value inspector can be opened after being clicked but not detached"; v180 "when detached the label refers to the patch name"). VERIFIED.

---

## 4. Toolbar, Welcome Window, Preferences, HUD, consoles

### 4.1 Toolbar (VERIFIED unless noted)

- **Device picker / Device Size** is at "the far left corner of the Origami toolbar". Artboard dimensions are determined by it ([Canvas doc](https://origami.design/documentation/canvas/canvas)). Devices are ordered better since v223. Device selection and device color are undoable (v203).
- **+ button** is the layer insertion popover / Layer Library, "top right of the window" in the Create Component tutorial ([Create Component](https://origami.design/tutorials/smarter-interactions/create-component)). The Components doc says "click the + in the toolbar to access the dropdown, then click Layer Library".
- **Share button**: macOS share sheet, customizable via "More…" ([Previewing and Sharing tutorial](https://origami.design/tutorials/getting-started/previewing-and-sharing)).
- **Export button**: exports the prototype to a connected phone or tablet ([previewsharing doc](https://origami.design/documentation/workflow/previewsharing)).
- **New Toolbar enabled by default** (v76, 11/21/2020). "Origami gets a new look for macOS Big Sur" (v80). Toolbar buttons collapse/hide when the window is narrow (v121 crash fix).
- The website homepage image asset is named `header-buttons.png`, meaning the toolbar is custom-drawn. INFERRED.

### 4.2 Welcome Window

VERIFIED from release notes:

- v74: "New Welcome Window with Patterns, Examples, Tutorials."
- v82: "Featured Templates section."
- v83: "Window Menu shortcuts for Welcome Window sections, such as Examples and Tutorials."
- v80: progress indicator.
- v198: Recent Files.
- v200: dark mode.
- v225: header fix.
- v136: example filtering.

### 4.3 Preferences

VERIFIED unless noted:

- **Experiments** tab (v72: "New Color Picker, can be enabled in the Experiments tab preferences").
- **Components / Systems** tab: "+ button in Systems tab" to load shared libraries ([Components doc](https://origami.design/documentation/workflow/components)). The newer System Creation doc says "Components Tab" with a + in the lower right ([System Creation](https://origami.design/documentation/workflow/systemcreation)). The name changed over time.
- **High contrast patch styling preference**. Low contrast became the default in v153.
- **Pasted image origin scale preference** (v147), replacing a popover that appeared on paste.
- **Avoid playing media on Canvas** (v78).
- **Invert zoom direction** (v122), persisted on restart since v187.
- Honors the macOS **Accent color** for several UI elements (v199).

### 4.4 Bottom HUD and consoles

- **Bottom HUD** (v201, 09/02/2025): "consoles, asset manager, loop counts, performance gauge, FPS counter". VERIFIED.
- **JavaScript Console**: View menu → "Hide/Show JavaScript Console". Shows logs from the last selected JS patch. Max 50 messages. `console.watch` for tracking variables. VERIFIED ([Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics)). Clear button added in v148.
- **Asset Manager** (v120 "brand new asset manager"; v122 "View where assets are being used"; v127 more details; v190 file names truncated in the middle). VERIFIED.
- **Missing resources dialog** (v133, v97). VERIFIED.
- **Toast notifications** with a border (v153). VERIFIED.

### 4.5 Menus (names seen in sources)

VERIFIED names, gathered from docs, tutorials and release notes:

- **Edit**: Copy ⌘C, Paste ⌘V, **Paste Over Selection** (v167).
- **View**: Zoom In, Zoom Out (v113), Hide/Show JavaScript Console.
- **Layer**: Use as Mask ⌥⌘M.
- **Patch**: Comment Around Patches; Enter Patch Group (older name).
- **Component**:
  - Create Component / Group Into Component ⌃⌘G
  - Enter Component / Exit Component
  - Component Info ⇧⌘I
  - Publish Port ⌥P
  - Add to User Library ⌘⌥L
  - Add to Other Library
  - Show Patch Folder
  - Unlink Component from Library
  - Check for Local Component Updates (v123)
  - Publish Components (System Publisher)
- **File**: New; Import (Sketch, per Hack Design, unverified in primary docs).
- **Window**: Welcome Window sections.
- **Origami Studio** → Preferences.

---

## 5. Layer List (Layers panel)

VERIFIED unless noted:

- **Hierarchical tree** of layers: artboards/screens, groups, components, masks.
- **Hover action icons** on rows (v180 fix "layer list hover action icons sometimes not hiding"). The key hover action is the **Touch button**: "hover over the layer in the Layers panel, click the circle icon, and then click Tap" ([Getting Started](https://origami.design/tutorials/getting-started/getting-started)). See [§14](#14-layer-to-patch-bridges-touch-button-property-patches-bindings).
- **Visibility (eye) and lock** toggles, via ⌘⇧H hide/show and ⌘⇧L lock/unlock ([shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts)). Components with a published port tagged **Enable** show an eye icon for quick enable/disable ([Components doc](https://origami.design/documentation/workflow/components)). The eye icon on the layer list is INFERRED to be standard.
- **Rename**: double-click a layer name, or ⇧⏎ ([Text Input tutorial](https://origami.design/tutorials/smarter-interactions/text-input)). Tabbing moves through title editing (v185). Icons hide while renaming (v185). An empty name resets to the default (v189). Duplicated layers are renamed (v76).
- **Reorder**: drag in the list; ⌘⌥↑/↓ forward/backward; ⌘⌥⇧↑/↓ to front/back.
- **Collapse layers recursively**: ⌥L (v173).
- **Mask symbols**: "The downward arrow shows the layer being masked. The corner-glyph shows which layer is acting as the mask." ([Masking Layers](https://origami.design/tutorials/smarter-interactions/masking-layers))
- **Component breadcrumb / back arrow** at the top of the Layer List when inside a component. "clicking on the menu icon in the breadcrumb navigation in the top left of the layer list" exits the component ([Create Component](https://origami.design/tutorials/smarter-interactions/create-component); [Components doc](https://origami.design/documentation/workflow/components)).
- **"Prototype" header** section in the layer list (v180 fix). A "Document Components" section in the component list (v189, v190). Component rows show **instance counts** (v128). Components have a **purple cog icon** ([Components doc](https://origami.design/documentation/workflow/components)).
- **Layer Search** (v136): "enables searching by layer name and filtering by various types. Access via the bottom of the layer panel." Performance improved in v185.
- **Drag cables onto layer names**: "You can also drag to the layer name in the Layers panel. The layer will expand to show its properties." ([Getting Started](https://origami.design/tutorials/getting-started/getting-started))
- **Drag files onto the layer list** is fully supported (v213). Drag files from Origami to Finder (v78).
- **Export** from the layer list with device scale (v76 fix). INFERRED to be a right-click "Export…" on a layer.
- **Insert/paste placement**: "Layers are now inserted/pasted inside selected groups by default and above other layers." Plus a **Paste Over Selection** option (v167).
- **Right-click context menu** includes Group Into Component, Component Info (⇧⌘I, shown in menu since v185), Inspect Instance, Add to User Library, Replace With… (v98), Unlink.
- **Ungroup error** when trying to ungroup components with sublayers (v192). **Sublayer Container deletion validation** (v150).

---

## 6. Canvas (design surface)

### 6.1 General

- "The Canvas in Origami works the way one might expect coming from Sketch or Figma." VERIFIED ([Canvas doc](https://origami.design/documentation/canvas/canvas))
- Launched with Origami Studio 3 (Sept 2020): "Canvas adds vector drawing capabilities to Origami as well as a new smart, dynamic layout engine." VERIFIED ([Meta Tech, 09/25/2020](https://tech.facebook.com/engineering/2020/09/origami-studio-3-makes-app-design-easier-than-ever/))
- Homepage: "Introducing Canvas. A new way to visually layout your Origami prototypes with **freeform drawing tools, text editing, and visual components**." VERIFIED ([origami.design](https://origami.design/))

### 6.2 Artboards

- "Artboards allow you to contain the layers for each screen you're designing. The artboard dimensions are determined by the Device Size selected in the far left corner of the Origami toolbar." VERIFIED
- One click selects artboards (v76). VERIFIED
- Better artboard positioning when pasting from Sketch/Figma (v72). VERIFIED
- An artboard that is "not presented" exists as a concept (v160 "wrong offset when drawing on an Artboard that is not presented"). This relates to Screen components with Present/Dismiss. INFERRED
- **Artboards have a Color** property (Getting Started: "connect the output of our Transition patch to the Color property of the Artboard layer"). VERIFIED
- Layout can be enabled on artboards. VERIFIED ([Layout doc](https://origami.design/documentation/canvas/layout))

### 6.3 Tools and manipulation

- **Drawing tools**: vector shape layers and text. The exact tool list and single-key shortcuts (e.g. R/O/T/P) were **not found in any source**. INFERRED that rectangle, oval, text and possibly pen/path tools exist, given "freeform drawing tools" and "editable vector shape" paste support. Open question.
- **Live text editing on canvas** (v135 fix "text styles when live editing text in canvas"; v99 "Canvas text field improvements"). VERIFIED
- **Selection handles** for resize. Fixes appear in v72, v155 and v185 ("Fixed Canvas handles when scale is applied"). Anchor-point-aware manipulation fixes in v98 and v99. VERIFIED
- **Keyboard nudging** of layers with measurement guides updating (v155 "measurement guides not updating when moving the layer with keys"). VERIFIED
- **Measurement tool / guides** (v150 "measurement tool is visible in Viewer when enabled"). VERIFIED that it exists. The trigger key (likely ⌥-hover as in Figma/Sketch) is INFERRED.
- **Option-drag duplicates layers** in Canvas (v116 fix; v117 "Focusing on the copied layer when option-dragging layers"). VERIFIED
- **"New Interaction Handlers in Canvas"** (v74). VERIFIED. **Quick Interactions** were a canvas feature for wiring screen present/dismiss ("quickly wire up, present, and dismiss animations between screens", Meta Tech 2020). They were **removed in v148** (08/21/2023, "Removed quick interactions from Canvas"). VERIFIED. **Stale-doc flag:** the homepage still shows an image alt "Quick Interactions".
- **Right-click on canvas layers** opens a context menu (v160 fix). VERIFIED
- **Transparent background shows a checkerboard** (v155). VERIFIED
- **Media playback on canvas** can be disabled via a preference (v78). Canvas video thumbnails are taken from the 20% point to avoid black frames (v80). VERIFIED
- **Rasterize / Unrasterize** layer hierarchies (v87). VERIFIED

### 6.4 Zoom and pan (Canvas and Patch Editor)

VERIFIED from release notes:

- **⌘ + scroll to zoom** in Canvas (v72). "Scroll zooming mapped to command for both canvas and patch graph" (v91). Trackpad sensitivity tuned (v74).
- **Pinch zoom** (v90 fix); Tahoe trackpad zoom gesture fix (v212).
- **Middle mouse button panning** in canvas and patch graph (v89.1).
- Scroll zoom centers on the cursor (v90, patch graph).
- **Invert zoom direction** preference (v122).
- View > Zoom In / Zoom Out menus (v113). Standard ⌘+ / ⌘− are INFERRED.
- Plain two-finger scroll pans. INFERRED, since ⌘ is required for zoom.

### 6.5 Groups and masks

- "Layers can be grouped by selecting any number of layers and pressing ⌘G. Layer groups in Origami Studio have their own size and position, and clip layers within." VERIFIED
- "Pressing ⌘⌥M will turn the layer to an alpha mask, clipping the layer right above it. To add additional layers to be masked, you can select the layers and press ⌘⌥⇧M. All masks are alpha masks." VERIFIED
- Mask ordering: the mask layer sits **below** the masked layer in the list ([Masking tutorial](https://origami.design/tutorials/smarter-interactions/masking-layers)). VERIFIED

---

## 7. Layout system (auto layout)

VERIFIED from the [Layout doc](https://origami.design/documentation/canvas/layout) unless noted. The doc describes it as like Flexbox: "Those coming from the web can think of it similarly to Flexbox."

- **Enabling**: "you have to enable it on Artboards and Group layers. Any objects within that group will get new Layout-related properties." Enable from "the Layout section in the Inspector panel".
- **Position (child)**: `Relative` (flows with siblings) | `Absolute` (ignores siblings; X/Y within group).
- **Size**:
  - `Auto`: parent hugs children
  - `Grow`: fill parent
  - `Fixed`: typing a number makes it fixed
  - **Percent of parent** since v98: "100% width or 50% height" (VERIFIED, release notes)
  - Percentage scrub with keys (v185)
- **Direction (parent)**: `Horizontal` | `Vertical` | `Grid`. Grid wraps rows and requires Fixed width.
- **Alignment (parent)**: anchor point children align to. It "does not change the order the objects are stacked". Order is set by layer list order or rearranging on Canvas.
- **Spacing (parent)**: `Between` | `Evenly` | `Fixed` (number).
- **Padding (parent)**: edge ↔ children.
- **Margins (child)**: layer edge ↔ parent.
- **Cap & Baseline (text)**: on means text bounds snap to cap height and baseline; off means bounding box.
- Inspector uses **segmented controls** for Layout and Text properties instead of dropdowns (v80, 01/25/2021). VERIFIED
- "Better heuristics on Smart Layout" (v73). "Change sets being used on Visual Layout" (v72). VERIFIED
- **Loops + Layout**: looped layers in a Layout-enabled group auto-arrange (list/grid). Otherwise they stack on top of each other ([Loops concept](https://origami.design/documentation/concepts/loops)). VERIFIED
- **Grid Layout patch** also exists (`origami.gridlayout`). VERIFIED (docs index)
- **Constraints / pinning** (Figma-style left/right/top/bottom pins): **not found** in any source. INFERRED that Origami relies on Anchor + Position + Layout (Relative/Absolute, Grow, %) rather than constraint pins.
- Figma **Auto Layout info is carried over** by the Figma plugin (v82: "Copy to Figma plugin now include Auto Layout information", presumably the Origami Pasteboard plugin). VERIFIED

---

## 8. Inspector

### 8.1 Structure

- Shows properties ("ports") of the selected layer. "Layer properties are similar to ports on patches." VERIFIED ([Canvas doc](https://origami.design/documentation/canvas/canvas))
- Properties are organized in sections: Layout section, Text, Effects port (v116 "a port in the inspector for applying effects to layers"), component categories. VERIFIED. Components can define **categories** for their published inputs and outputs (v88, v172).
- Some component properties show **"AUTO"** values (v163 "AUTO would show on Components that support it"; v76 "Prevent crash when attempting to edit an AUTO text field"). VERIFIED
- **Shader Layer**: a "Shader Code" button opens the code editor. Uniforms auto-expose as properties ([Shader Layer concept](https://origami.design/documentation/concepts/shaderlayer)). VERIFIED

### 8.2 Editing numbers

- **Arrow-key increments** (VERIFIED, [shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts)):
  - ↑ / ↓: ±1
  - ⇧↑ / ⇧↓: ±10
  - ⌥↑ / ⌥↓: ±0.1
- Vector-port arrow-key scrubbing (v117 fix). VERIFIED
- **Scrubbing** by dragging on a value ("Select and scrub the second input of the + patch", [Intro to Loops](https://origami.design/tutorials/smarter-interactions/introduction-to-loops); v116 "scrubbing vector ports in patch graph"). VERIFIED. Horizontal drag direction is INFERRED.
- **Math in fields**: "In the Size H property… enter 667-49-64.5 and hit Return ⏎. You should see a new Size H value of 553.5" ([Scrolling Views](https://origami.design/tutorials/common-interactions/scrolling-views)). VERIFIED
- **Select-all on first edit** (v168). The inspector focuses a text field when it first gets focus (v167). Autocorrect and text styling disabled on normal inputs (v207). VERIFIED
- **Tab** to the next field (v127 color picker; v173 "tab between ports in a patch"). VERIFIED

### 8.3 Other controls

- **Anchor picker**: "Change the Anchor by clicking on the desired point, or by clicking and dragging to the desired point" (9-point grid; [Getting Started](https://origami.design/tutorials/getting-started/getting-started)). VERIFIED
- **Enum dropdown / segmented**: tooltip shows the enum index (v201). VERIFIED
- **Boolean checkboxes**: "the On value is represented with a checkmark" ([Patches doc](https://origami.design/documentation/patch-editor/patches)). VERIFIED
- **Bound properties** show a **connection icon** (v190). Clicking a bound value "bounces and centers patch and source patch" in the graph (v89.1, v92). VERIFIED
- **+ icon on hover** of a property adds its layer property patch: "You can also connect patch Values to layer by clicking the + icon when hovering any of the layer properties" ([Prototyping with Data](https://origami.design/tutorials/smarter-interactions/prototyping-with-data)). VERIFIED
- **Reset a Patch/Layer to its default values** (v199). VERIFIED
- **Corner radius** with independent corners and **smoothing (squircles)**, clamped 0–1 (v125, v175). VERIFIED
- **Blend modes** (v113), **pass-through** (v219), **Plus Lighter/Darker** (v217). VERIFIED
- **Independent X/Y/Z scale** (v185). VERIFIED
- **Text truncation** (v189). **Variable font rendering** plus a Variable Font builder from the Patch Picker (v226). **Embed fonts into a prototype** (v226). VERIFIED

---

## 9. Color picker, font picker, value popovers

### 9.1 Color picker

VERIFIED from release notes:

- New Color Picker introduced behind Experiments (v72), now standard.
- **Tabs**, and the last tab is remembered (v144).
- **Eyedropper** with a grid/loupe (v80, v128; multi-display fix).
- **Alpha normalized to 0–100** (v76). Alpha slider color fix (v174).
- **System colors** (v109.1 fix) and **custom system colors** (v135). Color palettes on system colors (v164). JSON color libraries attachable to Systems ([System Creation](https://origami.design/documentation/workflow/systemcreation)).
- **RGBA fields support scrubbing and keyboard gestures** (v171).
- Clicking the color well again closes the picker (v171). Tab to next field (v127).
- Wide gamut image support (v189). Snapshot Patch captures wide gamut (v189).
- Color port type supports RGB or HSL ([Patches doc](https://origami.design/documentation/patch-editor/patches)).

### 9.2 Font picker

- Search a font; recently used fonts (v173). SF Pro in the default list (v89.1). Variable font builder (v226). VERIFIED

### 9.3 Value / port popovers (patch graph)

VERIFIED from release notes:

- **Patch Output Popovers** (v74). Clicking a cable/port value opens a popover without double-clicking (v80).
- **Loop inspector popover**: hover each loop item to see graph values per index ([Loops concept](https://origami.design/documentation/concepts/loops)). Image/video previews in it (v107). Detachable.
- **Text value popover** editing (v148). **JSON popover** with performance work (v163). **Multiline JSON editor with embedded image previews** (v215). **Visual JSON Editor** (v216).
- **Ports expand** on hover/edit to show more content (v109.1, v115). Boolean popovers sizing (v206).
- Enum popups show the index in a tooltip (v201).

---

## 10. Patch Editor (node graph)

### 10.1 Anatomy of a patch (VERIFIED, [Patches doc](https://origami.design/documentation/patch-editor/patches))

- Header/title (renamable) plus input ports on the **left** and output ports on the **right**. "Values flow in one direction: left-to-right."
- Unconnected inputs show **editable inline values**: "Edit Inputs by clicking the port's value (unless a cable from another patch is connected to the Input already)."
- **Type-variant patches**: "Some patches can change the number of ports it has or the type of value it supports. Right-click any patch to see the options available." In the context menu: **Type** submenu and **Number of Inputs** ([Intro to Loops](https://origami.design/tutorials/smarter-interactions/introduction-to-loops)). VERIFIED
- A **port-count drag handle** at the bottom of multi-input patches (Or, Option Picker, Loop Builder…) adds or removes inputs by dragging (v113 "input count drag handle"; v180 fixes). Dragging a connection toward the bottom of a patch creates an extra port, removed if unused (v94). VERIFIED
- **Layer icon / preview on patches** tied to a layer, with hover (v113 "Add hover to layer preview icon on patches"). Clicking it selects the layer (v180). VERIFIED
- **Wireless receiver "radio wave" icon**: click it to pan to the broadcaster (v89.1 "bounces and centers its broadcaster"; [Variables concept](https://origami.design/documentation/concepts/variables)). VERIFIED
- **Media patch design** (images/video/sound previews on ports) improved for readability (v155). Thumbnails generated for ports (v174). Sound previews in Patch Info (v190). VERIFIED
- **Patch Redesign** (v143, 06/12/2023). Lower contrast default and dimmed patches with opaque background (v153). VERIFIED
- **Value tracing**: ports flash when pulses fire, e.g. "keep an eye on the Down and Tap outputs… Both of these outputs flash" ([Getting Started](https://origami.design/tutorials/getting-started/getting-started)). Value tracing improved for animations (v92). VERIFIED

### 10.2 Navigation

VERIFIED:

- ⌘-scroll zoom at cursor, pinch zoom, middle-mouse pan, more zoom levels (v113), invert zoom preference.
- **Patch graph search surface** (v180, 11/11/2024): "access all of the patches associated with a particular layer, such as interactions, blue bounded properties, and layer outputs". Searching animates the scroll to the found patch (v94).
- **Go-to-source**: clicking bound ports inside linked components goes to the binding patch (v172). Clicking bound values in the inspector centers the patch (v89.1, v92). "Improve navigation from patch to layer" (v155).
- Patch graphs no longer move on selection or deselection (v203). Selecting a patch draws it in front (v89.1).

### 10.3 Context menu (right-click a patch)

VERIFIED items:

- **Type ▸** (change value type)
- **Number of Inputs**
- **Replace With…** (v98; merged "Replace With" and "Replace With…" in v172; preview of the exact result since v179)
- **Patch Info** (⌘⇧I shown in menu since v185)
- **Group Into Component…**
- **Inspect Instance**
- **Add to User Library**
- **Scope** (variables: Local/Global)
- **color** (comments)
- **Open in default editor / Open With** (JS patch)
- **shortcut mappings shown next to items** (v92)
- **"Exit Component"** when inside a component (v187)

### 10.4 Patch Info popover

- ⌘⇧I. Tabs include **Port Setup** (type, default/min/max) and **Patch Setup** (platform restriction) ([Components doc](https://origami.design/documentation/workflow/components)). VERIFIED
- Used to edit Math Expression text: "right-click the patch and select 'Patch Info'… (or press ⌘I). Once you're done editing, press enter to save" ([Math Expressions](https://origami.design/documentation/concepts/mathexpressions)). The ⌘I there conflicts with ⌘⇧I (see [§27](#27-docs-vs-release-notes-staleness-and-conflicts)). Invalid expressions highlight red and are not saved. VERIFIED

### 10.5 Dropping files onto the graph

VERIFIED:

- A `.js` file becomes a JavaScript Patch ([Scripting Basics](https://origami.design/documentation/concepts/scriptingbasics)).
- A folder of images becomes a **Loop Builder** patch with all images as inputs ([Intro to Loops](https://origami.design/tutorials/smarter-interactions/introduction-to-loops)).
- Image, Video and Sound ports accept dragged or pasted media ([Patches doc](https://origami.design/documentation/patch-editor/patches)).

---

## 11. Patch Library / Patch Picker (insert menu)

VERIFIED unless noted:

- **Open**:
  - **double-click empty Patch Editor space**
  - **⌥⏎** ("Insert Patch")
  - three additional entry points added in v154 (11/17/2023; unspecified)
  - suggested picker when dragging a connection into empty space **while holding ⌥** (v203, 09/29/2025: "When dragging a connection to an empty area, suggested patch picker will not be shown unless option key is pressed")
- **Search as you type**, then **Return** inserts ("begin to type 'transition', followed by Return"). Double-click on a cell also inserts (v164 fix). Searchable **keywords/aliases** (v86 "Updated aliases", v76 editable search keywords on Components).
- **Combined picker for patches AND layers** (v82, 02/09/2021).
- **Documentation pane inside the picker** (v74 "Much Improved Patch Picker Documentation"; v83 static preview images; v115). "Documentation links will now open on the website instead of inside the app" (v177).
- **Documentation shortcut ⌘/** ([shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts)).
- **Suggested patches** are typed to the dragged port (v109.1 fix "suggested patches having incorrect type").
- **Component entries**: document components, user library components, Systems. There is a "Delete Component" button for document components (v185) and an upgrade flow accessible from the picker (v83).
- **Insertion position**:
  - Inputs/Outputs (purple patches) are placed at screen center (v119).
  - Double-click insertion on a port pushes overlapping patches right to make room (v89.1, v94).
  - An inserted patch connected to a hovered port goes to that port. The claim that it auto-connects to the top input is from a search snippet only and is INFERRED/unverified.
- **Layer Library** (⌘⏎ Insert Layer / + button): categories include Platform Components (iOS, Material), Device Components (Viewfinder, Text Field), Document Components, User Library Components, plus basic layers ([Components doc](https://origami.design/documentation/workflow/components)). "Place Layer" button ([Text Input](https://origami.design/tutorials/smarter-interactions/text-input)).

---

## 12. Wiring: connections, cables, modifiers

| Behavior | Status / source |
|---|---|
| Create cable: drag from an output port (right) to an input port (left) | VERIFIED ([Patches doc](https://origami.design/documentation/patch-editor/patches)) |
| Disconnect: "drag the right end out of the Input port" | VERIFIED (same) |
| Fan-out: an output may connect to many cables; an input accepts only one | VERIFIED (same) |
| New connection to an occupied input **replaces** the old one | VERIFIED ([Getting Started](https://origami.design/tutorials/getting-started/getting-started), [Adding Logic](https://origami.design/tutorials/common-interactions/adding-logic)) |
| **Shift-click fan-out**: "Quickly connect an output to multiple inputs by selecting the output, and shift-clicking the inputs you want to connect." | VERIFIED ([Patches doc](https://origami.design/documentation/patch-editor/patches)) |
| **Shift-dragging connections**, cancelable with **Escape** | VERIFIED (v172) |
| **Snap to closest port** while dragging | VERIFIED (v160, 02/06/2024) |
| **⌘ while dragging onto a multi-input patch** pushes down existing connections and values to make room | VERIFIED (v89.1) |
| **Drag a single patch over a cable** splices it in between; gated behind **⌘** since v91 | VERIFIED (v89.1, v91) |
| **Double-click a port** inserts a patch there (picker), pushing overlapping patches | VERIFIED (v89.1, v94); double-click on ports no longer enters components (v110) |
| **Option-drag a patch** duplicates it **with the same input connections** ("Option-clicking ⌥ and dragging an existing one. That will create a new Wait patch, with the same input connection.") | VERIFIED ([Timed Animations](https://origami.design/tutorials/common-interactions/timed-animations)); copy retains Number of Inputs and Type ([Intro to Loops](https://origami.design/tutorials/smarter-interactions/introduction-to-loops)) |
| Option-drag a port connection duplicates the wire | INFERRED/unverified (third-party search snippet; primary source not reachable) |
| Drag cable to **Inspector property** or **Layer List layer name** (row expands) | VERIFIED ([Getting Started](https://origami.design/tutorials/getting-started/getting-started)) |
| **Port-selected + key** inserts a connected patch: `s` Splitter ("Press s when selecting or hovering on a port to insert a splitter"), `w` on an input inserts the matching Wireless Receiver | VERIFIED ([Splitter doc](https://origami.design/documentation/patches/builtin.splitter), [Prototyping with Data](https://origami.design/tutorials/smarter-interactions/prototyping-with-data)) |
| Port-selected + ⌥W / ⌥⇧W create broadcaster/receiver | VERIFIED as written in [Create Component tutorial](https://origami.design/tutorials/smarter-interactions/create-component) (possibly stale; see [§27](#27-docs-vs-release-notes-staleness-and-conflicts)) |
| **Port highlighting**: selecting a port highlights only its connections | VERIFIED (v153) |
| **Backwards connections** (right-to-left, cycles) are allowed and evaluate with a frame delay | VERIFIED (v91 "delayed values on backwards connections"; v121; v99 "Never-ending layout fix involving backwards edges") |
| Loop-carrying cables are **green-tinted** | VERIFIED ([Loops concept](https://origami.design/documentation/concepts/loops)) |
| State → pulse inference: connecting a boolean state to a pulse input infers a pulse on rising edge | VERIFIED ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)) |
| Pulses can fire on consecutive frames (since v187) | VERIFIED |
| Dragging a cable over a port value no longer expands the text field | VERIFIED (v203) |
| Crash fixes when connecting/disconnecting | VERIFIED (v215) |

---

## 13. Selection, organization, comments, Tidy Up, variables

### 13.1 Selection

VERIFIED:

- Click to select. **Shift-click** to multi-select patches (v180). Marquee drag selection (v91: "Comments added to selection if selection box intersects header instead of entire comment").
- **⌘⇧A**: "Select All Patches" per shortcuts page; v135 notes say "Added CMD+SHIFT+A to deselect all patches" (CONFLICT).
- ⌘-click a layer in the Layer List while patches are selected to build a mixed layer+patch selection for component creation ([Create Component](https://origami.design/tutorials/smarter-interactions/create-component)).
- Adding a binding deselects selected patches (v89.1).

### 13.2 Alignment and Tidy Up

VERIFIED:

- **Align**: ⌘[ left, ⌘] right, ⌘⇧[ top, ⌘⇧] bottom. Alignment respects comments if a comment is selected (v94).
- **Tidy Up** (auto-layout of the patch graph): beta in v91, renamed "Tidy Up" with **⌃T** in v92 (06/28/2021). Works on comments (v186).

### 13.3 Comments

VERIFIED ([Comment doc](https://origami.design/documentation/patches/builtin.comment), [Patch Organization](https://origami.design/documentation/workflow/patchorganization), release notes):

- A **Comment patch** is a titled, colored frame behind patches. "Select any number of patches and press Patch > Comment Around Patches … to add a comment sized to surround the patches."
- **Edit title**: double-click the name or press Return. **Escape** exits edit mode (v166, v167). Comments **grow as you type** (v192).
- **Color**: right-click → color (e.g. Purple for inputs, Blue for outputs, per [Create Component](https://origami.design/tutorials/smarter-interactions/create-component)). Color changes are undoable (v186).
- **Resize** from any edge or corner (v91). Resize is undoable (v87). Correct resize when zoomed (v170.1).
- **Moving a comment moves all enclosed patches.**

### 13.4 Naming

VERIFIED:

- Double-click the title or ⇧⏎. **Enter** renames when a single patch is selected (v208).
- Splitters auto-name from connected ports (v86). Empty names are prevented (v189).

### 13.5 Variables (formerly Wireless)

VERIFIED ([Variables concept](https://origami.design/documentation/concepts/variables), [Variable Broadcaster doc](https://origami.design/documentation/patches/builtin.wirelessbroadcaster)):

- **Variable Broadcaster (W)** and **Variable Receiver (⇧W)**. Rename the broadcaster to name the value.
- **Receiver name is a popup menu** of local and global variables. Selecting one changes the receiver's scope, name, type and value.
- **Scope**: Local (default, current graph) or **Global** (cascades into child components; nearest ancestor broadcaster wins). Set via the popup menu at the top-right of the broadcaster, or right-click → Scope.
- Receivers are preserved on copy/paste (v78). The receiver auto-resizes to the name (v90).

---

## 14. Layer-to-patch bridges: Touch button, property patches, bindings

### 14.1 Touch button (Layer List hover)

- "To add interaction to a layer, hover over the layer in the Layers panel, click the circle icon, and then click Tap. You'll notice that this adds an Interaction patch to our Patch Editor." VERIFIED ([Getting Started](https://origami.design/tutorials/getting-started/getting-started))
- The Touch menu contents depend on the layer type. VERIFIED examples:
  - **Tap** creates an Interaction patch with its Layer input set to that layer.
  - **Scroll X / Scroll Y**: "What we end up with on the Patch Editor is a Scroll patch, connected directly to the X position of that layer" ([Horizontal Scrolling](https://origami.design/tutorials/common-interactions/horizontal-scrolling)). Adding scroll "reset its position to 0" ([Scrolling Views](https://origami.design/tutorials/common-interactions/scrolling-views)).
  - Docs intro mentions "Tap, Scroll, or Swipe". The Touch pattern lists "Tap, Down, Double Tap or Long press". Scroll/Interaction/Hover docs: "Use the Touch button on a layer to quickly add interactions."
  - **Component outputs** via Touch:
    - Fake Keyboard → **Remaining H**
    - Text Field → **Text**, **Enter Pressed**
    - Screen → presentation status ([Text Input](https://origami.design/tutorials/smarter-interactions/text-input), [ios.screen](https://origami.design/documentation/patches/ios.screen))
- The website CSS styles the layer output block with a "Touch" label. VERIFIED ([documentation.css](https://origami.design/public/css/documentation.css))

### 14.2 Layer property patches ("blue patches")

- "click on the property in the inspector, and a blue layer property patch is created with the name of the layer and a single input port that writes a value to that port." VERIFIED ([Canvas doc](https://origami.design/documentation/canvas/canvas))
- Clicking a **single coordinate** (e.g. Position X) creates a patch for that scalar. Clicking the **whole property** (Position) auto-inserts a **Point** patch exposing extra coordinates such as Z. VERIFIED
- Layer property patches **cannot be grouped into a patch component**; use layer components instead. VERIFIED ([Components doc](https://origami.design/documentation/workflow/components))
- Bindings update when the layer name changes (v170.1). Bound bindings are dimmed when the layer is disabled (v76). Layer outputs can be duplicated (v122). VERIFIED

### 14.3 Automatic patches from UI actions (VERIFIED)

- **Enable Interface Orientation** (Viewer toolbar) inserts an **Interface Orientation** patch ([Orientation](https://origami.design/tutorials/smarter-interactions/orientation)).
- **Publish Port ⌥P** inside a component inserts a purple (input) or blue (output) patch.
- **Adding outputs in the Component Info popover** creates output patches inside the component.

---

## 15. Components, Systems, libraries

### 15.1 Types (VERIFIED, [Components doc](https://origami.design/documentation/workflow/components))

- **Patch Components**: only patches; like functions.
- **Layer Components**: layers and patches; reusable UI with behavior.
- Library scopes: **Platform** (iOS/Android, maintained by Meta), **Device** (Viewfinder, Text Field), **Document**, **User Library**, **Other Library / Systems**.
- **Container Components** (v98): a **Sublayer Container** layer plus **Virtual Sublayer** so instances can hold children. VERIFIED

### 15.2 Workflow (VERIFIED)

1. **Create**: select patches and/or layers → Component > Create Component / Group Into Component (**⌃⌘G**) → name it in a dropdown → Create. Ungrouping selects the ungrouped patches (v89.1). Grouping is smart about I/O connections (v88).
2. **Enter/Exit**:
   - double-click the component (Layer List, graph, or canvas artboard), ⌥↓ / ⌥↑, or breadcrumb back arrow
   - **Inspect Instance** (right-click or **⌃⌥↓**) enters without unlinking (v156, v173)
   - enter on the main component (v185)
   - inspect per-loop values of instances (v172)
3. **Publish Port ⌥P**: select a port inside, publish, and it appears as an editable Inspector property at the parent. Enum ports publish as a dropdown ([Create Component](https://origami.design/tutorials/smarter-interactions/create-component)).
4. **Component Info (⇧⌘I)** popover:
   - lists inputs and outputs
   - add ("Add" appears on hover of the Outputs label), rename, change **Type** (default Number), **Tag** (Enable, Custom, …; tags tied to types since v87), **Category**
   - reorder by drag; multi-select drag (v88); copy/paste ports (v119/120); duplicate ports (v107); delete with Delete key (v187)
   - **Loop Behavior** per input: "Pass into Component" vs "Loop the Component" (default in v82+) ([Loops concept](https://origami.design/documentation/concepts/loops))
   - detachable and resizable (v88)
5. **Libraries**: Add to User Library **⌘⌥L**; Add to Other Library **⌘⌥⇧L**; Show Patch Folder; Unlink Component from Library; Check for Local Component Updates (v123). Prompts to upgrade instances on reopen, with a **comparison view** for individual component upgrades (v84, v85). Warning about installed libraries needing updates (v195).
6. **Systems publishing** (v87 flow; new flow v156):
   - Component > **Publish Components** → System Publisher lists document and patch components
   - Continue → name, author/org, description
   - **Advanced Options**: System Identifier, version, icon (drag-drop), attached JSON for text styles, colors, data
   - Save → load by double-clicking the file or Preferences > Components > +
   - Shared-folder installs auto-update ([System Creation](https://origami.design/documentation/workflow/systemcreation))
   - The old **System Maker** format was removed in v148
7. **Renaming a main component** renames instances that weren't manually renamed (v189).
8. **Snippets** (precomposed patch sets, v107) were **removed in v177** (09/30/2024). VERIFIED

---

## 16. States and animation model (as surfaced in UI)

VERIFIED from docs:

- There is **no timeline or keyframe editor.** State and motion are patch-driven:
  - **Switch** (Flip / Turn On / Turn Off → On/Off)
  - **Option Switch** (Set to 0…N → index)
  - **Counter**
  - **Option Picker** (index selects among values)
  - **Pop Animation** (Bounciness, Speed; spring compatible with Pop/Rebound)
  - **Classic Animation** (Duration; Curve: Linear, Quadratic/Cubic/Exponential/Sinusoidal In/Out/In & Out)
  - **Transition** (Progress 0–1 → Start/End; extrapolates outside 0–1)
  - Newer additions: **Spring Animation** (typed Point/Color since v120), **Fluid Spring Animation** (v223), Cubic Bezier Animation, Repeating Animation, Smooth Value (separate rising/falling hysteresis, v204)
- **Pulse vs state** semantics with visual flashing on ports ([States & Pulses](https://origami.design/documentation/concepts/pulsesignal)).
- **Index numbers represent states** (0-based) ([States doc](https://origami.design/documentation/patch-editor/states)).
- **Screen components** (iOS/Material) with Present/Dismiss pulses, Transition Push/Modal, Start State, Edge Swipe, Progress ([ios.screen](https://origami.design/documentation/patches/ios.screen)).
- **When Prototype Starts** fires on restart and when newly inserted (v83). **Wait**, **Delay** (Style When Increasing/Decreasing) for timing ([Timed Animations](https://origami.design/tutorials/common-interactions/timed-animations)).
- Transition supports percentage values (v173). Classic Animation supports size types (v91). Classic/Pop support Position etc. (v72). Stable animations for size types (v190). Slow animations supported in Cubic Bezier (v117). The macOS "slow animations" shift modifier is INFERRED.

---

## 17. Viewer (preview window)

VERIFIED from [Previewing and Sharing tutorial](https://origami.design/tutorials/getting-started/previewing-and-sharing), [shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts), [Orientation](https://origami.design/tutorials/smarter-interactions/orientation) and release notes:

- **Viewer toolbar**:
  - **Minimize** (left of toolbar, ⌥⌘F "Mini Viewer")
  - **Maximize / Fullscreen** (⇧⌘F; the toolbar stays available in fullscreen)
  - **Restart Prototype** (⌘R per shortcuts page and Prototyping with Data; ⇧⌘R per Previewing tutorial)
  - **Viewer Settings** button menu
- **Viewer Settings menu**:
  - **Toggle Frame** (⌥D per shortcuts/Orientation; ⌥⇧⌘D per Previewing tutorial)
  - **Toggle Hand** (⌥H; repeated clicks **cycle** through hands "of varying gender and skin tone")
  - **Rotate Right ⌘⌥→** (and presumably Rotate Left ⌘⌥←, INFERRED)
  - **Enable Interface Orientation**
- **1:1 Viewer** ⌘⌥0.
- **Minimized viewer**: "can be minimized and moved around the Patch Editor… Origami will snap the minimized Viewer to the nearest corner. This also works for an expanded Viewer." It can be dragged **outside the Patch Editor into its own window** (dual monitors).
- **Viewer anchoring** is center-bottom so keyboard prototypes are correct (v186). The embedded **virtual soft keyboard** replaced the need for Fake Keyboard (v109.1) and scales with the viewer (v186).
- **Mouse/trackpad** interact as touch. **Hover** works only on desktop, not simulated or connected phones ([Hover doc](https://origami.design/documentation/patches/builtin.layer.hover)).
- **Callout layer on hover** shows the first index of a loop (v117). Hovering layers or patches highlights the layer in the Viewer. INFERRED from "Call out layer on hover" and "Crash on 3d groups callout layer" (v225).
- **Low battery mode warning** (v84, v121, v128). Dark Appearance persists across restart (v78). Does not start fullscreen on new docs (v83). Defaults to device size (v74).
- **120 fps** when available on iOS and macOS (v216).
- **Recording** happens from the Viewer (see [§19](#19-recording-and-exporting)).

---

## 18. Devices, frames, screen sizes, coordinates

- **Device picker** menu categories come from device `type`: `computer, phone, tablet, tv, watch, window, custom` ([Custom Devices](https://origami.design/documentation/workflow/customdevices)). VERIFIED
- **Default device**: **iPhone 17 Pro** (v223, 07/07/2026). VERIFIED. Device list history:
  - iPhone 13 devices, with previous devices reduced in size (v104)
  - iPhone 14 (v130; Space Black default v176)
  - Samsung S10/S10+/S20/S20+ (v100)
  - Meta **Portal / Portal Mini** (v87)
  - new devices (v223)
- **Device color** selection (undoable, v203). **Hands** overlay.
- **Custom devices**: an `.origamidevice` bundle (Show Package Contents) containing `info.json` plus PNGs. Double-click to install; re-double-click to refresh live. VERIFIED. `info.json` keys:
  - `key` (required, immutable, saved in documents)
  - `displayName` (required)
  - `screenSize` [w,h] pt/dp (required)
  - `screenScale` (required; Android 0.75–4.0 ldpi…xxxhdpi)
  - `type`, `platform` (iOS, Android, AndroidWear, WindowsPhone, Windows, OSX, tvOS, watchOS)
  - `mouseInput` (bool)
  - `viewerWindowNative` (bool: native resizable mac window)
  - `deviceInsets` [4] (required)
  - `shadowOffset` [2]
  - `deviceImages` {color: png}, `deviceImageDefault`, `deviceImageOffset`, `deviceImageScale`
  - `deviceOverlayImages` (notches)
  - `handsImages` [], `handsImageOffset`, `handsImageScale`, `handsOnTop`
  - `defaultDeviceOrientation` (Portrait, LandscapeLeft, LandscapeRight, PortraitUpsideDown)
  - `supportsDeviceOrientation*` booleans

  Many are exposed via the **Device Info** patch (Screen Size, Safe Area since v114, dark mode since v72).
- **Coordinates** (VERIFIED, [Coordinates concept](https://origami.design/documentation/concepts/coordinates)):
  - units are **pt/dp**
  - **origin (0,0) at the center** of the screen/parent by default; +X right, **+Y down**
  - **Anchor** is 0–1 in both axes (9 named presets Top Left (0,0) … Bottom Right (1,1)) and changes the origin
  - **Pivot** (0–1) is the scale/rotation origin, independent of anchor
  - the Shader Layer instead uses **top-left pixels** ([Shader Layer](https://origami.design/documentation/concepts/shaderlayer))
- **Orientation**: prototypes are locked portrait until **Interface Orientation** is enabled (Portrait, Landscape Left, Landscape Right, Upside Down; starting orientation). VERIFIED

---

## 19. Recording and exporting

- Homepage: "**Record your prototypes.** Capture, trim and export video of your prototype directly in Origami." VERIFIED ([origami.design](https://origami.design/))
- **Advanced Recording options: codec and quality** (v159, 01/23/2024). Recording settings panel (v161 fix). VERIFIED
- Recording fixes and notes (VERIFIED):
  - more accurate start time (v107)
  - resizable-window recording (v156)
  - external displays (v206)
  - recording flow stuck when stopped quickly (v127)
  - recording spinner (v127)
  - performance and fidelity (v72, v73, v76, v78)
  - **video player buttons after recording** (v150), implying an in-app post-recording player/trimmer
- **Formats**: video is confirmed. **GIF / PNG sequence** export is claimed by third-party summaries only. INFERRED/unverified. Likely MOV/MP4 given the codec option. INFERRED.
- **Export layers as images**, including layers outside artboards (v72), with device scale from the layer list (v76). VERIFIED
- **Export prototype to device** (Origami Live) via the toolbar export button. VERIFIED
- **Drag files from Origami to Finder** (v78). VERIFIED
- Camera Patch recording matches preview quality (v182). This is a separate in-prototype capture feature. VERIFIED

---

## 20. Origami Live (device preview and sharing)

VERIFIED ([previewsharing doc](https://origami.design/documentation/workflow/previewsharing), [Previewing tutorial](https://origami.design/tutorials/getting-started/previewing-and-sharing), App Store, homepage):

- **USB mirroring**: connect an iPhone/iPad, or an Android device with Developer Mode + USB Debugging and a data cable. "The frontmost prototype will immediately begin previewing… Any changes you make in Origami Studio are immediately reflected in the preview, without needing to restart it."
- **Shake the device** to exit or act on prototypes.
- **Export to device** for untethered, offline use ("No internet/network connection or cables are required").
- **Sharing**: email, Dropbox, AirDrop. iOS Live uses the Share Sheet (AirDrop); Android uses the Share Sheet (Android Beam). The currently opened file on iOS closes automatically when a new one opens (v83).
- **Share Nearby with Origami Live**: "Easily share prototypes in critique, reviews, or just for fun" (homepage). Peer-to-peer sharing fix (v110).
- **Native hardware** in Live: camera (dual camera v73), haptics (AHAP files v72), GPS, device motion (AirPods motion v113), microphone/audio metering, photo library, native keyboard with Text Field.
- **Custom fonts are not mirrored** (docs: install via AnyFont or Apple Configurator profiles). **Stale-doc flag:** v226 (08/19/2026) added "Ability to Embed fonts into a prototype", which likely removes this limitation. INFERRED.
- Requirements: iOS 15.1+ (v193; App Store). Latest Live 228.0 (Sept 7, 2026), 189.7MB. VERIFIED
- **Android status**: Android mirroring and the Play app are still described in docs, but the Play listing (`com.facebook.Origami`) returned **HTTP 404** on 2026-09-16 in two locales. Third-party APK sites surface only v2.0.1. INFERRED: Android Live is delisted or abandoned, and in practice Origami's device preview is **iOS-only** today. This is a clear gap a cross-platform preview (web/PWA or Android) could fill.

---

## 21. Import: Figma, Sketch, files, JSON

### 21.1 Figma: "Origami Pasteboard" plugin

- Figma Community plugin ID `832268423801619787`, published about June 3, 2020 for the Origami 3 beta. VERIFIED ([Figma listing](https://www.figma.com/community/plugin/832268423801619787/origami-pasteboard) via search; [figmaelements](https://figmaelements.com/plugins/origami-pasteboard/))
- Flow: open the plugin → select frames/layers → **"Copy Selected Layers"** → in Origami, Edit > Paste **⌘V**. VERIFIED ([Getting Started](https://origami.design/tutorials/getting-started/getting-started))
- Supports **custom shapes, frames, text, images, masks**. "Since Origami doesn't support multiple fills, strokes, or shadows, only the first of each will be copied." VERIFIED. Newer layer effects (v221) may change this. INFERRED.
- Carries **Auto Layout** info (v82) and **corner smoothing** (v180). "Improvements in Paste from Figma" (v78). VERIFIED
- Homepage: "Copy and paste editable vector shape and text layers into Origami." VERIFIED

### 21.2 Sketch

- Direct copy/paste: select layers in Sketch → ⌘C → Origami Edit > Paste ⌘V. VERIFIED ([Getting Started](https://origami.design/tutorials/getting-started/getting-started))
- Historic "Export for Origami" Sketch plugin (QC era, facebookarchive). VERIFIED that it exists ([GitHub](https://github.com/facebookarchive/origami/blob/master/Origami%20Plugin/Export%20for%20Origami.sketchplugin)); irrelevant to Studio.
- Hack Design mentions "Import Sketch files directly (File > Import)". Unverified in primary sources.
- After paste, layers may be slightly misaligned. Fix by dragging, and set Anchor ([Getting Started](https://origami.design/tutorials/getting-started/getting-started)).

### 21.3 Files and data

VERIFIED:

- Drag and drop images, videos, sounds, folders (→ Loop Builder), `.js` files (→ JS Patch).
- WebP (v177, JS v211). Wide gamut images (v189). EXIF orientation (v171).
- **Lottie** (`.lottie` / JSON via JSON to Lottie) (v144).
- **Pasted image origin scale** preference (v147).
- **Copy-Paste As JSON** and **CLI Origami → JSON** (v221).

---

## 22. Layer types and their properties

The docs index lists these layer patches under **Layers – Layer**, **Layers – Material**, **Layers – iOS** ([docs index](https://origami.design/documentation/)). The port lists below are VERIFIED from each layer's doc page. **Many doc pages are stale.** They omit properties that release notes added later, such as corner radius and smoothing, stroke, blend mode, effects, layout properties, independent scale, and truncation. Those additions are listed under "Release-note additions".

Common base ports (most visual layers): `Enable, Position, Anchor, Size, Opacity, Scale, Rotation, Pivot, Shadow Color, Shadow Opacity (default 0 = off), Shadow Radius, Shadow Offset`. Position uses Point 3D for Z. Rotation uses Point 3D for X/Y rotation. VERIFIED

| Layer | Documented ports (beyond base) | Notes / release-note additions |
|---|---|---|
| **Group** (`builtin.layer.layer`) | base | "Groups have a size that clips the layers within." Layout on groups; percent sizes (v98); pass-through blend (v219); "3d groups" (v225) INFERRED to be a 3D group variant |
| **Rectangle** | Color | Doc is missing Corner Radius (tutorial uses "Radius"), independent corners and smoothing (v125, v175), stroke; zero-dimension fix (v193) |
| **Oval** | Fill Color, Stroke Color, Stroke Width (default 0 = off), Start/End (0–1 stroke trim) | |
| **Shape** | Fill, Shape (path from Rounded Rectangle/Circle/Oval/Triangle/Union patches or JSON to Shape), Stroke Color/Width, Start, End | Vector shapes pasted from Figma are INFERRED to become Shape layers |
| **Text Layer** | Text, Font Name, Font Size (dp), Color, Character Spacing, Line Height, Paragraph Spacing | Anchor "Determines text alignment"; width wraps; Cap & Baseline in layout; Text Style / Text Style Builder patches for ranges; truncation (v189); variable fonts (v226); Transform port fix (v193) |
| **Image Layer** / **Image File** | Image, Fill Style (fit, fill, stretch, tile) | Loading output (v76); natural size fix (v194); no Radius, so use a Rectangle mask ([Masking](https://origami.design/tutorials/smarter-interactions/masking-layers)) |
| **Live Image** | Image, Fill Style | Auto-reloads when the file on disk changes |
| **Video Layer** / **Video File** | Video, Play, Fill Style, Video Rate, Loop, Scrub, Scrub Time, Volume (0–1), Playback (async default / sync); outputs Current Time, Duration, Natural Size | |
| **Video Stream** (HLS) | URL (.m3u8), Play, Fill Style, Video Rate, Loop, Volume | Auto sizing (v82); corner radius with smoothing (v175) |
| **Video Keyframes** | Vector Data (Keyframes exporter JSON), Play, Fill Style, Rate, Loop, Scrub… | Legacy AE Keyframes |
| **Lottie Animation** | Lottie Animation, Fill Style (fit/fill/stretch), Play, Rate (negative = reverse), Loop, Scrub, Scrub Time; outputs Current Time, Duration, Natural Size | v144 |
| **Color Fill** | Enable, Opacity, Color | Fills the parent. "Clip color fills with groups" |
| **Gradient Fill** | Type (linear/radial), Start Position, End Position, Start Color, End Color, Opacity | "Gradients as native type" (v218) suggests multi-stop gradients now (INFERRED); Gradient Builder patch |
| **Map** (static) | Map Center, Map Span | Apple Maps snapshot; Point Of Interest toggle (v166); Appearance (v201) |
| **Particle System** | Color, Lifetime, Birthrate, Color Change, Velocity, Velocity Variance, Angle, Angle Range, Acceleration (vector), Size Delta, Image | |
| **Hit Area** | Setup Mode (shows bounds) | Invisible tap target |
| **Progress Ring** | Progress, Thickness, Active Color, Inactive Color, Radius | |
| **Viewfinder** (camera) | Camera Type (front/back), Freeze, Content Mode | Device component; dual camera (v73) |
| **Shader** (SkSL) | Shader (code), Uniforms (JSON) | Children rendered to texture `iImage1`; `iResolution`; uniforms become ports; `layout(color)` becomes a Color port; `//@origami default: 0.04` annotation; Layer Inputs (v220); LLM generation (v223) |
| **Clone Layer** | Layer (source) | Live copy with independent transforms; "The Clone layer must exist before its source layer in the layer hierarchy" (v220) |
| **Reflective Layer** | not documented | "More configurations available for Reflective Layer" (v224) VERIFIED name only |
| **Liquid Glass** | not documented | "Liquid Glass Support" (v221) VERIFIED; exact form (layer vs effect) unknown |
| **Layer Effects** | not documented | "Added new patches and a port in the inspector for applying effects to layers" (v116); effects on iOS (v217); Blur "Hard Edges" (v217); "New Layer Effects" (v221); effect render topology fix (v227) |
| **Sublayer Container / Virtual Sublayer** | not documented on pages | Container components (v98) |
| **iOS components** | Screen (Present, Dismiss, Transition Push/Modal, Start State, Edge Swipe, X Offset; outputs Progress, Presented, X Offset), Text Field (Text, Font Name/Size, Text Alignment, Color, Tint Color, Editing Begin/End/Set Text, Placeholder Text/Color, Keyboard Type, Show Clear, Secure Text; outputs Editing, Text, Enter Pressed), Visual Effect (Style light / very light / dark), Fake Keyboard (Show, Appearance; outputs Return Button, Remaining H, Progress), Action Sheet, Activity Indicator, Alert View, Navigation Bar, Notification, Page Control, Segmented Control, Slider, Status Bar, Switch, Tab Bar | Text Field adapts to platform: iOS props on iOS devices, Material on Android ([Text Input](https://origami.design/tutorials/smarter-interactions/text-input)) |
| **Material components** | Alert View, Checkbox, Circular Progress, Fake Keyboard, Page Control, Screen (Scale, Previous Screen Scale), Status Bar, Switch, Text Field | Material 3 curves fix (v154) |

Interaction patches that attach to layers (via Touch):

- **Interaction**: Layer, Enable → Down, Tap, Position, Force (0–6.67)
- **Scroll**: Content Layer, Enable, Scroll X/Y None/Free/Paging, Settings → X, Y, Page X, Page Y
- **Scroll Settings**: Content Size, Direction Locking, Page Size, Page Padding, Jump Style/To/Position X/Y; tutorial mentions Rubber Band Tension/Friction (iOS defaults), Deceleration Rate (v104)
- **Hover**: Layer, Enable → Hover, Position
- **Drag, Pop Switch, Long Press, Double Tap, Gesture, Mouse, Touches, Trackpad, Keyboard** (arrows and modifiers since v114)

"Layers need to be enabled and have opacity larger than 0 to receive touches. Touches in Layer Groups are propagated and shared with the parent groups." VERIFIED ([Interactions doc](https://origami.design/documentation/patch-editor/interactions))

---

## 23. Patch categories and port types

### 23.1 Patch Library categories (docs index, VERIFIED)

Animation · Color · Data · Device · Interaction · Logic · Loops · Math · Media · Shapes · Text · Utility. There are about 180 documented patches. Release notes add patches not in the doc index:

- Text To Speech (v212)
- Text to JSON (v207)
- Object Join (v193)
- WebSocket Connection/Send/Receive (v191)
- Bluetooth LE (v217)
- Hand Detection (v217)
- Fluid Spring Animation (v223)
- Variable Font builder (v226)
- Point 4D / Edges / Corner Radius pack/unpack (v114)
- Cursor patch (v72)
- Encode/Decode (v72)
- Shimmer (doc page exists)

VERIFIED. **Stale-doc flag:** the docs index omits many of these.

### 23.2 Port/value types

VERIFIED ([Patches doc](https://origami.design/documentation/patch-editor/patches), [JS Patch API](https://origami.design/documentation/concepts/scriptingapi)):

- Docs list: Number, Boolean (checkmark), Text, Image, Video, Sound, Color (RGB/HSL), Index (non-negative int), JSON, Point (2D/3D/4D).
- JS API adds: PROGRESS (0–1 alias), POSITION, SIZE, ANCHOR, POINT3D, POINT4D, COLOR (RGBA 0–1), BOOLEAN, PULSE, INTEGER, ENUM (index), STRING, JSON, IMAGE, VARIANT; RAW_DATA mentioned in network variants.
- Other types from release notes: Edges, Corner Radius (4D), Size, Gradient (native type v218), Shape, Lottie, Text Style/Attributes, Scroll Settings, Layer references.
- **Type variance** ("generics"): e.g. `+` works on numbers, points and text. Right-click → Type to pick.

---

## 24. Visual style: theme, patch colors, cable colors

### 24.1 Theme

VERIFIED:

- **Dark mode** since v87 (04/21/2021), "defaults to system preference for visual appearance". Big Sur restyle (v80). Sonoma theme rendering (v153). Tahoe fixes (v203, v207, v212).
- **Accent color** honored (v199). Contrast and consistency color tweaks (v199).
- **Patch style contrast**: "Removed lower contrast patch styles from Experiments. Made lower contrast the default styling and added a high contrast preference" (v153, 10/29/2023).
- **Dimmed patches** (e.g. disabled or not related to a selection) have an opaque background (v153).
- Patch and layer icons updated for dark mode (v185).

### 24.2 Patch colors by category

**Documented semantic colors (VERIFIED):**

- **Purple**: Interaction patches (the "purple Interaction patch", [Getting Started](https://origami.design/tutorials/getting-started/getting-started)) and **component Input patches** ("Input ports within components are represented by purple patches", [Components doc](https://origami.design/documentation/workflow/components); "purple provider patch", [Create Component](https://origami.design/tutorials/smarter-interactions/create-component)).
- **Blue**: **layer property patches** ("a blue layer property patch is created", [Canvas doc](https://origami.design/documentation/canvas/canvas); "blue bounded properties", v180) and **component Output patches**.
- **Green**: **Loop patches** ("Loop patches in Origami are all colored green and any patches that get connected to a Loop patch will have a green tinted connection cable", [Loops](https://origami.design/documentation/concepts/loops)).
- **Gray / dark**: ordinary processing patches (math, logic, switch, animation). This comes from website rendering, below.

**Website rendering of patches** (the docs site's own HTML/CSS mock of the app). The CSS classes and hex values are VERIFIED ([documentation.css](https://origami.design/public/css/documentation.css)). How closely they match the in-app colors is INFERRED.

| Role (CSS class) | Color | Examples in docs |
|---|---|---|
| `patch processor` | `#4c4c4c` (dark gray) | `+`, Switch |
| `patch producer` | `#9129d7` (purple) | Interaction (sources/producers of values) |
| `patch consumer` | `#007eda` (blue) | Layer property patch (sinks) |
| `patch loop` | `#58a000` (green) | Loop patches |
| `patch layer` | `#f5f7f9` light panel, white header | Inspector-like layer block with a "Touch" label |
| Graph background (`patch-container`) | `#353535` | dark graph canvas |
| Patch header | `rgba(255,255,255,.1)` overlay; title 12px bold white; subtitle 10px `#ccc` | |
| Port dot | 5×5 px white circle; **50% opacity unconnected → 100% connected** | |
| Cable | white 3px, 50% opacity, 2px radius | |
| Values | 50% opacity text; pulses **flicker** (0.25s) | |

In this model, patches are colored by **data-flow role** (producer, processor, consumer, loop) rather than by library category. Pattern page thumbnails use separate website-only category colors: interaction `#bf2bc5`, logic `#b35f00`, animation `#028383`, layers `#0074c8`, scroll `#695dea`, loops `#00856c`, utilities `#454acd`. VERIFIED on the website only.

### 24.3 Port colors by type

No source documents per-type port colors. INFERRED: ports are uniform dots with an inline value preview (checkmark, number, color swatch, image thumbnail, `{…}` for JSON), and type is shown by the value widget rather than the dot color. Open question to verify with screenshots.

### 24.4 Cable colors

VERIFIED:

- green-tinted for loops
- a distinct color for selected patches' cables (v80 fix)
- highlight on selected port connections (v153)

---

## 25. AI features inside Origami (2026)

VERIFIED from release notes unless noted:

- **v221 (06/08/2026)**: "JavaScript Patch LLM generation Integration."
- **v223 (07/07/2026)**: "Shader Layer LLM generation Integration."
- **v226 (08/19/2026)**: "Fix sparkle menu validation." This implies a **sparkle (✨) menu** entry point for AI generation. INFERRED from the name.
- **v227 (08/31/2026)**: "Increased token limit for JS Patch and Layer Shader when using **Anthropic provider**." This implies **multiple selectable LLM providers**, including Anthropic, likely bring-your-own key. INFERRED.
- **v221**: Copy-Paste as JSON plus **CLI to convert Origami file to JSON**. Machine-readable documents make AI tooling possible.
- Earlier JS evolution: JS Patch released v126 (10/17/2022); enum support (v128); images (v146); deep-copy script on duplicate (v177); timers setTimeout/setInterval (v215); Http and base64 (v217); variants (v219).
- **Community**: **Kami** by Alex Widua, a macOS menu bar AI copilot generating JS Patches with GPT-4. Default **⌘J** (needs Accessibility permission to copy selected patches) or right-click "Open with… Kami". BYO OpenAI key; prepends about 2,000 tokens of API docs ([GitHub](https://github.com/alexwidua/kami)). VERIFIED
- AI can author **JS/Shader code inside a patch**. Nothing indicates that AI can **build or modify the patch graph or layers**. INFERRED from release-note wording. That gap is where our product could stand apart.

---

## 26. COMPLETE keyboard shortcut compendium

Symbols: ⌘ Command, ⌥ Option, ⌃ Control, ⇧ Shift, ⏎ Return.
Sources:

- **[S]** official [Keyboard Shortcuts page](https://origami.design/documentation/workflow/keyboardshortcuts), mirrored identically by [quickref.me](https://quickref.me/origami.html) and [usethekeyboard.com](https://usethekeyboard.com/origami/) ("71 shortcuts")
- **[RN vN]** release notes
- **[T]** tutorials
- **[D]** doc pages

### 26.1 General / insertion

| Shortcut | Action | Source |
|---|---|---|
| ⌥⏎ | Insert Patch (open Patch Library/Picker) | [S], [D intro], [T Prototyping with Data] |
| double-click Patch Editor | Open Patch Picker | [D intro], [T] |
| ⌘⏎ | Insert Layer / open Layer Library directly | [S], [D Components] |
| ⌘⇧N | Layer insertion popover / New Layer button | [D Canvas], [T Scrolling Views] (CONFLICT with ⌘⏎; see §27) |
| ⌘/ | Documentation | [S] |
| ⏎ (in picker) | Insert selected patch/layer | [D intro], [T] |
| ⌘C / ⌘V | Copy / Paste (incl. from Sketch/Figma) | [T Getting Started] |
| ⌘R | Restart Prototype | [S], [T Prototyping with Data] |

### 26.2 Single-key patch insertion (Patch Editor focused)

| Key | Patch | Source |
|---|---|---|
| I | Interaction | [S] |
| S | Switch | [S] (States doc shows ⇧S, likely stale) |
| A | Pop Animation | [S] |
| C | Classic Animation | [S] |
| T | Transition | [S] |
| K | Keyboard | [S] |
| D | Delay | [S] |
| ⇧I | Option Switch | [S] |
| O | Option Picker | [S] |
| X | Splitter | [S] |
| W | Wireless (Variable) Broadcaster | [S] |
| ⇧W | Wireless (Variable) Receiver | [S] |
| U | Pulse | [S] |
| + | Add | [S] |
| − | Minus | [S] |
| * | Multiply | [S] |
| / | Divide | [S] |
| % | Modulus / Remainder | [S] |
| ⇧A | AND | [S] |
| ⇧O | OR | [S] |
| ⇧N | NOT | [S] |
| E | Equals | [S] |
| > | Greater Than | [S] |
| < | Less Than | [S] |
| ⇧R | Progress | [S] |
| R | Reverse Progress | [S] |

### 26.3 Port-context keys (a port is selected or hovered)

| Key | Action | Source |
|---|---|---|
| s | Insert Splitter on that port | [D Splitter] |
| w (on input) | Insert matching Wireless Receiver | [T Prototyping with Data] |
| ⌥W (output selected) | Create Wireless Broadcaster inheriting the source name | [T Create Component] |
| ⌥⇧W (input selected) | Create matching Wireless Receiver | [T Create Component] |
| ⌥P | Publish Port (component input/output). The tutorial also uses it on outputs to create a broadcaster (inconsistent) | [S], [D Components], [T Create Component] |
| ⌘↑ / ⌘↓ | Move selected port up/down (multi-input patches) | [RN v100] |
| ⌘⇧↑ / ⌘⇧↓ | Move port to top/bottom of ports of the same type | [RN v100] |

### 26.4 Organizing patches

| Shortcut | Action | Source |
|---|---|---|
| ⇧⏎ | Rename patch | [S], [D Patch Organization] |
| ⏎ | Rename when a single patch is selected; edit comment title | [RN v208], [D Comment] |
| ⌘[ | Align patches left | [S] |
| ⌘] | Align patches right | [S] |
| ⌘⇧[ | Align patches top | [S] |
| ⌘⇧] | Align patches bottom | [S] |
| ⌃T | Tidy Up | [RN v92] |
| ⌥⌃C | Insert Comment Around Patches | [S], [D Patch Organization "^⌥C"] (CONFLICT: Comment doc says "ctrl command c"; tutorial uses ⌃⌥W) |
| ⌃⌘G | Create Patch Component | [S], [D Components] |
| ⌥↓ | Enter Patch Component | [S], [D Components] |
| ⌥↑ | Exit Patch Component | [S], [D Components] |
| ⌃⌥↓ | Inspect Instance (enter without unlinking) | [RN v156, v173] |
| ⌘⇧I | Patch Info / Component Info | [S], [D Components], [T Create Component] |
| ⌘⇧A | Select All Patches | [S] (RN v135 says deselect all; CONFLICT) |
| ⌘⌥L | Add Patch Component to User Library | [S], [D Components] |
| ⌘⌥⇧L | Add Patch Component to Other Library | [S] |
| Esc | Cancel shift-dragging connections; exit comment edit | [RN v172, v166, v167] |
| Delete | Delete selected ports in Component Info popover | [RN v187] |

### 26.5 Layers

| Shortcut | Action | Source |
|---|---|---|
| ⇧⏎ | Rename layer | [S], [T Text Input] |
| ⌘⇧H | Hide / Show layer | [S] |
| ⌥L | Collapse layers (recursively, selected) | [S], [RN v173] |
| ⌘⇧L | Lock / Unlock layer | [S] |
| ⌘⌥↑ | Bring Forward | [S] |
| ⌘⌥↓ | Send Backward | [S] |
| ⌘⌥⇧↑ | Bring to Front | [S] |
| ⌘⌥⇧↓ | Send to Back | [S] |
| ⌘⌥M | Mask Layer / Use as Mask | [S], [D Canvas], [T Masking] |
| ⌘⌥⇧M | Add to Mask | [S], [D Canvas] |
| ⌘G | Group layers | [S], [D Canvas] |
| ⌘⇧G | Ungroup layers | [S] |
| ⌘⌃G | Create Layer Component | [S] |
| ⌥↓ / ⌥↑ | Enter / Exit Component | [S], [T Create Component] |
| ⌃⌥↑ | Exit Component (Components doc variant) | [D Components] |
| ⌘⇧I | Layer Info / Component Info | [S] |
| ⌘⌥L | Add Layer to User Library | [S] |
| ⌘⌥⇧L | Add Layer to Other Library | [S] |
| Option-drag (canvas) | Duplicate layer | [RN v116, v117] |
| Arrow keys (canvas) | Nudge layer (measurement guides update) | [RN v155] (step sizes INFERRED 1pt, ⇧ 10pt) |

### 26.6 Viewer

| Shortcut | Action | Source |
|---|---|---|
| ⌘R | Restart Prototype | [S] (Previewing tutorial: ⇧⌘R) |
| ⌥D | Toggle Device (frame) | [S], [T Orientation] (Previewing tutorial: ⌥⇧⌘D) |
| ⌥H | Toggle Hand (cycles hands) | [S], [T Previewing] |
| ⌘⌥F | Mini Viewer (minimize) | [S], [T Previewing] |
| ⌘⇧F | Fullscreen Viewer | [S], [T Previewing] |
| ⌘⌥0 | 1:1 Viewer | [S] |
| ⌘⌥→ | Rotate Right | [T Orientation] |

### 26.7 Number inputs (Inspector and patch ports)

| Shortcut | Action | Source |
|---|---|---|
| ↑ / ↓ | ±1 | [S] |
| ⇧↑ / ⇧↓ | ±10 | [S] |
| ⌥↑ / ⌥↓ | ±0.1 | [S] |
| (keys on % fields) | Percentage scrub with keys | [RN v185] |
| Tab | Next field / next port | [RN v127, v173] |
| type expression + ⏎ | Evaluate arithmetic (e.g. `667-49-64.5`) | [T Scrolling Views] |

### 26.8 Panels, navigation, mouse gestures

| Input | Action | Source |
|---|---|---|
| ⌘7 | Collapse / open Inspector | [RN v198] |
| ⌘ + scroll | Zoom (Canvas and Patch Editor), toward cursor | [RN v72, v90, v91] |
| Pinch | Zoom | [RN v90, v212] |
| Middle mouse drag | Pan Canvas / patch graph | [RN v89.1] |
| Double-click patch/layer component | Enter component | [D Components], [RN v156] |
| Double-click patch title | Rename | [D Patch Organization] |
| Double-click empty graph | Patch Picker | [D intro] |
| Double-click a port | Insert patch connected at that port (pushes patches) | [RN v89.1, v94] |
| Shift-click inputs (output selected) | Fan-out connect | [D Patches] |
| Shift-click patches | Multi-select | [RN v180] |
| ⌘ + drag cable onto multi-input patch | Insert, pushing other connections down | [RN v89.1] |
| ⌘ + drag patch over cable | Splice patch into cable | [RN v89.1, v91] |
| ⌥ + drag patch(es) | Duplicate with input connections | [T Timed Animations], [T Prototyping with Data] |
| ⌥ + drag cable to empty space | Suggested Patch Picker | [RN v203] |
| Right-click / ⌃-click patch | Context menu (Type, inputs count, Replace With, Patch Info, …) | [T Getting Started], [RN] |
| Click wireless receiver icon | Jump to broadcaster | [RN v89.1], [D Variables] |
| Click bound value in Inspector | Center source patch | [RN v89.1, v92] |
| Click loop output value | Loop inspector popover | [D Loops] |
| Shake device (Origami Live) | Exit / act on prototype | [T Previewing] |

### 26.8b Kami (third-party) shortcut

- ⌘J opens Kami with the selected JS patch ([GitHub](https://github.com/alexwidua/kami)). VERIFIED; not part of Origami.

### 26.9 Legacy Origami for Quartz Composer (NOT Origami Studio; reference only)

VERIFIED ([greena13 cheat sheet, 2016](http://greena13.github.io/blog/2016/06/30/facebook-origami-cheat-sheet/)):

- `G` group from selected; `⌘⏎` patch list; `T/I/A/L/C/D/W/⇧S/⇧A`
- `R` reverse progress under cursor
- `⌥-click-drag` duplicate patch
- hover port + shortcut auto-creates a connected patch
- `P` on output publishes; `W` on output creates wireless
- long-click value opens slider

The hover-port insertion and single-key vocabulary carried over into Studio.

---

## 27. Docs vs release notes: staleness and conflicts

| Topic | Doc/tutorial claim | Newer or conflicting evidence | Likely current |
|---|---|---|---|
| Insert layer | ⌘⇧N ([Canvas doc](https://origami.design/documentation/canvas/canvas), Scrolling Views tutorial) | ⌘⏎ Insert Layer ([shortcuts](https://origami.design/documentation/workflow/keyboardshortcuts), Components doc) | ⌘⏎ (combined picker v82). ⌘⇧N may still work. Unverified |
| Open patch picker | "double-clicking on the Patch Editor ⌘⏎" (Getting Started) | ⌥⏎ (shortcuts, intro doc, Prototyping with Data) | ⌥⏎ |
| Create component | ⌘⌥G (Canvas doc) | ⌃⌘G (shortcuts, Components doc, Create Component tutorial) | ⌃⌘G |
| Add to library | ⌘⌥C (Canvas doc) | ⌘⌥L (shortcuts, Components doc) | ⌘⌥L |
| Enter component | "Patch > Enter Patch Group ⌘↓" (Coming From Code) | ⌥↓ (shortcuts); ⌃⌥↓ Inspect Instance (v156, v173) | ⌥↓ and ⌃⌥↓ |
| Exit component | ⌃⌥↑ (Components doc) | ⌥↑ (shortcuts, tutorial) | ⌥↑ |
| Restart prototype | ⇧⌘R (Previewing tutorial) | ⌘R (shortcuts, Prototyping with Data) | ⌘R |
| Toggle frame | ⌥⇧⌘D (Previewing tutorial) | ⌥D (shortcuts, Orientation tutorial) | ⌥D |
| Comment around patches | "ctrl command c" (Comment doc); ⌃⌥W (Create Component tutorial) | ⌥⌃C (shortcuts, Patch Organization) | ⌥⌃C |
| Patch Info | ⌘I (Math Expressions doc) | ⌘⇧I (shortcuts, Components) | ⌘⇧I |
| ⌘⇧A | "Select All Patches" (shortcuts) | "Added CMD+SHIFT+A to deselect all patches" (v135) | Unclear; needs testing |
| Switch shortcut | ⇧S (States doc) | S (shortcuts); QC era used ⇧S | S |
| Wireless naming | "Wireless Broadcaster/Receiver" (shortcuts, older docs) | "Variable Broadcaster/Receiver" (Variables concept, docs index) | Variable |
| Quick Interactions | homepage image alt "Quick Interactions"; Meta 2020 article | Removed from Canvas in v148 (08/2023) | Removed |
| Snippets | v107 feature | Removed v177 (09/2024) | Removed |
| System Maker | Legacy mention in docs ("still supports legacy files") | Support removed v148 | Removed |
| Fake Keyboard needed | Text Input tutorial uses Fake Keyboard | Embedded virtual soft keyboard in viewer, "no need for Fake Keyboard patch anymore" (v109.1) | Not needed |
| Custom fonts on device | "Origami Studio doesn't mirror custom fonts" (previewsharing doc) | "Ability to Embed fonts into a prototype" (v226) | Likely solvable now |
| Figma plugin supports only 1 fill/stroke/shadow | Plugin description | Gradients native type (v218), New Layer Effects (v221) | Possibly improved; unverified |
| Rectangle ports | Docs list no corner radius or stroke | Tutorials use Radius; smoothing v125/v175 | Docs stale |
| Docs open in-app | Patch picker docs in-app (v74, v115) | "Documentation links will now open on the website" (v177) | Website |
| Android Live | previewsharing doc and Previewing tutorial describe Android Live via Google Play, USB debugging, Android Beam sharing | Play listing returns HTTP 404 (checked 2026-09-16, en_US and en_IN); only old APK v2.0.1 visible on mirrors; Android Beam itself was removed by Google | Likely delisted; treat as iOS-only |
| Loop Behavior default | Pass into Component (v81 and older) | Loop the Component (v82+) | Loop the Component |
| Min OS | various | macOS 12+ (v177); iOS 15.1+ (v193) | as stated |

---

## 28. Implications for our product

### 28.1 Parity checklist (the "same quality and controls" bar)

**P0: core controls users will expect on day one**

1. The six-panel layout with Split View (canvas over graph), vertical split option, collapsible panels (⌘-number toggles), floating/snap-to-corner mini viewer, pop-out viewer window, fullscreen viewer.
2. Patch picker opened by double-click and ⌥⏎, with fuzzy search, aliases, inline docs pane, Return to insert, and a combined patches+layers picker. Suggested typed picker when dragging a cable into empty space.
3. Single-key insertion (the 26-key vocabulary above), port-context keys (`s` Splitter, `w` receiver), ⌥P publish.
4. Wiring:
   - drag out→in; replace-on-connect; drag end off to disconnect
   - shift-click fan-out, snap to nearest port, Esc cancel
   - ⌘-drag insert into multi-input patches; ⌘-drag patch onto cable to splice
   - ⌥-drag duplicate with inputs
   - double-click port to insert with push-apart
5. Layer bridges:
   - **Touch button** on layer rows (Tap, Scroll X/Y, component outputs)
   - **click-a-property → blue property patch** (Point patch for vector properties)
   - drag cable onto inspector property or layer name (row expands)
   - bound-value click → center source
6. Inspector:
   - arrow-key increments (±1 / ⇧ ±10 / ⌥ ±0.1)
   - drag-scrub, expression evaluation, tab order, select-all on first edit
   - 9-point anchor picker, segmented controls
   - color picker with tabs, eyedropper, alpha 0–100, system palettes, scrubbable RGBA
   - font picker with search and recents
7. Graph organization: comments (colorable, resizable from any edge, move contents, grow as you type), Tidy Up, align, rename, variables with Local/Global scope and jump-to-broadcaster, patch search by layer.
8. Value visualization: flashing pulses, inline values, port popovers, loop inspector with per-index hover, JSON visual editor, green loop cables, highlighted connections of the selected port.
9. Components: create from mixed layer+patch selection, enter/exit (⌥↓/⌥↑), inspect instance, publish ports, Component Info (types, tags, categories, loop behavior, defaults/min/max), libraries, upgrade prompts.
10. Viewer: device frames with colors, hands (cycle), rotate, interface orientation, restart, 1:1, 120 fps, soft keyboard.

**P1**

- Canvas drawing tools, live text editing, measurement guides, option-drag duplicate, checkerboard transparency, layout engine (Relative/Absolute; Auto/Grow/Fixed/%; H/V/Grid; alignment; spacing Between/Evenly/Fixed; padding; margins; cap & baseline).
- Masks (alpha), groups clip.
- Recording with trim and codec/quality options, plus GIF (a gap in Origami's verified feature set).
- Figma paste (first fill/stroke/shadow at minimum; auto layout; corner smoothing).
- Device preview app with live mirroring and offline export; nearby sharing.
- Custom device bundles (JSON schema like `info.json`).
- Bottom HUD (console, FPS, perf, asset manager).

**P2**

- Shader layer (SkSL-like), clone layer, particle system, Lottie, video streams, maps, blend modes, layer effects, liquid glass, Bluetooth LE, hand detection, text-to-speech.

### 28.2 Where we can do better (AI-native and learnable)

- **One canonical command registry.** Every menu item, shortcut, context-menu action and MCP tool maps to the same command ID. Shortcuts are then generated into docs automatically, which avoids the 12+ contradictions in [§27](#27-docs-vs-release-notes-staleness-and-conflicts). Add a ⌘K command palette showing shortcuts, and in-context shortcut hints (Origami added menu hints only in v92/v185).
- **Graph-level AI, not just code-in-a-patch.** Origami's LLM features generate code inside a JS or Shader patch (v221, v223). Our MCP surface should let Claude insert and wire patches, bind layer properties, create components, run Tidy Up, record the viewer, and read live port values. It should work on a documented, open JSON document format, since Origami only just added a JSON copy-paste format and a CLI (v221).
- **Learnability**:
  - make the ISAT pattern a guided template
  - surface the Touch menu, property-click binding and loop inspector with first-run coach marks
  - use plain-language type names ("Pulse", "State")
  - color ports by type as well as role; Origami's port colors are undocumented and appear uniform (INFERRED)
- **Deterministic recording and export** (video plus GIF plus frame sequences) scriptable via MCP for design critique artifacts.
- **Web and cross-platform** reach (Origami is macOS-only; Live requires iOS 15.1+ or Android USB debugging).

---

## 29. Open questions

1. Canvas tool palette: exact tools (rectangle, oval, text, pen/path, frame?) and their single-key shortcuts. No source found.
2. Full list of toolbar buttons and the name and number of view-mode segments beyond "Split View".
3. In-app port colors per data type, patch header colors per category, and whether the website CSS mock matches the current app.
4. Recording: export formats (GIF? MOV/MP4?), trimming UI, shortcut, frame-rate options.
5. The "three new entry points for opening patch picker" (v154).
6. Layer Effects catalog (blur with hard edges, others), Liquid Glass parameters, Reflective Layer, "3d groups".
7. LLM integration UI (sparkle menu), provider settings (Anthropic among others), privacy/keys.
8. Share Nearby protocol and discovery (Bonjour/MultipeerConnectivity?) and whether Android supports it.
9. Canvas measurement-tool trigger key, and nudge increments.
10. Whether ⌘⇧A selects or deselects all patches.
11. Whether Sketch paste still works in 2026 builds, and whether Figma import still only takes the first fill/stroke/shadow.
12. Figma plugin current version and whether it moved to a newer API.
13. Contents of the Bottom HUD (v201) and the performance gauge semantics.
14. Confirm the Android Origami Live status. The Play listing 404s, so it is presumed delisted. Does Studio still mirror to Android over USB/adb?
15. Copy-Paste As JSON / CLI schema (useful to understand; do not copy).

---

## 30. Sources

Primary (Meta):

- Homepage: https://origami.design/
- Release notes (full history v72–v228): https://origami.design/releases/
- Documentation index: https://origami.design/documentation/
- Canvas: https://origami.design/documentation/canvas/canvas
- Layout: https://origami.design/documentation/canvas/layout
- Patches: https://origami.design/documentation/patch-editor/patches
- Interactions: https://origami.design/documentation/patch-editor/interactions
- States: https://origami.design/documentation/patch-editor/states
- Animations: https://origami.design/documentation/patch-editor/animations
- Components: https://origami.design/documentation/workflow/components
- System Creation: https://origami.design/documentation/workflow/systemcreation
- Previewing & Sharing: https://origami.design/documentation/workflow/previewsharing
- Keyboard Shortcuts: https://origami.design/documentation/workflow/keyboardshortcuts
- Patch Organization: https://origami.design/documentation/workflow/patchorganization
- Custom Devices: https://origami.design/documentation/workflow/customdevices
- Concepts:
  - Loops: https://origami.design/documentation/concepts/loops
  - Coordinates: https://origami.design/documentation/concepts/coordinates
  - States & Pulses: https://origami.design/documentation/concepts/pulsesignal
  - Math Expressions: https://origami.design/documentation/concepts/mathexpressions
  - Variables: https://origami.design/documentation/concepts/variables
  - Shader Layer: https://origami.design/documentation/concepts/shaderlayer
  - Scripting Basics: https://origami.design/documentation/concepts/scriptingbasics
  - JS Patch API: https://origami.design/documentation/concepts/scriptingapi
- Patch/layer pages (examples):
  - builtin.comment: https://origami.design/documentation/patches/builtin.comment
  - builtin.layer.layer: https://origami.design/documentation/patches/builtin.layer.layer
  - builtin.layer.rectangle: https://origami.design/documentation/patches/builtin.layer.rectangle
  - builtin.layer.ellipse: https://origami.design/documentation/patches/builtin.layer.ellipse
  - builtin.layer.shape: https://origami.design/documentation/patches/builtin.layer.shape
  - builtin.layer.text: https://origami.design/documentation/patches/builtin.layer.text
  - fake_builtin.layer.emptyimage: https://origami.design/documentation/patches/fake_builtin.layer.emptyimage
  - builtin.layer.image: https://origami.design/documentation/patches/builtin.layer.image
  - fake_builtin.layer.emptyvideo: https://origami.design/documentation/patches/fake_builtin.layer.emptyvideo
  - builtin.layer.video: https://origami.design/documentation/patches/builtin.layer.video
  - builtin.layer.hls: https://origami.design/documentation/patches/builtin.layer.hls
  - builtin.layer.keyframes: https://origami.design/documentation/patches/builtin.layer.keyframes
  - builtin.layer.lottie: https://origami.design/documentation/patches/builtin.layer.lottie
  - builtin.layer.fill: https://origami.design/documentation/patches/builtin.layer.fill
  - builtin.layer.gradient: https://origami.design/documentation/patches/builtin.layer.gradient
  - builtin.layer.staticmap: https://origami.design/documentation/patches/builtin.layer.staticmap
  - builtin.layer.particle: https://origami.design/documentation/patches/builtin.layer.particle
  - origami.hitarea: https://origami.design/documentation/patches/origami.hitarea
  - origami.progressring: https://origami.design/documentation/patches/origami.progressring
  - origami.viewfinder: https://origami.design/documentation/patches/origami.viewfinder
  - fake_builtin.layer.liveimage: https://origami.design/documentation/patches/fake_builtin.layer.liveimage
  - builtin.layer.shader: https://origami.design/documentation/patches/builtin.layer.shader
  - builtin.layer.clone: https://origami.design/documentation/patches/builtin.layer.clone
  - builtin.layer.interaction: https://origami.design/documentation/patches/builtin.layer.interaction
  - builtin.layer.scroll: https://origami.design/documentation/patches/builtin.layer.scroll
  - builtin.layer.scroll.settings: https://origami.design/documentation/patches/builtin.layer.scroll.settings
  - builtin.layer.hover: https://origami.design/documentation/patches/builtin.layer.hover
  - builtin.splitter: https://origami.design/documentation/patches/builtin.splitter
  - builtin.wirelessbroadcaster: https://origami.design/documentation/patches/builtin.wirelessbroadcaster
  - builtin.multiplexer: https://origami.design/documentation/patches/builtin.multiplexer
  - builtin.javascript.expression: https://origami.design/documentation/patches/builtin.javascript.expression
  - builtin.switch: https://origami.design/documentation/patches/builtin.switch
  - builtin.transition: https://origami.design/documentation/patches/builtin.transition
  - builtin.bouncy: https://origami.design/documentation/patches/builtin.bouncy
  - builtin.classicanimation: https://origami.design/documentation/patches/builtin.classicanimation
  - ios.screen: https://origami.design/documentation/patches/ios.screen
  - material.screen: https://origami.design/documentation/patches/material.screen
  - ios.textfield: https://origami.design/documentation/patches/ios.textfield
  - ios.fakekeyboard: https://origami.design/documentation/patches/ios.fakekeyboard
  - ios.visualeffectview: https://origami.design/documentation/patches/ios.visualeffectview
- Tutorials:
  - Getting Started: https://origami.design/tutorials/getting-started/getting-started
  - Previewing and Sharing: https://origami.design/tutorials/getting-started/previewing-and-sharing
  - Coming From Code: https://origami.design/tutorials/getting-started/Coming-From-Code.html
  - Adding Logic: https://origami.design/tutorials/common-interactions/adding-logic
  - Scrolling Views: https://origami.design/tutorials/common-interactions/scrolling-views
  - Horizontal Scrolling: https://origami.design/tutorials/common-interactions/horizontal-scrolling
  - Timed Animations: https://origami.design/tutorials/common-interactions/timed-animations
  - Create Component: https://origami.design/tutorials/smarter-interactions/create-component
  - Introduction to Loops: https://origami.design/tutorials/smarter-interactions/introduction-to-loops
  - Masking Layers: https://origami.design/tutorials/smarter-interactions/masking-layers
  - Multiple States: https://origami.design/tutorials/smarter-interactions/Multiple-States.html
  - Orientation: https://origami.design/tutorials/smarter-interactions/orientation
  - Prototyping with Data: https://origami.design/tutorials/smarter-interactions/prototyping-with-data
  - Text Input: https://origami.design/tutorials/smarter-interactions/text-input
- Website CSS (patch rendering colors): https://origami.design/public/css/documentation.css
- Meta Tech, "Origami Studio 3 makes app design easier than ever" (09/25/2020): https://tech.facebook.com/engineering/2020/09/origami-studio-3-makes-app-design-easier-than-ever/
- Origami Live, App Store: https://apps.apple.com/us/app/origami-live-design-prototyping/id942636206
- Origami Live, Google Play: https://play.google.com/store/apps/details?id=com.facebook.Origami (returned HTTP 404 on 2026-09-16 for en_US and en_IN)
- Figma plugin "Origami Pasteboard": https://www.figma.com/community/plugin/832268423801619787/origami-pasteboard

Secondary:

- quickref.me Origami cheat sheet: https://quickref.me/origami.html
- UseTheKeyboard: https://usethekeyboard.com/origami/
- greena13 Origami (Quartz Composer) cheat sheet, 2016: http://greena13.github.io/blog/2016/06/30/facebook-origami-cheat-sheet/
- Figma Elements plugin page: https://figmaelements.com/plugins/origami-pasteboard/
- Hack Design toolkit: https://www.hackdesign.org/toolkit/origami-studio/
- David Somper, "Using Origami Studio as a UX/UI Designer" (04/25/2023): https://www.davidjrsomper.com/blog/origamistudio
- Kami AI copilot for Origami: https://github.com/alexwidua/kami
- Prototypr Origami 3 beta listing: https://prototypr.io/toolbox/origami-3-beta
- Origami YouTube channel: https://www.youtube.com/channel/UCfPkdJ6fs46m5JzCR7LEBpA/ (playlist content not retrievable)
- Blocked (403, not used for claims): Medium articles by Koen Bogers (Soda Studio), Laura Reyes (Bootcamp), Francis Cortez; SitePoint Sketch+Origami article.
