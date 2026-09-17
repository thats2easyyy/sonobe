# How people learn Origami Studio, what they build, and why it is hard

Research report for an open-source, AI-native desktop alternative to Meta's Origami Studio.
Research date: 2026-09-16. Latest Origami release seen: **Version 228 (09/07/2026)**, source: https://origami.design/releases/

## Legend and method

- **[VERIFIED]**: seen directly in a fetched primary or secondary source (URL given inline). Where a fetch came back as a summary rather than raw text, quoted strings are what the fetch tool returned. Treat exact punctuation as close to, not guaranteed identical to, the page.
- **[INFERRED]**: my reconstruction or judgment. Most often this is patch wiring for a canonical prototype, reasoned from verified patch port definitions, but not seen in a source.
- **[DISCREPANCY]**: docs, tutorials and release notes disagree. The release notes are treated as the source of truth.
- Clean-room note: this report records only facts about behavior, names and parameters. No proprietary code, `.origami` files or assets were downloaded or copied.
- Limits of this pass:
  - The session's web-search budget ran out partway through. Later sources were fetched directly from known URLs.
  - These pages blocked fetching (403/402/406): several Medium articles (Koen Bogers, Zi Yuan, Jake Sawyer, Laura Reyes), O'Reilly, parts of the Vuo manual, and a Figma Community file.
  - Facebook group member counts and the official YouTube channel's video list could not be retrieved.

---

## 0. Executive summary: the "gatekeeping" problem

1. **Origami is powerful but gated behind a programmer's mental model.**
   - Designers must internalize dataflow graphs, one-frame pulses versus persistent states, zero-indexed loops, a center-origin Y-down coordinate system, and four different spring parameterizations.
   - A July 2026 comparison of AI-native prototyping tools says: "The learning curve was steep, the node canvas sits closer to engineering than design". It concludes Origami is best for "Designers already fluent in the patch-graph model who want deep, hand-built control." [VERIFIED] https://www.designaistack.com/p/ai-native-prototyping-tools-in-2026
   - Hack Design lists "days to weeks for proficiency", "Mac-only", "Smaller community with fewer tutorials than competitors", and "Performance issues possible with complex patch networks" as cons. [VERIFIED] https://www.hackdesign.org/toolkit/origami-studio/
2. **The official learning path is thin and stale.**
   - There are 18 tutorials (https://origami.design/tutorials/), about 63 downloadable Patterns and 29 Examples.
   - Pattern pages are essentially "download this file" with a one-line description and a patch list. There is no written walkthrough.
   - Tutorials still reference Sketch import, iPhone-6-era 375x667 screen math, and Android preview, even though Origami Live for Android is "no longer supported" per a community post. [VERIFIED] https://www.facebook.com/groups/origami.community/posts/7206541829444637/
   - New features in 2025–2026 are documented mostly only in release notes: LLM generation for the JavaScript Patch and Shader Layer, an Anthropic provider, the Fluid Spring Animation patch, font embedding and a JSON CLI.
3. **Learning depends on reverse-engineering files.**
   - The main way to learn an idiom such as a bottom sheet, pull-to-refresh or collapsing header is to download a `.origami` file and pick it apart.
   - There is no in-app "explain this graph", no guided interactive lesson, and no live visualization of pulses flowing. The only aids are port highlighting (v153) and a Bottom HUD with consoles and FPS (v201).
4. **The community is scattered and aging.**
   - The official community is a Facebook Group (https://www.facebook.com/groups/origami.community/).
   - The most-cited third-party video series (UX Hacker) dates from 2016–2018.
   - The LinkedIn Learning course "Origami Studio for UX Design" (Tom Green, ~3h) is **discontinued**. [VERIFIED] https://opencourser.com/course/p6k8k4/origami-studio-for-ux-design
5. **Competitors have moved onboarding into the product.**
   - ProtoPie AI (open beta Feb 9, 2026) generates editable interactions from plain language and answers docs questions in-app. Its pitch: "Learn by refining real interactions, not tutorials". [VERIFIED] https://www.protopie.io/features/protopie-ai
   - TouchDesigner's OP Snippets offer 1000+ live, copyable examples, reachable by right-clicking any operator. [VERIFIED] https://docs.derivative.ca/OP_Snippets
   - Max help patchers are real, unlockable patches. Unreal Blueprints show "pulsating Active Wires". Figma exposes named spring presets with a draggable graph.
6. **Opportunity: "explainable by construction".** Implied direction for us [INFERRED]:
   - Every node, parameter and recipe is described by one schema that also drives the runtime, docs, MCP tools and Claude, so documentation cannot drift.
   - Pulses and state are always visible.
   - Springs use perceptual presets.
   - The 15–20 canonical interactions ship as step-through recipes that Claude can build live, narrate and explain.

---

## 1. Context: Origami's lineage and current state

### 1.1 Timeline

| Date | Event | Status |
|---|---|---|
| 2013/2014 | Origami released as a free patch toolkit for Apple Quartz Composer (QC). The GitHub README: "a free toolkit for Quartz Composer that makes interactive design prototyping easy and doesn't require programming." Repo archived Jan 13, 2022. | VERIFIED https://github.com/facebookarchive/origami . **DISCREPANCY**: Hack Design says 2014 (https://www.hackdesign.org/toolkit/quartz-composer/), search summaries say 2013 (Julie Zhuo's "Introducing Origami for Quartz Composer" post, which returned 403) |
| Feb 2015 | Origami 2.0 (QC-based) adds "Origami Live, Code Export, and Sketch Integration". HN commenters flag QC as "effectively deprecated: no updates since 2011". | VERIFIED https://news.ycombinator.com/item?id=9102900 |
| 2015 / 2019 / 2021 | Apple deprecates QC (2015), removes it from Xcode (2019), and it is unsupported on macOS Monterey (2021). | VERIFIED https://www.hackdesign.org/toolkit/quartz-composer/ |
| 2016 (F8), public Oct 27 2016 | Origami Studio: a native Mac app "rewritten from scratch as a native mac app in ObjC++" (Origami engineer on HN). | VERIFIED https://news.ycombinator.com/item?id=12807071 ; https://news.ycombinator.com/item?id=12806616 |
| Sep 25, 2020 | Origami Studio 3: Canvas (vector drawing plus layout engine), Quick Interactions, Photo Library, Audio Metering, Figma and Sketch support. "Canvas makes Origami more of an end-to-end design tool and makes it more intuitive to designers coming from other design tools." | VERIFIED https://tech.facebook.com/engineering/2020/09/origami-studio-3-makes-app-design-easier-than-ever/ |
| Oct 21, 2020 (v74) | "New Welcome Window with Patterns, Examples, Tutorials." "Much Improved Patch Picker Documentation" | VERIFIED https://origami.design/releases/ |
| Feb 9, 2021 (v82) | "New combined picker for patches and layers." "New Featured Templates section in the Welcome Window" | VERIFIED releases |
| Jan 27, 2022 (v107) | "Snippets, which make adding precomposed sets of patches a breeze." | VERIFIED releases |
| Oct 17, 2022 (v126) | JavaScript patch released | VERIFIED releases (summary) |
| Aug 21, 2023 (v148) | Removed Canvas quick interactions; removed old Origami System Maker file format support | VERIFIED releases |
| Sep 30, 2024 (v177) | "The Snippets feature has been removed." "Documentation links will now open on the website instead of inside the app." macOS 11 dropped (macOS 12+) | VERIFIED releases |
| Oct 13, 2025 (v204) / Oct 27, 2025 (v205) | v204 is the "Last version able to open files from before October 2023"; v205 cannot open files created about 2 years prior | VERIFIED releases |
| Jun 8, 2026 (v221) | "JavaScript Patch LLM generation Integration." "Copy-Paste As JSON." "CLI to convert Origami file to JSON." "Liquid Glass Support." | VERIFIED releases |
| Jul 7, 2026 (v223) | "Shader Layer LLM generation Integration." "Fluid Spring Animation Patch." Default device iPhone 17 Pro | VERIFIED releases |
| Aug 19, 2026 (v226) | Embed fonts; variable fonts; "Fix sparkle menu validation." | VERIFIED releases |
| Aug 31, 2026 (v227) | "Increased token limit for JS Patch and Layer Shader when using Anthropic provider." | VERIFIED releases |
| Sep 7, 2026 (v228) | Minor bugfixes. Origami Live iOS is also v228.0; requires iOS 15.1+; 3.5 stars from 60 ratings | VERIFIED releases; https://apps.apple.com/us/app/origami-live/id942636206 |

### 1.2 Who uses it and for what (internal Meta usage)

- Origami prototypes shaped "Facebook Stories, Instagram Stories, Facebook Shops, Instagram Threads, and Facebook Rooms" and the COVID-19 Information Center. [VERIFIED] https://tech.facebook.com/engineering/2020/09/origami-studio-3-makes-app-design-easier-than-ever/
- The homepage claims a "4.5x faster patch editor" and "2x faster origami viewer", plus hardware integration: photo library, audio visualization, haptics, GPS and device motion. [VERIFIED] https://origami.design/
- Hack Design frames the best fit as "Advanced interactions, VR/AR prototypes, Meta product design". Platform is "Mac only; iOS preview via Origami Live app". [VERIFIED]

### 1.3 What this means for learners [INFERRED]

- Origami is shaped by Meta's internal design culture. Designers there learn from colleagues, internal component systems and design technologists.
- External learners get the same power without that apprenticeship layer. That missing apprenticeship is the gatekeeping problem.

---

## 2. The mental model a beginner must acquire

These are the concepts every canonical prototype depends on. Each is a learning hurdle.

### 2.1 Dataflow, left to right
- "Everything in the Patch Editor flows from left to right". [VERIFIED] https://origami.design/tutorials/getting-started/getting-started
- "The ports on the left side of a patch are **inputs**, and the ones on the right are **outputs**." "An output port may connect to multiple cables, but an input port can only accept one cable at a time." Shift-click inputs to connect one output to many. [VERIFIED] https://origami.design/documentation/patch-editor/patches
- "most prototypes require only 15-20 core patches". [VERIFIED, as summarized] same page.
- No if/else: "you won't find patches analogous to `if`, `else`, `else if`, or `while` found in code." Evaluation order: "Origami simply calculates from the order in which the patches are connected" rather than operator precedence. [VERIFIED] https://origami.design/tutorials/getting-started/coming-from-code

### 2.2 The "ISAT" chain: Interaction, Switch, Animation, Transition
- The basic idiom is: **Interaction** (detect touch), then **Switch** (remember state), then **Pop/Classic Animation** (animate a 0..1 progress), then **Transition** (map progress to a property range), then layer property. [VERIFIED] Getting Started tutorial; Transition doc https://origami.design/documentation/patches/builtin.transition
- A search summary of origami.design uses the acronym "ISAT", but I could not find it on a fetched page. [INFERRED as terminology]

### 2.3 States vs pulses (the #1 conceptual hurdle)
- "A state is a value that persists over time." Pulses "are On ✓ only for a single frame. The value of the cable sending the pulse is otherwise off." They "tell patches to **perform an action**". [VERIFIED] https://origami.design/documentation/concepts/pulsesignal
- Examples from that doc: Switch outputs state and accepts pulses; Interaction's **Down** is state and **Tap** is a pulse on release; Counter outputs numeric state and accepts pulses.
- **Implicit conversion:** connecting state to a pulse port infers a pulse when the state goes off to on. The **Pulse** patch (input `On/Off`; outputs `Turned On`, `Turned Off`) makes this explicit. **Delay** can stretch a pulse into temporary state. [VERIFIED] pulsesignal page; https://origami.design/documentation/patches/builtin.pulse.html
- "A Tap in Origami lasts for one frame". [VERIFIED] https://origami.design/tutorials/common-interactions/adding-logic
- Behavior has changed recently. The docs have not caught up:
  - v187 (2/18/2025): "Pulse can trigger on subsequent frames". [VERIFIED, releases summary]
  - v188 (3/3/2025): "Fixed pulse on change on first evaluation". [VERIFIED]
  - v215 (3/18/2026): "Fixed Pulse popover visibility". [VERIFIED]
  - [DISCREPANCY] The Pulse doc page describes no historical behavior change.

### 2.4 Coordinates, anchors, pivots
- "By default, the origin (x: 0, y: 0) is in the center of the device screen." Y increases downward. Anchor uses normalized 0–1 values. "The pivot port changes the point about which a layer scales and rotates, and can be controlled separately from anchor points." [VERIFIED] https://origami.design/documentation/concepts/coordinates
- Designers coming from Figma (top-left origin, constraints) must translate. Tutorials make them do arithmetic such as `667-49-64.5` for a scroll container height. [VERIFIED] https://origami.design/tutorials/common-interactions/scrolling-views
- Interaction `Position` is "relative to the center of the layer's parent group or device". [VERIFIED] https://origami.design/documentation/patches/builtin.layer.interaction.html
- Note: the Shader Layer uses a *different* convention, "pixels (top-left origin at 0,0)". [VERIFIED] https://origami.design/documentation/concepts/shaderlayer

### 2.5 Types
- Documented port value types: Number, Boolean, Text, Image, Video, Sound, Color, Index, JSON, Point (2D/3D/4D). [VERIFIED] patches doc
- Many patches are type-variant ("Right-click to change the type (ex: number, position, color)"). [VERIFIED] Transition doc
- Later additions: Gradients as a native type (v218), Point 4D, JSON editors (v215/v216). [VERIFIED] releases

### 2.6 Loops
- The Loop patch is zero-indexed: "a Loop with a Count of 5 will be '0, 1, 2, 3, 4'". "Loop patches in Origami are all colored green and any patches that get connected to a Loop patch will have a green tinted connection cable", meaning "the connected patch graph is being evaluated for each item in the loop." [VERIFIED] https://origami.design/documentation/concepts/loops
- Loops of loops require components ("Pass into Component" vs "Loop the Component"). "components cannot _output_ a loop of loops. Outputs from looped components are appended to one another into a flat loop." [VERIFIED] same
- "When we add an Interaction patch to a looper layer, the Interactions output will then be looped as well." [VERIFIED] same

### 2.7 Variables (formerly "Wireless")
- Variable Broadcaster and Variable Receiver: "In previous versions of Origami these patches were named Wireless Broadcasters and Receivers". Local vs Global scope; global variables cascade into child components and can be overridden. [VERIFIED] https://origami.design/documentation/concepts/variables
- [DISCREPANCY] The Keyboard Shortcuts and Patch Organization pages still say "Wireless Broadcaster/Receiver". https://origami.design/documentation/workflow/keyboardshortcuts ; https://origami.design/documentation/workflow/patchorganization

---

## 3. Canonical prototypes designers build (patches, layers, step-by-step)

**Official "Patches Used" lists** come from origami.design Example/Pattern pages [VERIFIED]. **Port definitions** come from the per-patch docs [VERIFIED]. Step-by-step wiring is VERIFIED only where a tutorial describes it; otherwise it is marked INFERRED.

### 3.1 Tap to zoom / two-state transition ("Photo Zoom"): the Getting Started prototype
- **Layers:** Group, Image Layer, Text Layer, Color Fill. **Patches:** Pop Animation, Switch, Transition, Interaction. Author Danny White. [VERIFIED] https://origami.design/examples/photo-zoom
- **Steps** [VERIFIED] https://origami.design/tutorials/getting-started/getting-started:
  1. Import design: from Sketch via ⌘C/⌘V; from Figma via the "Origami Pasteboard" plugin, "Copy Selected Layers", then paste.
  2. Add an **Interaction** patch to the photo (Down/Tap).
  3. Add a **Transition** from Start `0.38` (zoomed out) to End `1`, connected to the Photo Scale.
  4. Insert **Pop Animation** so the value changes bounce.
  5. Insert **Switch** and connect Tap to **Flip**, so taps toggle.
  6. Add more Transitions using type variants: Info Group Opacity `0 → 1`, Background Color white to black.
- Shortcuts in the tutorial: "⌘⏎ or double-click Patch Editor: Open patch search"; right-click to change patch type. [VERIFIED as summarized]
- [DISCREPANCY] The Keyboard Shortcuts doc lists **⌥⏎ = Insert Patch** and **⌘⏎ = Insert Layer**. https://origami.design/documentation/workflow/keyboardshortcuts
- [DISCREPANCY/dated] Sketch is presented first as an import source.

### 3.2 Toggle / "like" heart / button feedback
- **Patches:** Interaction, then Switch (Flip), then Pop Animation, then Transition (scale). A search summary of a Creative Bloq tutorial described placing "a Switch between the Interaction and Pop Animation to toggle a heart between small and large states" and linking Pop Animation Progress to the heart's Scale. [VERIFIED via search snippet; article body not fetchable] https://www.creativebloq.com/how-to/prototype-a-mobile-app-with-origami-studio
- **Double-tap to like** [ports VERIFIED; wiring INFERRED]:
  1. Interaction `Tap` feeds the **Double Tap** patch (inputs `Tap`, `Delay`, default "0.3s"; outputs `Double Tap`, `Single Tap`). https://origami.design/documentation/patches/origami.doubletap
  2. `Double Tap` → Switch `Turn On`.
  3. Pop Animation (e.g. Bounciness high) → Transition scale `0 → 1.2`.
  4. **Delay** (Duration ~0.6s, Style "When Increasing") → Switch `Turn Off` to auto-hide the big heart.
  - Delay ports: `Value`, `Duration`, `Style` ∈ {Always, When Increasing, When Decreasing}. [VERIFIED] https://origami.design/documentation/patches/builtin.delay
- **Switch ports:** `Flip`, `Turn On`, `Turn Off` (pulses) → `On / Off` (boolean). "The Flip input works well for single interaction types (like repeated taps), while the Turn On/Turn Off inputs handle scenarios where different interactions control the switch state." [VERIFIED] https://origami.design/documentation/patches/builtin.switch.html
- Example Pop values seen: Bounciness `0`, Speed `20` (Multiple States tutorial, VERIFIED). A search summary also mentioned Bounciness 20 / Speed 6 [unverified source].
- Dribbble "Icon Interactions for Origami Studio" (13 interactions, "some haptic feedback added") shows this is a common portfolio exercise. [VERIFIED existence] https://dribbble.com/shots/3395054-Icon-Interactions-for-Origami-Studio

### 3.3 Vertical scrolling list ("Messenger Home")
- **Patches:** Scroll. **Layers:** Group, Image Layer. Author Tony Shumskas. [VERIFIED] https://origami.design/examples/messenger-home
- **Steps** [VERIFIED] https://origami.design/tutorials/common-interactions/scrolling-views:
  1. Hover the List layer, click **Touch**, choose **Scroll Y**. You get "velocity and rubber banding etc."
  2. Problem: scroll resets position to `0` and clips the Navigation Bar.
  3. Fix: create a **Group** (⇧⌘N → Group) as a container and add a temporary Color Fill to see it. Set Size H to `667-49-64.5` (= `553.5`), anchor it to the top, set Y = `64.5`, move List inside, then delete the fill.
- **Scroll patch ports:**
  - Inputs: `Content Layer`, `Enable`, `Scroll X` and `Scroll Y` ("None, Free or Paging"), `Settings`.
  - Outputs: `X`, `Y`, `Page X`, `Page Y`. "the layer scrolled inside of its parent layer group".
  - [VERIFIED] https://origami.design/documentation/patches/builtin.layer.scroll
- Pain point [INFERRED]: the scroll container is implicit (the parent group), and bounds require manual arithmetic.

### 3.4 Horizontal paging carousel ("Facebook Popular Events")
- **Patches:** Clip, Scroll, Scroll Settings. **Layers:** Image Layer. Author Jonathan Hammond. [VERIFIED] https://origami.design/examples/facebook-popular-events
- **Steps** [VERIFIED] https://origami.design/tutorials/common-interactions/horizontal-scrolling:
  1. Five cards, each 275pt wide with 10pt spacing, in an H-Scroll Group.
  2. Touch → **Scroll X**; output → Group X position.
  3. Change Scroll X from **Free** to **Paging**.
  4. Add **Scroll Settings** → `Settings` input. Page Size W = `275`; Padding W = `10`, H = `0`; **Rubber Band Tension `440`**, **Rubber Band Friction `46`** ("for Android behavior").
  5. Add **Clip** with Max `0`, Min `-1075`: Scroll X → Clip → Position.
- [DISCREPANCY] The current **Scroll Settings** doc lists only `Content Size`, `Direction Locking`, `Page Size`, `Page Padding`, `Jump Style X/Y`, `Jump to X/Y` (pulse) and `Jump Position X/Y`, with no rubber-band inputs. https://origami.design/documentation/patches/builtin.layer.scroll.settings . Either the ports moved or the tutorial is out of date. Release notes v104 mention a "Scroll deceleration rate" and v186 "Improved Scroll patch momentum scrolling". [VERIFIED releases summary]
- **Page dots** [ports VERIFIED; wiring INFERRED]:
  1. Scroll `Page X` → **Equals Exactly** against a Loop `Index` (Loop Count = number of pages).
  2. The boolean result → Transition (opacity `0.3 → 1`) on a looped Oval layer inside a Layout-enabled Group.
  - Looped layers inside "a Layout-enabled Group" "will automatically be arranged based on the Layout settings". [VERIFIED] loops doc
  - The tutorial itself "does not explain page index derivation or dot indicators". [VERIFIED as absence]
- Card-swipe carousels are a Dribbble staple ("Origami Card Swipe Interaction", "Card Swipe with Origami"). [VERIFIED existence] https://dribbble.com/shots/3084392-Origami-Card-Swipe-Interaction ; https://dribbble.com/shots/4806845-Card-Swipe-with-Origami

### 3.5 Tab bar / more than two states
- **Steps** [VERIFIED] https://origami.design/tutorials/smarter-interactions/multiple-states:
  1. Touch → Tap on each tab (Library, Photo, Video) creates three Interaction patches.
  2. Connect each `Tap` to the next input of an **Option Switch** (inputs `Set to 0`, `Set to 1`, `Set to 2`; right-click to add more; output `Option` index; "Formerly called 'Index Switch'"). https://origami.design/documentation/patches/builtin.indexswitch
  3. Add an **Option Picker** (right-click to set 3 inputs); Option Switch output → `Option`. Values `0`, `-375`, `-750`.
  4. Option Picker → **Pop Animation** `Number` (Bounciness `0`, Speed `20`) → `Progress` → Screens group Position X.
- **Swipe between tabs:** the "Tab" pattern ("Select a tab option or swipe between options") lists Scroll, Scroll Settings, Momentum Scrolling. File `Scroll_Swipeable.origami`. [VERIFIED] https://origami.design/patterns/scroll_tab
- **Tab indicator underline** [INFERRED]: a second Option Picker with underline X values → Pop Animation → underline Position X. Tapping a tab can also pulse Scroll Settings `Jump to X` with `Jump Position X`, so swipe and tap stay in sync.
- The States doc says Option Switch is for mutually exclusive states "such as tab bar selections". [VERIFIED] https://origami.design/documentation/patch-editor/states

### 3.6 Scroll-linked header: collapsing / sticky / hide-on-scroll
- **Official patterns** [VERIFIED] https://origami.design/patterns/:
  - "Collapsible: Header that collapses into a nav bar on scroll". Lists Scroll Settings, Momentum Scrolling; file `Scroll_Collapse.origami`. https://origami.design/patterns/scroll_collapsible
  - "Sticky: A sticky header that stays fixed to the top of the feed whilst scrolling". Related patches: Equals Exactly, Equals, Greater Than, Greater Than or Equal, Less Than or Equal, And, Not, Or; file `Scroll_Sticky_Header.origami`. https://origami.design/patterns/scroll_sticky
  - "Away: Display a navigation based on scroll away values".
- **Progress patch:** inputs `Value`, `Start Value`, `End Value` → output `Progress` (0–1); described as good for scroll-linked animations. [VERIFIED as summarized] https://origami.design/documentation/patches/builtin.progress.html
- **Step-by-step** [INFERRED]:
  1. Scroll (Scroll Y = Free) on the feed; output `Y` → feed Position Y.
  2. `Y` → **Progress** (Start `0`, End `-120`).
  3. → **Clip** (0..1).
  4. → **Transition** (Start `200`, End `64`) → Header Size H. A second Transition cross-fades the large title opacity `1 → 0` and the small title `0 → 1`.
  5. Sticky section headers: compare `Y` with a threshold (**Less Than**/**Greater Than**) and choose between the "in feed" and "pinned" positions via **Option Picker**.
- The Variables doc's example, a toolbar that fades by scroll position with toolbar height centralized as a variable, is exactly this idiom. [VERIFIED] https://origami.design/documentation/concepts/variables
- Principle's equivalent is **Drivers** (keyframes driven by scroll position), which is much more designer-legible. See §7.

### 3.7 Pull-to-refresh
- **Official pattern "Refresh":** "Activate a refresh indicator on scroll top cap". Patches listed: **Delay**, **Switch**, **Interaction**. File `Scroll_Pull_to_Refresh.origami`. [VERIFIED] https://origami.design/patterns/scroll_refresh
- **Step-by-step** [INFERRED]:
  1. Scroll Y (Free) gives `Y` (positive while rubber-banding past the top, INFERRED).
  2. **Greater Than** (`Y > 70`) **And** (**Not** Interaction `Down`), so it triggers on release → **Switch** `Turn On` (refreshing).
  3. Switch `On/Off` → **Pop Animation** → Transition (feed offset `0 → 60`) and spinner opacity.
  4. Spinner rotation: **Repeating Animation** (or Classic Animation, Linear) → Transition (`0 → 360`) → Rotation Z.
  5. Switch `On/Off` → **Delay** (Duration `2`, Style "When Increasing") → Switch `Turn Off`.
- Pain point [INFERRED]: there is no "overscroll" or "released past threshold" event. It must be synthesized from state plus comparisons plus pulse inference.

### 3.8 Bottom sheet with springs, drag to dismiss
- **Official pattern "Bottom Sheet":** "Present and drag dismiss a bottom sheet". Patches listed: **Progress**, **Transition**. File `Layers_Bottom_Sheet.origami`. [VERIFIED] https://origami.design/patterns/layers_bottom_sheet
- **Relevant patch definitions** [VERIFIED]:
  - **Spring Animation** https://origami.design/documentation/patches/builtin.springanimation
    - Inputs: `Number`, `Mass`, `Tension`, `Friction`, `Gesture Active`, `Gesture Velocity`. Output: `Output`.
    - "If a gesture is active, the spring will animate immediately to its destination value. When this switches from On to Off, the spring will sample the Gesture Velocity and use it for the animation." This enables "throwing an object and allowing for the spring to continue naturally from the throw point."
  - **Drag** https://origami.design/documentation/patches/origami.drag
    - Inputs: `Enable`, `Layer` (default "None"), `Start` (position), `Reset` (pulse), `Settings`. Output: `Position`.
  - **Drag Settings** https://origami.design/documentation/patches/origami.drag-settings
    - Inputs: `Clip` (bool), `Min` (point), `Max` (point), `Momentum` (bool), `Momentum Friction` ("between 0 and 950"). Output: `Settings`.
  - **Pop Switch** https://origami.design/documentation/patches/origami.popswitch
    - Inputs: `Enable`, `Layer`, `Gesture` ∈ {Swipe X, Swipe Y, Pinch Scale, Pinch Rotate, Pinch X, Pinch Y}, `Start Value`, `End Value`, `Flip`, `Turn On`, `Turn Off`, `Bounciness`, `Speed`.
    - Outputs: `Value`, `Progress`, `On/Off` ("true when current position/rotation/scale is closer to end value than start value, or after pulse triggers").
  - **Sample and Hold** https://origami.design/documentation/patches/builtin.sample.html
    - Inputs: `Value`, `Sample` (bool), `Reset` (pulse). Output: stored value.
- **Recipe A: Pop Switch sheet (beginner)** [INFERRED]:
  1. Pop Switch on Sheet with Gesture = Swipe Y, Start Value = `closedY` (e.g. `667`), End Value = `openY` (e.g. `200`).
  2. `Value` → Sheet Position Y.
  3. Open button Tap → `Turn On`; backdrop Tap → `Turn Off`.
  4. `Progress` → Transition (`0 → 0.5`) → Backdrop Opacity.
- **Recipe B: velocity-aware spring sheet (expert)** [INFERRED]:
  1. Interaction on Sheet gives `Down` (state) and `Position` (Point Unpack → Y).
  2. At touch-down, **Sample and Hold** both the sheet's current Y and the touch Y (Sample = pulse inferred from `Down`). While `Down`: dragY = currentTouchY − startTouchY + startSheetY, run through **Clip** (min `openY`, optionally a rubber-band formula above the min).
  3. Release decision: the **Pulse** patch's `Turned Off` on `Down`, then **Greater Than** (dragY > `openY + 150`) → Switch `Turn Off` else `Turn On`. A velocity check would need a derivative patch (not verified in this pass).
  4. **Spring Animation** with `Number` = (Down ? dragY : targetY) via an **Option Picker** indexed by the Down boolean, `Gesture Active` = Down, `Gesture Velocity` = measured velocity, Tension/Friction from a **Spring Converter** (below) → Sheet Position Y.
  5. Backdrop: **Progress** (Value = sheet Y, Start = closedY, End = openY) → **Transition** (`0 → 0.5`) → Backdrop Opacity. This matches the official pattern's Progress/Transition patch list.
- **Spring Converter:** inputs `Response` ("Approximately how long for the spring animation to reach its destination") and `Damping Fraction` ("A value from 0 to 1…"; 0 = endless oscillation, 1 = no bounce); outputs `Tension`, `Friction` (for Spring Animation), `Bounciness`, `Speed` (for Pop Animation). [VERIFIED] https://origami.design/documentation/patches/builtin.springconverter
- Since v223 there is also a **Fluid Spring Animation Patch** [VERIFIED releases]. I could not find its doc page or port list; see Open Questions.

### 3.9 Drag and snap to corners ("Camera Picture in Picture")
- **Patches:** Pop Animation, Switch, Transition, Interaction. **Layers:** Group, Image Layer. Author Scott Horsfall. [VERIFIED] https://origami.design/examples/camera-picture-in-picture
- **Drag pattern:** "Move a layer around the bounds of a frame", file `Interaction_Drag.origami`. [VERIFIED] https://origami.design/patterns/interaction_drag
- **Step-by-step** [INFERRED]:
  1. While Interaction `Down`, the layer follows the touch position (offset via Sample and Hold).
  2. On release, **Greater Than** on X (>0) and Y (>0) → two Switches (right/left, bottom/top).
  3. Each Switch → Pop Animation → Transition (e.g. X `-120 → 120`, Y `-280 → 280`) → Position.
- The quick path is the **Drag** patch with Drag Settings Clip/Min/Max and Momentum. [VERIFIED ports]

### 3.10 Swipe cards / swipe to reveal actions
- **Patterns:** "Swipe: Swipe between two states" (`Interaction_Swipe.origami`), "Swipe Menu: Horizonal swipe to reveal actions" (`Layers_Swipe_Menu.origami`), "Pinch & Rotate: Multi finger pinch scale and rotate states". [VERIFIED] https://origami.design/patterns/
- **Pop Switch** "helps you quickly prototype a two-state, swipeable interaction (like swiping a card left and right)". [VERIFIED via docs search summary] https://origami.design/documentation/patch-editor/interactions
- **Swipe-to-reveal** [INFERRED]: Pop Switch Gesture = Swipe X, Start `0`, End `-160` → row Position X. `Progress` → Transition for the action buttons' opacity/scale.

### 3.11 Long-press context menu
- **Long Press** patch: inputs `Down` ("from the Interaction patch's Down output") and `Delay` ("By default, the delay is 0.5s"); output `Long Press` ("Turns on when the press passes the duration specified in Delay input"). [VERIFIED] https://origami.design/documentation/patches/origami.longpress
- **Interaction** outputs: `Down` (bool), `Tap` (pulse, "as long as the touch is inside of the layer and hasn't moved"), `Position`, `Force` ("between 0 and 6.67"). With no layer set, "the touches on the whole screen are registered". [VERIFIED] https://origami.design/documentation/patches/builtin.layer.interaction.html
- **Step-by-step** [INFERRED]:
  1. Interaction `Down` → Long Press → Switch `Turn On` (menu open).
  2. Pop Animation → Transition (menu scale `0.8 → 1`, opacity `0 → 1`), plus background blur via Layer Effects (v116 "Layer Effects patches"; iOS support v217). [VERIFIED releases]
  3. A haptic on open.
  4. A backdrop Tap → `Turn Off`.
- The Principle tutorial list includes "Watch Alert – Use Long Press and Auto events". [VERIFIED] https://principleformac.com/tutorial.html

### 3.12 Timed / automatic sequences ("Facebook Live Comments")
- **Patches:** Pop Animation, When Prototype Starts, Wait, Switch, Delay, Option Switch, Option Picker. **Layers:** Gradient Fill. Author Will Harding. [VERIFIED] https://origami.design/examples/facebook-live-comments
- **Steps** [VERIFIED] https://origami.design/tutorials/common-interactions/timed-animations:
  1. **When Prototype Starts** → **Wait** (default Duration 1s) → Option Switch `Set to 1`.
  2. Five Wait patches, all fed from When Prototype Starts, with Durations `1, 3, 6, 8, 11` → `Set to 1..5`. "durations measure from prototype start, not sequentially". "The Wait patches should be ordered in shortest to longest Duration".
  3. Option Picker → Comments Position Y.
- "Restart" (⇧⌘R per the tutorial; **⌘R** per the Shortcuts doc) is essential for testing timed prototypes. [DISCREPANCY] https://origami.design/tutorials/getting-started/previewing-and-sharing vs https://origami.design/documentation/workflow/keyboardshortcuts
- The **Repeating** pattern ("Loop a linear timebase") lists Pop Animation, Classic Animation, Curve, Progress, Pulse on Change, When Prototype Starts, Repeating Pulse, Switch, Transition, Interaction. [VERIFIED] https://origami.design/patterns/animation_repeating
- **Classic Animation:** `Number`, `Duration` (seconds), `Curve` ∈ {Linear; Quadratic In/Out/In & Out; Cubic …; Exponential …; Sinusoidal …} → `Progress`. [VERIFIED] https://origami.design/documentation/patches/builtin.classicanimation

### 3.13 Stories UI (tap-through with progress segments)
- **Official material:** Meta says Origami shaped FB and IG Stories [VERIFIED]. The **Facebook Color Picker** example ("Change the text color in a Facebook Stories post") uses Option Picker, Sample and Hold, Switch, Loop, Loop Filter; layers Oval, Image Layer, Text Layer. [VERIFIED] https://origami.design/examples/facebook-color-picker
- **Counter patch:** inputs `Increase`, `Decrease`, `Jump`, `Jump to Number`, `Maximum Count` ("The counter will reset to zero when the maximum value is reached"); output `Output`. [VERIFIED] https://origami.design/documentation/patches/builtin.counter
- **Step-by-step** [INFERRED]:
  1. Full-screen Interaction; `Position` → Point Unpack → X; **Less Than** `0` gives left/right side; `Tap` **And** side → Counter `Decrease` / `Increase` (Maximum Count = N).
  2. Counter `Output` → **Option Picker** of images (or Loop Builder images + Loop Select) → story Image Layer.
  3. Timer: **Classic Animation** (Linear, Duration `5`) restarted by **Pulse on Change** of the Counter. When progress ≥ `1` (**Greater Than or Equal**) → Counter `Increase`.
  4. Segments: a Loop (Count N) of Rectangles in a horizontal Layout group. Width per index = (index < current) ? full : (index == current ? progress × full : 0), via **Less Than**/**Equals Exactly** + **Option Picker** + **Transition**.
  5. Pause on hold: Interaction `Down` → **Long Press** → freezes the timer (e.g. via Sample and Hold on progress).
- This combines pulses, state, loops, comparisons and restart-on-change. That makes it a classic "intermediate wall" project. [INFERRED]

### 3.14 Onboarding flow
- The States doc: the **Counter** patch is for "fixed-order state progressions—like onboarding flows". [VERIFIED] https://origami.design/documentation/patch-editor/states
- **Step-by-step** [INFERRED]:
  1. Next button Tap → Counter `Increase` (Maximum Count = pages + 1 or clamp) → Pop Animation → **Multiply** (`× -375`) → Pages Group Position X. Or use Scroll X Paging with Page Size `375`, so swipe and button work together via Scroll Settings `Jump to X` + `Jump Position X`.
  2. Page dots: Scroll `Page X` or Counter Output **Equals Exactly** looped Index → Transition opacity.
  3. The last page's CTA shows when **Equals Exactly** (page == N-1) → Switch → fade in.
  4. Skip → Jump to last page.
- Text input onboarding: **Origami Newsletter** example ("Building a newsletter sign up form using text input") and the Text Input tutorial. [VERIFIED] https://origami.design/examples/ ; https://origami.design/tutorials/

### 3.15 Lists and grids with loops ("Facebook Notifications")
- **Patches:** × (Multiply), + (Add), Loop, Loop Builder, Loop Select. **Layers:** Text Layer. Author Danny White. [VERIFIED] https://origami.design/examples/facebook-notifications
- **Steps** [VERIFIED] https://origami.design/tutorials/smarter-interactions/introduction-to-loops:
  1. Loop Count `6`; `Index` → Notification Group Position Y. They overlap at 0..5.
  2. Multiply by `80` → spacing.
  3. Add ~`116` → push below the header. "Making a new connection where one already exists replaces the older one."
  4. Drag a folder of images in; this auto-creates a **Loop Builder** with images → Profile Picture.
  5. Manual Loop Builder: Type Text, Number of Inputs `6`, output `Strings` → text. ⌥-drag to duplicate.
- **Interactive loops** [VERIFIED] https://origami.design/tutorials/smarter-interactions/interactive-loops:
  - Tap on the looped layer → Switch toggles colors for each item.
  - For one specific item: Tap → **Loop Select** with Index `1` ("loops and indexes always start from `0`, the second item is `1`") → Switch **Turn On** (not Flip) → navigate to Screen 2.
- **Rating** pattern related patches: Option Switch, Interaction, Loop, Loop Builder, Loop Count, Loop Over Array, Loop Filter, Loop Select, Running Total, Loop to Array. [VERIFIED] https://origami.design/patterns/loops_rating

### 3.16 Screen transitions and conditional logic ("Instagram Direct Messages")
- **Patches:** Delay, Switch, Interaction, Or, Not, And. **Layers:** Image Layer, Text Layer. [VERIFIED] https://origami.design/examples/instagram-direct-messages
- **Steps** [VERIFIED] https://origami.design/tutorials/common-interactions/adding-logic:
  1. The Send To tap turns the modal Switch on; Cancel turns it off.
  2. **Or** (Cancel Tap, backdrop Color Fill Tap) → Switch `Turn Off`.
  3. **Not** (Send To Tap). "Pulses will appear briefly on the Not patch, respective to when the layer is tapped and _not_ tapped".
  4. **And** (Or, Not) → Switch `Turn Off`. Final logic: "Have the Cancel layer _or_ Color Fill layer been tapped? _And_ has there _not_ been tapping on Send To?"
- **Screens pattern:** "Modal and push screen transition", `Utilities_Screens.origami`. [VERIFIED] https://origami.design/patterns/utilities_screens . Wiring [INFERRED]: Switch → Pop Animation → Transition (X `375 → 0` for push, Y `667 → 0` for modal) → screen Position.

### 3.17 Photo lightbox with masking ("Messenger Photo View")
- **Patches:** Pop Animation, Switch, Transition, Interaction. **Layers:** Rectangle, Image Layer. Author Danny White. [VERIFIED] https://origami.design/examples/messenger-photo-view
- **Steps** [VERIFIED] https://origami.design/tutorials/smarter-interactions/masking-layers:
  1. Put a Rectangle *below* the Image in the same Group.
  2. Layer > Use as Mask (⌥⌘M).
  3. Match the size to the image (`375 × 250`).
  4. Transition Radius `28 → 0`.
- "The downward arrow shows the layer being masked. The corner-glyph shows which layer is acting as the mask." Reason for masking: Image layers lack a native Radius property (as summarized).
- [DATED, INFERRED] Release v175 added "Corner radius smoothing on all layers with corner radius" and v125 "Smooth corner radius (squircles)", so the masking workaround may no longer be necessary for images.

### 3.18 Rich, data and sensor prototypes (advanced showcase)
All VERIFIED existence at https://origami.design/examples/ and https://origami.design/tutorials/:
- **Live data:**
  - iTunes App Store (Apple Search API), Unsplash, Weather Forecast.
  - Network Request supports multipart (v150), NDJSON streams (v189) and WebSockets (v191).
- **Device:**
  - Photo Tilt and Level Meter (Device Motion), Orientation, Camera/QR (WhatsApp QR Scan, iOS Camera), Map/Location.
  - Audio Metering (iMessage, Messenger), Game controller (v72).
  - Bluetooth LE and Hand Detection (v217), Text To Speech (v212).
- **Complex composite:** "Spotify Artist's Pick" uses about 20 patch types: Pop/Classic Animation, Text Length/Size, Option Picker, Transition, Progress, Delay, Switch, Variables, Clip, Sample and Hold, Interaction, Scroll, Or/Not/And/Equals Exactly, Min, Loop Builder, Loop Filter, Any. [VERIFIED] https://origami.design/examples/spotify-artists-pick . "Instagram Adjust" uses about 19 patch types including Point Unpack, Counter, Splitter, Comment, Loop. [VERIFIED] https://origami.design/examples/instagram-adjust
- **Scripting:** JavaScript Patch (since v126) and Shader Layer (SkSL) with LLM generation since v221/v223. [VERIFIED releases; shaderlayer doc]

### 3.19 Summary table

| # | Prototype | Core patches | Hardest concept | Official asset |
|---|---|---|---|---|
| 1 | Tap to zoom | Interaction, Switch, Pop Animation, Transition | progress 0..1 mapped to a range | Tutorial + Example |
| 2 | Like / toggle | + Double Tap, Delay | pulse vs state; auto-reset | none dedicated |
| 3 | Vertical scroll | Scroll | implicit container, bounds arithmetic | Tutorial + Example |
| 4 | Paging carousel | Scroll (Paging), Scroll Settings, Clip | page size/padding, clip bounds, dots | Tutorial + Example |
| 5 | Tab bar | Option Switch, Option Picker, Pop Animation | index-based state | Tutorial + Pattern |
| 6 | Collapsing header | Scroll, Progress, Clip, Transition | mapping scroll to property ranges | Patterns only |
| 7 | Pull to refresh | Scroll, Greater Than, Switch, Delay, Repeating | synthesizing "released past threshold" | Pattern only |
| 8 | Bottom sheet | Pop Switch or Interaction + Sample and Hold + Spring Animation, Progress, Transition | gesture velocity handoff; spring units | Pattern only |
| 9 | Drag & snap | Drag, Drag Settings / Interaction + comparisons | offsets, snapping logic | Pattern + Example |
| 10 | Swipe cards / reveal | Pop Switch | gesture enums | Patterns |
| 11 | Long-press menu | Long Press, Switch, Layer Effects | Down (state) vs Tap (pulse) | none dedicated |
| 12 | Timed sequence | When Prototype Starts, Wait, Option Switch | absolute vs sequential timing | Tutorial + Example |
| 13 | Stories | Counter, Classic Animation, Pulse on Change, Loop, comparisons | combining everything | none dedicated |
| 14 | Onboarding | Counter or Scroll Paging, Equals Exactly | state progression + dots | none dedicated |
| 15 | Loops/lists | Loop, Loop Builder, Loop Select, Math | zero index, green cables, looped interactions | Tutorials + Examples |
| 16 | Modal / logic | Switch, And/Or/Not | gating pulses with logic | Tutorial + Example |
| 17 | Lightbox mask | Transition, mask layer ordering | mask ordering glyphs | Tutorial + Example |

---

## 4. Learning resources today: inventory and quality

### 4.1 Official (origami.design and in-app)

| Resource | Contents | Quality assessment |
|---|---|---|
| **Tutorials** (18) https://origami.design/tutorials/ | Getting Started; Previewing and Sharing; Coming From Code; Adding Logic; Scrolling Views; Horizontal Scrolling; Timed Animations; Multiple States; Masking Layers; Orientation; Device Motion; Text Input; Introduction to Loops; Interactive Loops; Prototyping with Data; Create a Component; Create a System; Audio Metering [VERIFIED] | Clear, text plus screenshots, with starting files. **But:** no levels, dates or progress tracking [VERIFIED absence]; Sketch-first import; iPhone-6-size arithmetic (667pt height) [INFERRED device]; Android preview presented as supported [DISCREPANCY]; tutorial shortcuts conflict with the Shortcuts doc [DISCREPANCY]; "Create a System" describes the File > New System / `.origami-system-maker` flow while releases removed "old Origami System Maker file format support" (v148) and added a "New Component Publishing Flow" (v156) [DISCREPANCY, likely stale]. Nothing covers springs, gestures, bottom sheets, performance, the JS patch, the Shader Layer or the AI features. |
| **Patterns** (~63 across Animation, Interaction, Layers, Logic, Loops, Scroll, Utilities) https://origami.design/patterns/ | One-line description, a patch list (sometimes "Related Patches"), related patterns/examples, a download link [VERIFIED] | Good breadth that closely matches the canonical interactions. **No written explanation**; the Bottom Sheet page offers only "Present and drag dismiss a bottom sheet" plus a download [VERIFIED]. Learning means opening the file and reverse-engineering it. Typos ("Horizonal", "desinated", "choosen", "ontouch") suggest little maintenance [VERIFIED text]. |
| **Examples** (29) https://origami.design/examples/ | Meta-app recreations (Facebook, Instagram, Messenger, WhatsApp, Spotify, iTunes, Unsplash) with author, patches used, layers used, download [VERIFIED] | Excellent realism and a good patches-used index. No walkthrough beyond the linked tutorials. Several depend on third-party APIs (iTunes, Unsplash, weather), so they may break [INFERRED]. |
| **Documentation** https://origami.design/documentation/ | Concepts: Loops, Coordinates, States & Pulses, Math Expressions, Variables, WebSockets, Shader Layer, Scripting Basics, JS Patch API. Workflow: Components, Creating an Origami System, Previewing & Sharing, Keyboard Shortcuts, Patch Organization, Custom Devices. Canvas: Canvas, Layout. Patch Editor: Patches, Interactions, States, Animations. Per-patch reference across ~15 categories; layers: Layer, Material, iOS [VERIFIED] | Concept pages are good (pulses, loops, coordinates). Per-patch reference gives port descriptions but often **no defaults, ranges or units** (e.g. Pop Animation Bounciness/Speed have no defaults or ranges; Spring Animation Tension/Friction likewise) [VERIFIED absence]. Some pages are stubs (JavaScript Patch: "Executes a JavaScript Script.") [VERIFIED]. Older URL paths 404 (`/documentation/basics/Interactions.html`, `builtin.popAnimation.html`) while search engines still index them [VERIFIED 404]. **No docs for the 2026 AI features**: Scripting Basics and Shader Layer pages contain no LLM/provider/sparkle mentions [VERIFIED absence]. Previewing & Sharing still says "Origami Studio doesn't mirror custom fonts to your device" while v226 added "Ability to Embed fonts into a prototype" [DISCREPANCY]. Components page lacks Sublayer Container, entering without unlinking (v156) and the new publishing flow [VERIFIED absence]. |
| **Welcome Window** (in-app) | Patterns, Examples, Tutorials (v74, Oct 2020); Featured Templates (v82, Feb 2021); welcome header, dark mode and recent files fixes (v198, v200, v225) [VERIFIED releases] | The in-app entry point exists but just links to the same static assets. No guided lesson, checkpoints or "open the tutorial step in place". |
| **Patch Picker documentation** (in-app) | "Much Improved Patch Picker Documentation" (v74); Documentation shortcut ⌘/ [VERIFIED] | Useful at discovery time, but since v177 "Documentation links will now open on the website instead of inside the app" [VERIFIED], so the user leaves the canvas. |
| **Snippets** (in-app) | Added v107 (Jan 2022), removed v177 (Sep 2024) [VERIFIED] | Precomposed patch sets were a learnability aid, and Meta removed them. Worth studying why (unknown). |
| **Release notes** https://origami.design/releases/ | Bi-weekly cadence with version numbers | The actual source of truth, but terse ("Fix sparkle menu validation") with no linked docs. |
| **Origami Live** (iOS) | USB mirroring, exported prototypes, AirDrop/email files [VERIFIED] https://origami.design/documentation/workflow/previewsharing | Rating 3.5/5 from 60 ratings [VERIFIED]. Android: "Origami Live is no longer supported for Android devices" [VERIFIED FB post snippet]; Uptodown lists the last Android version as 2.8.1, Jan 14, 2019 [VERIFIED via search summary]. |
| **YouTube** (official channel link on homepage) https://www.youtube.com/channel/UCfPkdJ6fs46m5JzCR7LEBpA/ | Could not retrieve the video list | Unknown currency. |
| **Twitter/X** @FacebookOrigami | Linked from homepage [VERIFIED] | Activity not assessed. |

### 4.2 Community and third-party

| Resource | Details | Quality / currency |
|---|---|---|
| **Origami Community (Facebook Group)** https://www.facebook.com/groups/origami.community/ | The official community link [VERIFIED homepage]. Hosts announcements ("Origami Studio 3 is here", https://www.facebook.com/groups/origami.community/posts/3178785702220290/) and support threads ("Last supported Origami Live APK versions for Android") [VERIFIED existence] | Requires a Facebook account and is not indexable/searchable in practice. Member count unavailable [OPEN]. Knowledge gets trapped in threads [INFERRED]. |
| **UX Hacker** YouTube + https://uxhacker.co/ | "Origami Studio Tutorial #2…#10": horizontal scroll (#2), paging carousels (#3, Oct 29 2016), screen flows (#4, Oct 30 2016), multiple states (#6, Nov 1 2016), masking (#7, Nov 1 2016), live data (#10, Jul 26 2018) [VERIFIED via search summary] | Mirrors the official tutorials. 8–10 years old, pre-Canvas UI. |
| **LinkedIn Learning: "Origami Studio for UX Design"** (Tom Green, ~3h) | "This course is discontinued" [VERIFIED] https://opencourser.com/course/p6k8k4/origami-studio-for-ux-design | Gone. |
| **O'Reilly: "Prototyping with Origami Studio" [Video]** https://www.oreilly.com/library/view/prototyping-with-origami/9781492035541/ | Exists [VERIFIED search]; details blocked (403) | ISBN-style ID 9781492035541 suggests ~2018 [INFERRED]. |
| **Other YouTube intros** | "Origami Studio Intro Tutorial", "Prototyping and Animating", "Getting Started with Origami Studio", "Origami Studio Basics - UI Overview and your first prototype!", a playlist "Origami Studio Tutorials", "Origami Studio Review 2025 — Still a Top Choice or Time to Move On?" [VERIFIED titles via search; channels and dates not retrieved] | Fragmented; mostly beginner intros; few intermediate/expert recipes [INFERRED]. |
| **Medium articles** | Koen Bogers, "A review of the new Origami Studio" (Soda Studio): "can seem a bit daunting and complicated to start using", "fiddling around… watching tutorials for a few days", "kept running into things they had yet to learn" [VERIFIED via search summary; page 403]. Zi Yuan, "Prototyping with Origami Studio as a beginner" [exists; 402]. Jake Sawyer, "An intermediate guide to improve your Origami prototyping skills" [exists; 403]. Laura Reyes, "Prototyping complex ideas using Origami Studio by Meta" (Bootcamp) [exists; 403]. Li Wei Lu, "Custom Patch of Writing Function in Origami.studio" [exists] | The best idiom knowledge lives in paywalled or blocked Medium posts. |
| **Hack Design toolkit page** https://www.hackdesign.org/toolkit/origami-studio/ | Pros/cons; recommends official tutorials, examples, "Meta's design YouTube channel, and community forums"; notes "the smaller user base means fewer resources than Figma or Sketch" [VERIFIED] | Decent overview; no date. |
| **Creative Bloq tutorial** https://www.creativebloq.com/how-to/prototype-a-mobile-app-with-origami-studio | Heart-toggle walkthrough [VERIFIED via search snippet] | Article body not retrievable. |
| **Dribbble** tag https://dribbble.com/tags/origami-studio | Card swipe, icon interactions, gradient creator, app flows [VERIFIED] | Inspiration only; files are rarely shared. |
| **Kami** (Alex Widua, 2024) https://github.com/alexwidua/kami ; https://kami.alexwidua.com/ | Menu-bar copilot generating JS Patches with GPT-4. ⌘J overlay or right-click; "prepends Origami's JavaScript Patch API documentation to prompts—adding approximately 2,000 input tokens"; own OpenAI key; needs Accessibility permission ("pretty invasive permission"); "experimental software"; 73 stars; macOS 14+ [VERIFIED] | Shows community demand for AI help. It targets only code patches, not graph construction. Meta shipped a first-party equivalent in v221 (Jun 2026). |
| **Usersnap review** (Nov 5, 2015, QC-era) https://usersnap.com/blog/prototyping-facebook-origami-review/ | A designer "started working with it in the morning" and "was already able to sketch out some great user workflows" by day's end [VERIFIED] | A counterpoint: simple flows are learnable fast. The wall comes at intermediate idioms [INFERRED]. |
| **Product comparisons** | Slant community "recommends ProtoPie for most people" [VERIFIED search summary]; Threads user: "Origami is probably the most powerful? But it is node based, so some people might have trouble with the learning curve" [VERIFIED search snippet] https://www.threads.com/@ashteriyaki/post/C9DfLg2tzkY | Consistent sentiment. |

### 4.3 What is missing (gap analysis) [INFERRED from the inventory]

1. **No learning path with levels.** No beginner, intermediate or expert track, no skill map, no "you are here".
2. **No written walkthroughs for the patterns designers actually want**: bottom sheet, pull to refresh, collapsing header, stories, long press, onboarding, drag to dismiss, spring tuning.
3. **No in-product guided lessons.** No coach marks, no step validation, no "try it" checkpoints, no sandboxes.
4. **No explanation layer for existing graphs**: no "what does this patch do here", no annotated recipe view, no cause-and-effect tracing.
5. **No spring/motion literacy material**: no guidance mapping Bounciness/Speed, Tension/Friction, Response/Damping Fraction and Fluid Spring to perceived feel.
6. **No debugging curriculum**: why a tap doesn't fire (opacity 0, disabled, occluded, moved finger), why a pulse never arrives, loop propagation surprises.
7. **Docs drift.** Renamed patches (Wireless → Variable, Index Switch → Option Switch), removed features (Snippets, Quick Interactions), new features undocumented (LLM generation, Fluid Spring, font embedding).
8. **No searchable, open community Q&A.** Knowledge sits in a Facebook Group.
9. **No dates or version tags on any tutorial or doc page.**
10. **No handoff curriculum**: how Pop Bounciness/Speed maps to Pop/Rebound for engineers is only a single doc sentence (Pop Animation doc).

---

## 5. Common pain points and confusions (with evidence and implications)

### 5.1 "It's programming disguised as design"
- **Evidence:**
  - "the node canvas sits closer to engineering than design" (designaistack, Jul 20 2026) [VERIFIED].
  - On HN at launch: "The problem with tools like Origami (and Framer.js) is that you need to know coding and many designers just don't know it." [VERIFIED] https://news.ycombinator.com/item?id=12806616
  - Hack Design: "days to weeks for proficiency" [VERIFIED].
- **Why** [INFERRED]: abstractions such as progress values, transitions as range maps, pulses and loops are computational concepts with no direct designer analog. Principle's Drivers and Figma's Smart Animate expose the *effect* (keyframes, states) instead.
- **Implication:**
  - Offer two representations of the same graph: a "recipe/state view" (states, triggers, animations, like ProtoPie's Trigger→Response or Rive's state machine) and the full patch graph.
  - Let Claude translate between them.

### 5.2 Pulses vs booleans
- **Evidence:** the dedicated concept page; tutorials repeat "A Tap in Origami lasts for one frame"; inference rules (state into a pulse port = pulse on rising edge); ongoing engine changes (v187, v188, v215). [VERIFIED]
- **Typical confusions** [INFERRED]:
  - (a) Connecting `Down` (state) to `Flip` produces one flip per press, which works by accident. Connecting `Tap` to a boolean enable port gives a one-frame blip that looks like "nothing happens".
  - (b) And/Or on pulses behave differently from on states.
  - (c) Pulses are invisible unless you watch the port popover at the right moment. v215 had to fix "Pulse popover visibility".
- **Implication:**
  - Distinct port glyphs and cable styles for pulse vs state.
  - Animated "spark" traveling along pulse cables and a persistent glow for true state (like Unreal's "pulsating Active Wires", §7).
  - A pulse history strip (last N pulses with timestamps).
  - Linting: "you connected a one-frame pulse to a state input; did you mean a Switch?"

### 5.3 Logic without if/else, and evaluation order
- **Evidence:** "information passed through patches… will only continue to flow unless the comparison is false"; "Origami simply calculates from the order in which the patches are connected". [VERIFIED] Coming From Code tutorial
- **Implication:** an "explain why this value" trace (provenance) showing upstream values per frame. Claude can answer "why did the sheet not close?" by reading the trace.

### 5.4 Loops
- **Evidence:** zero-indexing, green cables, looped interactions, loops of loops needing components, flat outputs [VERIFIED loops doc]. Tutorial emphasis on "Index starts at 0" [VERIFIED]. Engine work: v172 "Inspect values for different loops in component instances", v180 "Updated loop popover labels", v193 "Loop Sum patch implemented natively", v201 "loop counts" in the HUD, v227 "Fixed JS HTTP execution when looped". [VERIFIED releases]
- **Implication:** show loop cardinality on every cable (e.g. "×6"). Hover a looped port to see a mini table of per-index values. Warn when two loops of different lengths meet (propagation rules).

### 5.5 Spring tuning (four parameterizations and no presets)
- **Evidence** [VERIFIED docs/releases]:
  - Pop Animation: `Bounciness`, `Speed` (compatible with "Pop for iOS, Rebound for Android, and Rebound JS for web"). https://origami.design/documentation/patches/builtin.bouncy.html
  - Spring Animation: `Mass`, `Tension`, `Friction` + gesture velocity.
  - Spring Converter: `Response`, `Damping Fraction` → Tension/Friction/Bounciness/Speed.
  - Fluid Spring Animation Patch (v223, undocumented).
  - Momentum Scrolling: `Scrolling Friction` 1–100, `Rubber Band Tension` 10–1000, `Rubber Band Friction` 10–1000; "For advanced use only — use the Scroll patch instead." https://origami.design/documentation/patches/builtin.momemtumscrolling
  - Drag Settings `Momentum Friction` 0–950. Tutorial Scroll Settings rubber band `440`/`46`.
  - No documented defaults or ranges for Bounciness/Speed/Tension/Friction.
- **Contrast** [VERIFIED]:
  - Figma gives named presets "Gentle", "Quick", "Bouncy", "Slow" plus Custom Stiffness/Damping/Mass with a draggable graph ("Adjusting mass also changes the millisecond value for the duration setting"). https://help.figma.com/hc/en-us/articles/360051748654-Prototype-easing-and-spring-animations
  - Apple (WWDC23) moved to two perceptual parameters, `duration` and `bounce`, with presets `smooth`, `snappy`, `bouncy`. https://developer.apple.com/videos/play/wwdc2023/10158/
- **Implication:**
  - One spring model internally, exposed perceptually (duration + bounce, with presets) and with converters shown live for handoff (tension/friction, stiffness/damping/mass, Pop bounciness/speed, SwiftUI, Android, CSS/Motion).
  - Draw the curve inline on the node.
  - "Feel" presets named after the canonical interactions ("sheet", "toggle", "like pop").

### 5.6 Hit areas and touch handling
- **Evidence** [VERIFIED]:
  - "Layers need to be enabled and have opacity larger than 0 to receive touches. Touches in Layer Groups are propagated and shared with the parent groups." https://origami.design/documentation/patch-editor/interactions
  - Tap only fires if the touch "hasn't moved".
  - The Hit Area patch (inputs `Enable` default true, `Position` Point 3D, `Anchor`, `Size`, `Setup Mode` "true when the hit area is in setup mode"). https://origami.design/documentation/patches/origami.hitarea
  - v163 "Fixed wireless receiver jumping to broadcaster"; v176 "Fixed layer properties hiding after Viewer click"; v174 "Fixed hover layers getting stuck". [VERIFIED releases]
- **Typical confusions** [INFERRED]:
  - An invisible (opacity 0) overlay intended as a tap target doesn't receive taps.
  - Parent/child double firing.
  - Small icons with no enlarged target.
  - Scroll and tap conflicts (a moved finger cancels Tap).
- **Implication:**
  - A "show hit targets" overlay in the viewer.
  - Per-layer "hit slop" property.
  - Explicit propagation policy (capture/bubble/stop) with a visual indicator.
  - Claude can diagnose "tap not firing" by checking opacity, enable, occlusion and movement.

### 5.7 Coordinates and layout
- **Evidence:** center origin, Y down, anchor vs pivot [VERIFIED coordinates doc]. Hard-coded arithmetic in tutorials (`667-49-64.5`, `-1075`) [VERIFIED]. v170.1 fixed "layout spacing on groups with percentage sizing" and "center-aligned grid layout vertical shift" [VERIFIED].
- **Implication:**
  - Offer a top-left mode or at least visual guides.
  - Bounds and clip values derived automatically from content ("clip to content bounds" toggle rather than typing `-1075`).
  - Device-agnostic measurements.

### 5.8 Components and libraries
- **Evidence** [VERIFIED]:
  - Create via ⌃⌘G; publish ports ⌥P ("purple or blue patch[es]"); Component Info ⇧⌘I; Add to User Library ⌘⌥L; share via team "Dropbox folders"; "Unlink Component from Library" to make one-off changes. https://origami.design/documentation/workflow/components
  - Entering a component "without having to unlink it" arrived only in v156 (Dec 2023). v189 "Main component renaming updates unmodified instances"; v192 "Error when ungrouping components with sublayers"; v195 "Warning for installed libraries needing updates"; v185 "Reduced file size via improved component dependency saving".
- **Implication:**
  - Components should be as simple as Figma's (main/instance, overrides).
  - Libraries as git-friendly packages with semver.
  - No "unlink to edit" trap.

### 5.9 Graph organization and "spaghetti"
- **Evidence** [VERIFIED]:
  - Official advice is naming patches by effect (e.g. "Photo is Full Screen"), Comments, and Wireless/Variables. https://origami.design/documentation/workflow/patchorganization
  - Constant UI fixes: v143 "New Patch Redesign"; v153 lower contrast plus "Improved port highlighting showing only connections to/from selected port"; v160 "Connections will now snap to the closest port"; v180 "Access all patches associated with a layer via new patch graph search surface"; v192 "Comment patches grow as you type"; v208 Enter to rename.
- **Implication:**
  - Auto-layout ("tidy") that respects dataflow.
  - Collapsible groups.
  - "Show only the subgraph that drives this layer" (Origami added this in v180).
  - Claude-generated names and comments ("name all patches by effect").

### 5.10 Performance and debugging
- **Evidence** [VERIFIED]:
  - Hack Design con: "Performance issues possible with complex patch networks".
  - v201 "Bottom HUD with consoles, asset manager, loop counts, performance gauge, FPS counter"; v215 "Performance improvements in animations during FPS drops"; v216 "120fps support when available"; v194 "Fixed large image values slowing patch graph panning/zooming"; v159 "Fixed crash with large patch quantities on screen".
  - JS console "limits output to 50 messages maximum"; "Origami must be opened at all times while editing a JavaScript Patch". https://origami.design/documentation/concepts/scriptingbasics
- **Implication:**
  - A per-node cost profiler (time per frame, loop counts).
  - Frame-by-frame scrubbing and recording of all port values (time-travel debugging).
  - A headless evaluation API so Claude can run prototypes and assert behavior.

### 5.11 Device preview
- **Evidence** [VERIFIED]:
  - USB required for mirroring ("Connect an iOS or Android device via USB and run Origami live"); Android needs Developer Mode + USB debugging and "a cable that supports data transfer". https://origami.design/documentation/workflow/previewsharing
  - Android Live no longer supported (FB group post).
  - Custom fonts historically didn't mirror (Anyfont or Apple Configurator 2 workarounds), fixed by v226 embedding.
  - v193 "Origami Live now requires iOS 15.1 or later".
  - Viewer shortcuts ⌘R restart, ⌥D toggle device, ⌥H toggle hand, ⌘⌥F mini viewer, ⌘⇧F fullscreen, ⌘⌥0 1:1.
- **Implication:**
  - Zero-install preview (QR code → browser/WebGPU runtime on any phone, iOS or Android) with Wi-Fi hot reload.
  - Native companions are optional.

### 5.12 File sharing, compatibility, platform
- **Evidence** [VERIFIED]:
  - "Recipients must have Origami Studio or Origami Live installed to be able to edit or view a project." https://origami.design/tutorials/getting-started/previewing-and-sharing
  - Mac-only (HN: "It is Mac only. If you don't have one, no need to spend time following the link"). AlternativeTo and others list Windows alternatives.
  - v204/v205 file-compatibility cutoffs (pre-Oct 2023 files need v204).
  - v177 "Javascript patches deep-copy script when duplicating; won't update all instances".
  - v221 finally adds "Copy-Paste As JSON" and a "CLI to convert Origami file to JSON".
  - No web export in the preview docs [VERIFIED absence].
- **Implication:**
  - Open, documented, diffable JSON format from day one, with a stable schema and migrations (never strand old files).
  - Cross-platform desktop.
  - Web viewer links for stakeholders.
  - A graph clipboard format that Claude can read and write.

### 5.13 Docs vs release notes drift
- **Evidence:** see the §4.1 discrepancies:
  - shortcuts (⌘⏎ vs ⌥⏎; ⇧⌘R vs ⌘R);
  - Wireless vs Variable naming;
  - Android support;
  - custom fonts;
  - rubber-band ports;
  - System Maker flow;
  - AI features undocumented;
  - dead doc URLs still indexed.
- **Implication:** generate reference docs from the node schema at build time and version them with the app. Publish `llms.txt`/MCP resources. Rive already publishes https://rive.app/docs/llms.txt [VERIFIED]; https://origami.design/llms.txt returns 404 [VERIFIED].

### 5.14 Process critique: polishing micro-interactions before flows
- **Evidence** [VERIFIED] https://news.ycombinator.com/item?id=12809001: "so much emphasis is placed on polishing micro-interactions before the app flow is even in place". Implementing "fancy little triggered animations takes so much time that no one has time to peek at the iOS guidelines and notice how the design actually breaks 80% of Apple's rules." An Origami engineer responded that the team added "premade iOS and Android components for the most common things". [VERIFIED] https://news.ycombinator.com/item?id=12806616
- **Implication:** ship platform-faithful standard components (iOS/Material sheets, tab bars, lists) as defaults so beginners start with correct behavior and customize from there. Claude can flag guideline violations.

### 5.15 AI features are there but opaque
- **Evidence** [VERIFIED releases]: "JavaScript Patch LLM generation Integration" (v221), "Shader Layer LLM generation Integration" (v223), "Fix sparkle menu validation" (v226), "Increased token limit… when using Anthropic provider" (v227). No doc page describes them [VERIFIED absence on scriptingbasics and shaderlayer pages].
- **Interpretation** [INFERRED]: Meta's AI integration generates *code inside nodes* (JS and SkSL). It does not build or explain the *patch graph*, which is where designers struggle. That gap is our wedge: graph-level generation, explanation and tutoring via MCP.

---

## 6. What beginners vs experts need

### 6.1 Beginners (designers new to node tools, PMs, students, non-designers)

| Need | Why (evidence) | Product response [INFERRED] |
|---|---|---|
| First success in under 5 minutes | Usersnap designer productive in a day on simple flows; Koen Bogers "few days" for a simple app | Welcome flow builds "tap to zoom" live with 3 clicks; Claude narrates |
| Plain-language concepts | ProtoPie "a Trigger is an event that triggers specific actions, called Responses"; Rive "designers, you already think in state machines" | A trigger/state/animation "recipe view" over the graph |
| See cause and effect | Pulses last one frame and are invisible | Animated pulses, value badges on cables, time scrubber |
| Guardrails and lint | pulse/state mismatches, opacity-0 hit targets | Inline warnings with one-click fixes |
| Perceptual controls | Figma presets; SwiftUI duration/bounce | Spring presets, curve preview |
| Templates for canonical interactions | Patterns exist but are unexplained | 17+ recipes (§3.19), each with an annotated step-through |
| Frictionless device preview | USB, iOS-only Live, Android dropped | QR to browser |
| Learn inside the tool | Docs open on the website since v177 | Inline docs, examples on every node (TouchDesigner OP Snippets, Max help patchers) |
| Ask "why?" | No explain feature | "Explain this patch/selection/graph" via Claude |

### 6.2 Intermediate (can do ISAT, hits the wall at gestures, loops, logic)

| Need | Response [INFERRED] |
|---|---|
| Gesture idioms (sheet, drag to dismiss, pull to refresh, stories) | First-class gesture nodes with velocity, thresholds and snap points; recipes |
| Loop literacy | Cardinality badges, per-index inspector, loop-length mismatch warnings |
| Organization | Auto-tidy, subgraph focus, auto naming/commenting |
| Debugging "why didn't it fire" | Provenance trace, breakpoints on pulses, watch values (Unreal-style) |
| Reuse | Simple components with overrides; library sharing |

### 6.3 Experts (design technologists, prototypers at big companies)

| Need | Evidence | Response [INFERRED] |
|---|---|---|
| Speed | 25+ single-key insert shortcuts (I Interaction, S Switch, A Pop Animation, C Classic Animation, T Transition, D Delay, ⇧I Option Switch, O Option Picker, X Splitter, U Pulse, ⇧A AND, ⇧O OR, ⇧N NOT, E Equals, ⇧R Progress, R Reverse Progress, + − * / %) [VERIFIED shortcuts doc] | Keep single-key insertion plus a command palette; Claude "insert recipe" |
| Scripting | JS Patch (timers, WebSockets, network, base64, WebP) and Shader Layer (SkSL) [VERIFIED] | JS/TS nodes with type definitions, shader nodes, LLM generation grounded in node API |
| Data and hardware | Network Request, WebSockets, BLE, camera, hand detection [VERIFIED releases] | Same breadth over time; a WebSocket/MCP bridge so external agents drive prototypes |
| Handoff | Pop/Rebound-compatible spring values [VERIFIED] | Export spring and timing specs per platform |
| Stability and compatibility | v204/v205 cutoffs [VERIFIED] | Schema migrations, never break old files |
| Performance | HUD, FPS, 120fps [VERIFIED] | Profiler, per-node timing, headless test runs |
| Team systems | Component systems, Dropbox shared folders [VERIFIED] | Git-backed libraries, semver, update prompts |
| Automation | CLI to JSON (v221) [VERIFIED] | Full CLI + MCP server: create, inspect, validate, render frames, record video |

---

## 7. Competitors and adjacent tools: how they onboard, and what to steal

### 7.1 ProtoPie
- **Model:** Trigger → Response on layers. Seven trigger categories: Touch (Tap, Double Tap, Long Press, Drag, Pinch, Rotate, Fling, Pull), Conditional (Chain, Range, Start, Detect), Mouse, Key, Input (Focus, Return), Sensor (Tilt, Compass, Sound, 3D Touch, Proximity, Receive, Voice Command), plus Responsive Properties. [VERIFIED] https://www.protopie.io/learn/docs/interactions/triggers
- **Formulas** add logic; **variables** hold text, number or color and are scene-scoped by default. [VERIFIED] https://www.protopie.io/learn/docs/formulas/getting-started ; https://www.protopie.io/learn/docs/variables/getting-started
- **ProtoPie School** (announced Oct 12, 2022) https://www.protopie.io/blog/protopie-school-free-protopie-courses-for-all-levels:
  - Courses: Quick Start, ProtoPie 101, Connect, masterclasses (Digital Dashboard, Voice Assistant, Mobile Game, TV & Video).
  - "Each course is divided into micro lessons with video tutorials recorded by our ProtoPie experts"; "e-books and a wrap-up session to help you revise and test yourself"; "Study at your own pace, pressure-free."
  - ProtoPie 101: "6 hours", "20+ lessons", "All Levels", free; discussion tabs and ebook highlighting. [VERIFIED] https://learn.protopie.io/course/protopie-101
  - The site is titled "Master Prototyping & Get Certified". [VERIFIED title] https://learn.protopie.io/
- **Handoff** (formerly Interaction Recipes) documents interactions for developers. [VERIFIED search summary]
- **ProtoPie AI** (open beta Feb 9, 2026) https://www.protopie.io/blog/protopie-ai-beta-launch ; https://www.protopie.io/features/protopie-ai:
  - "Generate interaction logic from plain language"; "See behaviors appear directly on the canvas"; "All AI outputs remain fully editable".
  - "Learn by refining real interactions, not tutorials"; "Reduce trial-and-error prompt loops".
  - @mentions for layers; "AI Planning & Docs feature answers questions about features and formulas"; responses can include Mermaid diagrams and formulas (search summary).
  - Positioning: "AI helps you start. Manual control lets you finish properly."
- **Steal:**
  - (a) A human-readable trigger/response vocabulary as a *view* on our graph.
  - (b) Micro-lessons with wrap-up quizzes.
  - (c) An AI panel with @layer mentions whose output is always editable nodes.
  - (d) An in-app docs Q&A.
  - (e) Handoff recipes generated from the graph.
  - (f) Sensor/connect curriculum by industry vertical.

### 7.2 Framer
- **Framer Academy:** 105 lessons in 9 topics (Basics 23, Agents 14, CMS 16, Publishing 18, Animations 44, Layout 24, Content 26, SEO & AEO 16, Design Systems 40). "Learn how to design, build, and publish with Framer Agents"; 2–7 minute videos plus hands-on Canvas practice; "Prompt, build and publish your first site with Framer". [VERIFIED] https://www.framer.com/academy/ . Templates lessons: https://www.framer.com/academy/topics/templates [VERIFIED existence]
- **Steal:** short video lessons tied to the canvas; an "agent-first" first project (prompt → refine on canvas); a templates marketplace as a learning surface.

### 7.3 Rive (state machines)
- **Concepts:** states (timeline animations or blends), transitions, inputs, listeners (Pointer Enter/Exit/Click). "designers, you already think in state machines… whenever you design a hover effect, a pressed state, or an animated flow". [VERIFIED] https://rive.app/blog/how-state-machines-work-in-rive (Jun 26, 2025)
- **Inputs:** Boolean ("true or false"), Trigger ("similar to booleans, but can only become true for a short time"), Number. Now deprecated: "For new projects: Use Data Binding instead." [VERIFIED] https://rive.app/docs/editor/state-machine/inputs . Note that Rive's **Trigger** is exactly Origami's pulse, but named for designers.
- **Learning:** Rive 101 YouTube series; Marketplace to "open them directly in the editor to see how they're built"; community forum, Discord, blog, tips & tricks; third-party courses (School of Motion Rive Academy Vol. 1, Rive Masterclass, Skillshare); docs index at `llms.txt`. [VERIFIED] https://rive.app/docs/tutorials/learn-rive
- **Steal:**
  - (a) Name pulses "Triggers" in beginner mode.
  - (b) A state-machine view for multi-state UIs.
  - (c) "Open any community file in the editor" with remix.
  - (d) `llms.txt` and agent-readable docs.
  - (e) A designer analogy in the first lesson.

### 7.4 Figma prototyping
- **Interactive components** (prototype connections between variants inside a component set); variables, conditionals, expressions. [VERIFIED] https://help.figma.com/hc/en-us/articles/360061175334-Create-interactive-components-with-variants ; https://help.figma.com/hc/en-us/articles/14506587589399-Use-variables-in-prototypes
- **Advanced prototyping examples:** required checkbox, empty-selection error, selected-count display, click counter, volume bar. Taught with numbered steps plus screenshots. [VERIFIED] https://help.figma.com/hc/en-us/articles/17146044893591-Advanced-prototyping-examples
- **Playground files:** "Interactive components and variables playgrounds" exists in Community [VERIFIED existence via search; page 403]. https://www.figma.com/community/file/1423605574737012630/interactive-components-and-variables-playgrounds
- **Springs:** presets Gentle/Quick/Bouncy/Slow plus Custom (Stiffness, Damping, Mass, draggable graph). [VERIFIED] https://help.figma.com/hc/en-us/articles/360051748654-Prototype-easing-and-spring-animations
- **Steal:**
  - (a) Playground files: pre-built, half-finished prototypes with instructions on the canvas.
  - (b) Named spring presets with graph dragging.
  - (c) Interaction-at-component-level so behaviors travel with instances.

### 7.5 Principle
- **Drivers:** "Drivers work similarly to an animation timeline, except drivers animate based on a changing property, instead of time". Draggable/scrollable layers auto-list as driver sources; keyframes are set with a "Rhomb" button. [VERIFIED search summary of Toptal guide] https://www.toptal.com/designers/prototype/a-practical-guide-to-ui-animation
- **Official tutorials:** Scrolling and Tabs; Components; Component Messages; Paged Scrolling; Intro to Drivers; Working with Images; Watch Alert (Long Press and Auto events); plus 5 example files ("Scroll to position on click", "Sticky header"). [VERIFIED] https://principleformac.com/tutorial.html
- **Steal:** a "driver" node that maps any continuous input (scroll, drag, time) to a keyframed multi-property timeline. This replaces the Progress→Clip→Transition chain for scroll-linked headers with a visual curve editor.

### 7.6 Flinto
- **Transition Designer:** "No timelines, no programming, just put stuff where you want it to go". **Behavior Designer** handles micro-interactions ("buttons, switches, looping animations"). "Extensive documentation, active community, 100+ tutorial videos"; 14-day free trial; Mac; iOS viewer. [VERIFIED] https://www.flinto.com/
- **Steal:** demonstration-based animation. Pose the start and end screens and let the tool infer the transition, then drop into the graph for logic.

### 7.7 Quartz Composer (ancestor)
- "Hours to understand patches; weeks to master complex compositions"; 2005–2019. [VERIFIED] https://www.hackdesign.org/toolkit/quartz-composer/
- **Lesson:** Origami inherited QC's patch paradigm and some of its learning cliff.

### 7.8 Noodl (open source)
- Open-sourced visual node platform. Guides, videos from under 2 minutes to over 2 hours, "Build Along Videos" (task list app, survey app, star rating component), "Templates & Prefabs"; "you don't need any previous coding skills to start learning". [VERIFIED] https://docs.noodl.net/2.9/docs/learn/ ; repo now "NodeGX" https://github.com/The-Low-Code-Foundation/OpenNoodl
- I could not verify an in-editor interactive lesson system. [OPEN]
- **Steal:** build-along projects and reusable prefabs (auth flows, tables) as installable modules.

### 7.9 cables.gl
- Beginner series: "The next 4 tutorials will help you get started" (Drawing A Circle, Transformations, Color, More Transformations); "Byte Size video series"; OP Reference List; "Basic Example Patches"; public patches gallery; docs open to contribution ("Edit this file on github"). [VERIFIED] https://cables.gl/docs/1_beginner/beginner ; https://cables.gl/docs/docs
- Framing: "cables is your model kit for creating beautiful interactive content"; "just as easy as creating cable spaghetti". [VERIFIED]
- **Steal:** open-source, community-editable docs; a public gallery of remixable patches; ops-as-code for contributors.

### 7.10 TouchDesigner
- **OP Snippets:** "1000+ live examples", accessed by "Right-clicking an existing operator and selecting 'Operator Snippets...'", from the OP Create dialog, or the Help menu. Community submissions are screened: "Each contributed snippet takes some effort on Derivative's end to screen, polish and assure they follow current best practices." [VERIFIED] https://docs.derivative.ca/OP_Snippets
- **Palette** of pre-built components. Curriculum at learn.derivative.ca: "The 100 Series: TouchDesigner Fundamentals" 101–109 (Environment, TOPs, CHOPs, 3D, Components, UI, Python, Resources, POPs). "There are a lot of operators to work with in TouchDesigner (500+), so how can one learn what each operator does?!" [VERIFIED] https://learn.derivative.ca/courses/100-fundamentals/lessons/108-resources/topic/exploring-examples-in-opsnippets/
- **Steal:**
  - (a) "Right-click any node → Examples" that opens small, live, copyable graphs.
  - (b) A curated, vetted snippet library.
  - (c) A numbered fundamentals curriculum.

### 7.11 Vuo
- **Node Library** "designed to jump-start your Vuo experience — so that you may sit down and immediately begin exploring and composing, without having to take time out to study reams of documentation"; a Node Documentation Panel appears on click. Node sets declare `exampleCompositions` that "the Vuo editor will display in the node class documentation". Port popovers show "the events and data that flow along the cable". [VERIFIED via search summaries of https://doc.vuo.org/2.1.0/manual/the-vuo-editor.xhtml and https://github.com/vuo/vuo/blob/main/documentation/api/PackagingNodeSets.md ; direct fetch 406]
- **Steal:** per-node example compositions embedded in the docs panel; port popovers that show event flow.

### 7.12 Max/MSP (adjacent, the gold standard for node help)
- "A Help patcher opens with an example that shows an object in action, and is an actual Max patch that can be unlocked, edited, or copied elsewhere"; reference pages describe inlets/outlets and message responses. [VERIFIED search summary of Cycling '74 docs] https://docs.cycling74.com/max7/tutorials/basicchapter01
- **Steal:** every node ships a *live, editable help graph*. We can auto-generate these from recipes and let Claude explain them.

### 7.13 Unreal Blueprints (adjacent, debugging visibility)
- "you should see the pulsating 'Active Wires' as your script executes"; breakpoints; "Watch this value"; "The Execution Trace stack shows a list of the nodes executed with the most recent at the top". [VERIFIED] https://dev.epicgames.com/documentation/unreal-engine/blueprint-debugging-example-in-unreal-engine
- **Steal:** animated pulse wires, breakpoints on pulses, watch lists, an execution trace. This directly solves Origami's invisible-pulse problem.

### 7.14 Learnability ideas to steal: consolidated

| Idea | Source | Addresses | Our version [INFERRED] |
|---|---|---|---|
| Live help graph per node | Max help patchers; TouchDesigner OP Snippets; Vuo exampleCompositions | Docs out of context (Origami since v177) | "Examples" tab on every node; drag a snippet in |
| Animated pulses / active wires | Unreal Blueprints | Pulse vs state invisibility | Sparks on pulse cables, glow on true booleans, value chips |
| Named perceptual spring presets + graph | Figma; SwiftUI duration/bounce presets | Four spring parameterizations | Single spring node: preset, duration, bounce; live curve; converters for handoff |
| Trigger/Response vocabulary | ProtoPie; Rive Triggers | Designer mental model | "Recipe view" and beginner naming ("Trigger" = pulse) |
| State machine view | Rive | Multi-state logic | Auto-derived state diagram from Switch/Option Switch/Counter nodes |
| Driver timelines | Principle | Scroll-linked Progress/Clip/Transition chains | "Driver" node with a keyframe curve over any input |
| Pose-based transitions | Flinto Transition Designer | Math-heavy transitions | Pose A/B on canvas → auto graph |
| Playground files | Figma Community | Blank-canvas paralysis | Half-built exercises with on-canvas instructions and checks |
| Micro-lessons + wrap-up | ProtoPie School | No curriculum | In-app lesson track with checkpoints validated by the runtime |
| AI generates editable logic, docs Q&A, @mentions | ProtoPie AI; Framer Agents | Blank graph, "how do I" | Claude via MCP builds graphs step by step, explains, lints |
| Open community gallery, remix | Rive Marketplace; cables.gl patches | FB-group lock-in | Public gallery with open files and version history |
| Community-editable docs, llms.txt | cables.gl GitHub docs; Rive llms.txt | Drift | Schema-generated docs in repo; llms.txt; MCP resources |
| Numbered curriculum | TouchDesigner 100 series | No levels | 100 (ISAT), 200 (scroll & gestures), 300 (loops & data), 400 (components & systems), 500 (scripting, shaders, hardware) |
| Build-along projects | Noodl; UX Hacker series | Intermediate wall | Build-alongs for stories, bottom sheet, onboarding |
| Premade platform components | Origami engineer on HN | Guideline violations | iOS/Material sheets, tabs, lists as recipes |

---

## 8. Implications for our product (AI-native, MCP, learnable) [INFERRED throughout]

1. **One schema to rule them all.**
   - Node definitions carry: ports, types, pulse/state semantics, defaults, ranges, units, an example graph, a plain-language description and "common mistakes".
   - The runtime, inspector, reference docs, `llms.txt`, MCP tool schemas and Claude's system context are all generated from it. This makes Origami's docs drift (§5.13) structurally impossible.
2. **Claude as tutor, not just generator.** Origami's AI (v221/v223) writes code inside nodes. We should operate on the *graph*:
   - MCP tools: `list_nodes`, `get_node_schema`, `get_graph`, `add_node`, `connect`, `set_param`, `create_component`, `apply_recipe`, `run_prototype`, `simulate_touch`, `capture_frame`, `get_port_history`, `explain_selection`, `lint_graph`.
   - "Teach mode": Claude builds a recipe one visible step at a time, pauses for the user to reproduce or predict, and validates with `get_port_history`.
   - "Explain this": select any subgraph and get "When the user releases the sheet below 150pt, this Greater Than sends a trigger that turns the Switch off, which animates…"
3. **Make the invisible visible.** Pulse sparks, state glow, loop cardinality badges, value chips, a timeline scrubber recording all port values, breakpoints on pulses, a "why didn't this fire?" provenance panel.
4. **Motion literacy built in.** A single spring model with perceptual controls and presets (named after canonical interactions); an inline curve; live converters to tension/friction, stiffness/damping/mass, Pop bounciness/speed, SwiftUI `.spring(duration:bounce:)`, Android and CSS; gesture-velocity handoff as a checkbox, not a wiring puzzle.
5. **Gesture-first nodes for canonical idioms.** Sheet/drawer, draggable with snap points, overscroll/refresh, scroll driver, stories timer, carousel with page index, long press menu. Each is a composite that can be "exploded" into primitive nodes for learning (progressive disclosure).
6. **Recipe library = the curriculum.** §3.19 as a numbered track with annotated graphs, a "try" checkpoint and a remix button, all runnable headless in CI so recipes never rot.
7. **Hit-target and propagation tooling.** Overlay, hit slop, explicit capture/bubble/stop, and a lint for opacity-0 targets.
8. **Frictionless sharing and preview.** Cross-platform desktop, a QR web viewer, an open JSON format with migrations, a CLI, and git-friendly libraries.
9. **Beginner vocabulary mode.** "Trigger" vs "State", "Driver", "Recipe", with the expert names (Pulse, Switch, Transition) shown on hover.
10. **Clean-room caution.** Do not replicate Origami's example files, pattern files, assets, icons or Meta-app recreations. Build our own recipes from first principles and platform-neutral designs.

---

## 9. Open questions (could not verify in this pass)

1. **Fluid Spring Animation Patch** (v223): port names, parameters (response/damping fraction? duration/bounce?), and whether it supersedes Spring Converter.
2. **Origami's LLM integration** (v221/v223/v226/v227): which providers (the Anthropic provider is confirmed), where the "sparkle menu" lives, how API keys are configured, whether it can generate or explain *patch graphs* or only JS/SkSL.
3. **Keyboard shortcuts:** which is current for insert patch (⌘⏎ per tutorials vs ⌥⏎ per the Shortcuts doc) and restart (⇧⌘R vs ⌘R).
4. **Scroll Settings rubber-band ports:** whether `Rubber Band Tension/Friction` still exist (tutorial) or were removed (doc).
5. **Android preview:** official status; the docs still describe Android setup.
6. **Facebook Group:** member count, activity level, most common question categories.
7. **Official YouTube channel:** content, recency, view counts.
8. **Why Snippets were removed** (v177) and whether Featured Templates still exist in the Welcome Window.
9. **Origami Studio 3 "Quick Interactions":** removed in v148 ("Removed Canvas quick interactions"). Was this the beginner-friendly path, and why was it cut?
10. **O'Reilly "Prototyping with Origami Studio"** course: author, date, TOC.
11. **Contents of blocked Medium articles** (Koen Bogers, Zi Yuan, Jake Sawyer, Laura Reyes) for first-person pain points.
12. **Existence of a derivative/velocity patch** for gesture velocity in Spring Animation recipes (needed for the expert bottom sheet).
13. **Whether Noodl had in-editor interactive lessons**, and details of Vuo's Show Events mode (manual fetch blocked).
14. **Licensing of origami.design example/pattern files:** assume not redistributable; confirm before referencing any of them in our docs.

---

## 10. Source index (primary unless noted)

- Origami home: https://origami.design/
- Release notes: https://origami.design/releases/
- Tutorials: https://origami.design/tutorials/
  - https://origami.design/tutorials/getting-started/getting-started
  - https://origami.design/tutorials/getting-started/previewing-and-sharing
  - https://origami.design/tutorials/getting-started/coming-from-code
  - https://origami.design/tutorials/common-interactions/adding-logic
  - https://origami.design/tutorials/common-interactions/scrolling-views
  - https://origami.design/tutorials/common-interactions/horizontal-scrolling
  - https://origami.design/tutorials/common-interactions/timed-animations
  - https://origami.design/tutorials/smarter-interactions/multiple-states
  - https://origami.design/tutorials/smarter-interactions/masking-layers
  - https://origami.design/tutorials/smarter-interactions/introduction-to-loops
  - https://origami.design/tutorials/smarter-interactions/interactive-loops
  - https://origami.design/tutorials/smarter-interactions/create-component
  - https://origami.design/tutorials/smarter-interactions/create-system
- Patterns: https://origami.design/patterns/ (bottom sheet, refresh, collapsible, sticky, tab, swipe menu, touch, drag, swipe, rating, screens, full, repeating)
- Examples: https://origami.design/examples/ (photo-zoom, messenger-photo-view, messenger-home, facebook-popular-events, facebook-notifications, camera-picture-in-picture, traffic-light, whatsapp-filters, instagram-direct-messages, instagram-adjust, facebook-live-comments, spotify-artists-pick, facebook-color-picker, instagram-boomerang)
- Docs:
  - Index: https://origami.design/documentation/
  - Concepts: /concepts/pulsesignal, /concepts/loops, /concepts/variables, /concepts/coordinates, /concepts/scriptingbasics, /concepts/shaderlayer, /concepts/websockets
  - Workflow: /workflow/components, /workflow/keyboardshortcuts, /workflow/previewsharing, /workflow/patchorganization
  - Patch Editor: /patch-editor/patches, /patch-editor/interactions, /patch-editor/animations, /patch-editor/states
  - Patches: builtin.bouncy, builtin.springanimation, builtin.springconverter, builtin.classicanimation, builtin.transition, builtin.progress, builtin.indexswitch, builtin.switch, builtin.counter, builtin.delay, builtin.pulse, builtin.sample, builtin.javascript, builtin.layer.scroll, builtin.layer.scroll.settings, builtin.layer.interaction, builtin.momemtumscrolling, origami.drag, origami.drag-settings, origami.popswitch, origami.doubletap, origami.longpress, origami.hitarea
- Origami Live App Store: https://apps.apple.com/us/app/origami-live/id942636206
- Origami Studio 3 announcement: https://tech.facebook.com/engineering/2020/09/origami-studio-3-makes-app-design-easier-than-ever/
- QC-era repo: https://github.com/facebookarchive/origami
- Hacker News: https://news.ycombinator.com/item?id=12806616 ; https://news.ycombinator.com/item?id=12807071 ; https://news.ycombinator.com/item?id=12809001 ; https://news.ycombinator.com/item?id=9102900
- Facebook Group: https://www.facebook.com/groups/origami.community/ ; post https://www.facebook.com/groups/origami.community/posts/7206541829444637/
- Secondary:
  - https://www.hackdesign.org/toolkit/origami-studio/
  - https://www.hackdesign.org/toolkit/quartz-composer/
  - https://www.designaistack.com/p/ai-native-prototyping-tools-in-2026
  - https://usersnap.com/blog/prototyping-facebook-origami-review/
  - https://opencourser.com/course/p6k8k4/origami-studio-for-ux-design
  - https://uxhacker.co/tag/origami-studio-tutorials/
  - https://github.com/alexwidua/kami
  - https://kami.alexwidua.com/
  - https://dribbble.com/tags/origami-studio
  - https://www.threads.com/@ashteriyaki/post/C9DfLg2tzkY
- Competitors:
  - ProtoPie: https://www.protopie.io/learn/docs/interactions/triggers ; https://www.protopie.io/blog/protopie-school-free-protopie-courses-for-all-levels ; https://learn.protopie.io/course/protopie-101 ; https://www.protopie.io/blog/protopie-ai-beta-launch ; https://www.protopie.io/features/protopie-ai
  - Framer: https://www.framer.com/academy/
  - Rive: https://rive.app/blog/how-state-machines-work-in-rive ; https://rive.app/docs/editor/state-machine/inputs ; https://rive.app/docs/tutorials/learn-rive
  - Figma: https://help.figma.com/hc/en-us/articles/360051748654-Prototype-easing-and-spring-animations ; https://help.figma.com/hc/en-us/articles/17146044893591-Advanced-prototyping-examples
  - Apple: https://developer.apple.com/videos/play/wwdc2023/10158/
  - Principle: https://principleformac.com/tutorial.html
  - Flinto: https://www.flinto.com/
  - Noodl: https://docs.noodl.net/2.9/docs/learn/
  - cables.gl: https://cables.gl/docs/1_beginner/beginner ; https://cables.gl/docs/docs
  - TouchDesigner: https://docs.derivative.ca/OP_Snippets ; https://learn.derivative.ca/courses/100-fundamentals/lessons/108-resources/topic/exploring-examples-in-opsnippets/
  - Vuo: https://doc.vuo.org/2.1.0/manual/the-vuo-editor.xhtml (via search summary)
  - Max: https://docs.cycling74.com/max7/tutorials/basicchapter01 (via search summary)
  - Unreal: https://dev.epicgames.com/documentation/unreal-engine/blueprint-debugging-example-in-unreal-engine
