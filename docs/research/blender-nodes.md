# Blender Node Editor UX (Geometry Nodes, Shader Nodes, Compositor): Reference for a Best-in-Class Patch Editor

Research date: 2026-09-16. Current Blender: **5.2 LTS** (released 2026-07-14, supported to July 2028; [blender.org press](https://www.blender.org/press/blender-5-2-lts-release/)). The **5.3** release notes are already published at developer.blender.org and describe the main branch.

## 0. Method, sources, and confidence legend

**Sources used (primary)**
- **Blender Manual, latest = 5.2 LTS** ([docs.blender.org/manual/en/latest](https://docs.blender.org/manual/en/latest/)). The live HTML pages would not parse through the fetch tool because the navigation markup is too large. I read the same manual as RST source instead, from the copy bundled with the official Blender Lab MCP server v1.0.3 (`~/.local/share/blender-mcp/1.0.3/blmcp/data/manual`). Its `versions.rst` lists 5.1 as the previous version, so it matches 5.2. URLs below point to the equivalent live pages.
- **Release notes** 3.0 to 5.3 ([developer.blender.org/docs/release_notes/](https://developer.blender.org/docs/release_notes/)). I downloaded the `nodes_physics`, `geometry_nodes`, `node_editor`, `user_interface`, `compositor`, `python_api` and `keymap` pages and converted them to text.
- **Default keymap source**, main branch, fetched 2026-09-16: [`scripts/presets/keyconfig/keymap_data/blender_default.py`](https://github.com/blender/blender/blob/main/scripts/presets/keyconfig/keymap_data/blender_default.py), functions `km_node_editor`, `km_node_link_modal_map`, `km_transform_modal_map`, `_template_node_select` and `km_node_editor_tool_*`. It is the ground truth for shortcuts and is newer than the manual.
- **Blender C++ source** (GPL; used only to learn behavior, no code copied): `link_drag_search.cc`, `node_socket_tooltip.cc`, `node_tree_update.cc`, `node_relationships.cc`, `drawnode.cc`, `node_intern.hh` ([github.com/blender/blender](https://github.com/blender/blender) main).
- **Developer blog posts**: [Frame Node Improvements (2025-05)](https://code.blender.org/2025/05/frame-node-improvements/), [New Socket Shapes (2025-08)](https://code.blender.org/2025/08/new-socket-shapes/), [Bundles and Closures (2025-08)](https://code.blender.org/2025/08/bundles-and-closures/).
- **Python API RST** (bundled; mirrors [docs.blender.org/api/current](https://docs.blender.org/api/current/)).
- **MCP servers**: [Blender Lab MCP server](https://www.blender.org/lab/mcp-server/) (local install v1.0.3 inspected), [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) (`server.py` fetched), and the [MindStudio field report](https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance).

**Legend**
- **VERIFIED** means I saw it in a cited source.
- **INFERRED** means my own reasoning or extrapolation.
- **DOC-DRIFT** marks a place where the manual disagrees with the keymap, source, or release notes. The newer source wins.

Keyboard notation follows Blender: `LMB`/`RMB`/`MMB` are mouse buttons, "drag" means click-drag, and Ctrl is Cmd-equivalent on macOS for OS-level shortcuts such as copy and paste (INFERRED for our Mac-first tool: map Blender's Ctrl to Cmd where it is a "command" modifier, and keep Ctrl/Alt(Option) for gestures).

---

## 1. Doc drift summary (what the manual gets wrong or leaves out)

| Topic | Manual (5.2) says | Actual (keymap / release notes) | Status |
|---|---|---|---|
| Delete with Reconnect | `Ctrl-X` | **`Shift-X`** (and `Ctrl-Delete`). `Ctrl-X` is now **cut** = copy + dissolve (`node.delete_copy_reconnect`). 5.3 notes: "Ctrl+X now cuts nodes (dissolve + copy). Dissolve was moved to Shift+X." | DOC-DRIFT, VERIFIED in [keymap](https://github.com/blender/blender/blob/main/scripts/presets/keyconfig/keymap_data/blender_default.py) and [5.3 UI notes](https://developer.blender.org/docs/release_notes/5.3/user_interface/) |
| Frame join | Brief assumed `Ctrl+J` | **`F`** = Join in New Frame with a label popup (`node.join_named`) since 4.5. `Ctrl+J` = **Join Group Inputs** (5.0). Make Links moved from `F` to **`J`** in 4.5. | VERIFIED: [4.5 UI notes](https://developer.blender.org/docs/release_notes/4.5/user_interface/), [5.0 UI notes](https://developer.blender.org/docs/release_notes/5.0/user_interface/), keymap |
| Detach | Brief assumed `Alt+D` | `Alt+D` = **Duplicate Linked**. Detach-and-move = **`Alt`+LMB drag** on a node (`node.move_detach_links_release`). Node Wrangler "Detach Outputs" = `Shift-Alt-D`. | VERIFIED keymap, manual editing page, Node Wrangler page |
| Copy/Paste placement | "pasted node will be placed in the *same* position as when it was copied" | Since **3.5**, paste goes at the **mouse position**. Since 5.1 it snaps to the grid when snapping is on, and copy/paste works between Blender instances and editor types. | DOC-DRIFT, VERIFIED [3.5 notes](https://developer.blender.org/docs/release_notes/3.5/nodes_physics/), [5.1 UI notes](https://developer.blender.org/docs/release_notes/5.1/user_interface/) |
| Socket shapes | `fields.rst` still lists Circle / Diamond / **Diamond with Dot**. `parts.rst` says "Single (Square)… represented by a circular socket shape". | 5.0 redesign: **vertical line = single**, **diamond = field**, **circle = dynamic**, plus **grid** and **list** shapes. Diamond-with-dot **removed**. Shapes are **static** except on Group Input/Output. | DOC-DRIFT, VERIFIED [New Socket Shapes blog](https://code.blender.org/2025/08/new-socket-shapes/), source `node_tree_update.cc` |
| Enter/exit group | `Tab`, `Ctrl-Tab` | Also **double-click** a group node to enter, and **double-click empty space** or **click the breadcrumbs** to exit (5.0). | Manual incomplete, VERIFIED [5.0 UI notes](https://developer.blender.org/docs/release_notes/5.0/user_interface/), keymap `node.group_enter_exit` DOUBLE_CLICK |
| Viewer shortcuts | Assign `Ctrl-1..9`, activate `1..9` | Since 5.0 the number keys **toggle** viewers instead of only enabling them. | VERIFIED [5.0 GN notes](https://developer.blender.org/docs/release_notes/5.0/geometry_nodes/) |
| Collapse and Hide Unused | Menu path says "Unconnected Sockets", shortcut `H` for both | `H` = `node.hide_toggle`, `Ctrl-H` = `node.hide_socket_toggle`. `collapse_hide_unused_toggle` has **no default shortcut** in the keymap. | DOC-DRIFT (copy-paste error in manual), VERIFIED keymap |
| `NodeTreeInterface.move` | 4.0 release-notes sample uses `to_index=` | Current API: `move(item, to_position)`, `move_to_parent(item, parent, to_position)` | VERIFIED bundled API RST |
| Socket colors | Manual calls Image "apricot" and Closure "light brown" | Source RGBA: Image ≈ (0.39, 0.22, 0.39) purple; Closure ≈ (0.49, 0.49, 0.23) olive. Colors may also differ by theme. | Mismatch, VERIFIED `drawnode.cc` |
| Brief: "dotted diamond" | — | Diamond-with-dot existed from 3.0 to 4.5. **Removed in 5.0.** Dashed **links** still mean "a field that needs context". | VERIFIED blog |

---

## 2. Adding nodes: Add menu (Shift+A) and search-as-you-type

### 2.1 Add menu
- **`Shift-A`** opens `NODE_MT_add` (VERIFIED keymap `op_menu("NODE_MT_add", Shift A)`). The same menu is in the header's *Add* menu ([manual node_editors](https://docs.blender.org/manual/en/latest/interface/controls/nodes/node_editors.html)).
- **Type-to-search**: since **4.0**, "Add menus can be searched by immediate typing" (b688414223). Any regular dropdown or context menu can be searched by pressing **spacebar** (35d3d52508). **Recently searched items** appear at the top of search lists, with a preference to disable this (8362563949). VERIFIED [4.0 UI notes](https://developer.blender.org/docs/release_notes/4.0/user_interface/)
- 4.2: "Slightly improved sorting in search when adding nodes". The node **description** shows as a tooltip when hovering the node title. VERIFIED [4.2 UI notes](https://developer.blender.org/docs/release_notes/4.2/user_interface/)
- 4.5, **operation-level search**: the search finds **specific node operations**, e.g. typing an operation name finds a Math node preset to that operation ("Add Math Node"). It also finds **input sockets directly** ("Input Node Socket Search"). VERIFIED [4.5 UI notes](https://developer.blender.org/docs/release_notes/4.5/user_interface/)
- Node group **assets** appear in add menus (3.4). Unassigned assets go to a "No Catalog" submenu (4.0). Linked node groups moved to a submenu, and indirectly linked groups are hidden (5.2). Add menus were reordered for consistency across editors (5.0). VERIFIED release notes 3.4, 4.0, 5.0, 5.2
- Groups whose name starts with `.` are hidden from menus and reachable only through search, which lets asset authors hide internal helpers. VERIFIED [manual groups](https://docs.blender.org/manual/en/latest/interface/controls/nodes/groups.html)
- New node positions are clamped to the region bounds (5.0). Dropping a color into the editor inserts a Color node (4.4). Dropping files creates import nodes (4.5 GN). Dropping an image into the World editor creates an Environment Texture (5.2). VERIFIED release notes
- **Zones** are added as input/output node pairs with an **`offset=(150.0, 0.0)`** between them (`bpy.ops.node.add_repeat_zone(settings=None, use_transform=False, offset=(150.0, 0.0))`; the same pattern applies to `add_simulation_zone`, `add_foreach_geometry_element_zone`, `add_closure_zone` and the generic `add_zone(input_node_type, output_node_type, add_default_geometry_link)`). VERIFIED bundled `bpy.ops.node.rst`
- An empty **New Group** operator creates a new empty node group (4.5). VERIFIED

### 2.2 Swap node (Shift+S)
- **`Shift-S`** opens `NODE_MT_swap` and replaces the selected node with another type. "All existing links are automatically reconnected where possible, matching input and output sockets by name and type. If a connection cannot be matched, it is left unconnected." Added in 5.0. VERIFIED [manual editing](https://docs.blender.org/manual/en/latest/interface/controls/nodes/editing.html), keymap, [5.0 notes](https://developer.blender.org/docs/release_notes/5.0/user_interface/)
- 5.1 extensions: swapping some **zones** keeps sockets intact, Separate/Combine Bundle swaps keep sockets, and data-block references are maintained. VERIFIED [5.1 UI notes](https://developer.blender.org/docs/release_notes/5.1/user_interface/)

---

## 3. Link-drag search (drop a wire on empty canvas and get a filtered search)

**Origin**: Blender 3.1, commit 11be151d58 by Hans Goudey, based on an initial patch by Juanfran Matheu (D8286). VERIFIED [3.1 notes](https://developer.blender.org/docs/release_notes/3.1/nodes_physics/), [commit](https://github.com/blender/blender/commit/11be151d58e)

**Behavior** (VERIFIED from the commit message and `link_drag_search.cc`):
1. Drag from any socket (`node.link` on LMB drag) and release above **empty space**. A search popup opens at the cursor (a search box with icon; its x offset differs for input and output drags).
2. The list shows **every compatible socket of every node type** that the current tree allows. Each node type contributes its own entries through a per-node callback (`gather_link_search_ops`), so node authors decide which sockets are offered and what presets to apply. Node types that fail `poll` or `add_ui_poll`, and "(Legacy)" nodes, are skipped.
3. Entries are labeled **`Node Name ▸ Socket Name`** (the menu arrow separator). Searching matches on words; the separator is registered as the search separator string.
4. **Weighting**: "The 'main' sockets (usually the first) are weighted above other sockets in the search, so they appear first when you type the name of the node." Sockets further down a node get decreasing weight (`weight--` per socket).
5. Special entries: **"Reroute"**, **"Group Input"** (creates a new group input) and **"Group Input ▸ <existing interface input>"**, shown only inside node groups when dragging from an input socket, and only for type-compatible interface sockets.
6. **Assets**: node-group assets from **all asset libraries** are included, using indexed asset metadata (interface socket names and types). On pick, the asset is imported and connected by socket name. In 4.3 the Add menu shows only the local asset library; a fix exists for asset link-drag breakage (PR #158616).
7. Compatibility is checked through the tree type's `validate_link(from_type, to_type)`, the same rule that makes links red.
8. When the menu first opens it is **not filtered**, but items are already sorted as they will be while searching, so the order stays stable.
9. **On confirm**: all nodes are deselected, the new node is added and linked, and it is positioned so that **the newly linked socket is aligned under the cursor** (cursor + 20 px y). It is selected and made active, then a **translate modal starts immediately** (`NODE_OT_translate_attach_remove_on_cancel`), so the user places it with the mouse. **Cancelling the move removes the node** (INFERRED from the operator name; commit: "Translation is started after choosing a node so it can be placed quickly … A small '+' is displayed next to the cursor").
10. 3.6: link-drag search **moves data-block default values** into new group inputs or Image nodes, and **copies basic socket values** such as vectors. VERIFIED [3.6 notes](https://developer.blender.org/docs/release_notes/3.6/nodes_physics/)
11. 4.3: "Inserting nodes with link-drag-search is much more convenient now" (83fa565ec2, PR #128197). Source shows that a node newly created through link-drag search may be **auto-inserted into an existing link only if that link touches the socket it was just connected to**. VERIFIED [4.3 UI notes](https://developer.blender.org/docs/release_notes/4.3/user_interface/), `node_relationships.cc`
12. 4.5: link-drag search can add **zones**. 5.3: link-drag search for the Repeat zone **Iterations** input, and drag-to-search visibility for Index Switch. VERIFIED [4.5 GN](https://developer.blender.org/docs/release_notes/4.5/geometry_nodes/), [5.3 GN](https://developer.blender.org/docs/release_notes/5.3/geometry_nodes/)
13. **Test and automation hook**: `bpy.ops.node.link_drag_operation_test(find_link_operations=False, link_operation_index=-1)` "Run a node link-drag operation for testing". It writes link operation names for the context socket into the tree's `link_operation_names` property, or executes an operation by index. VERIFIED bundled `bpy.ops.node.rst`. **AI implication**: link-drag search is effectively an API. "Given socket S, list every legal (node, socket) you could connect" is exactly the tool an agent needs.

---

## 4. Links: creating, cutting, muting, rerouting, swapping, detaching

All shortcuts are VERIFIED against `km_node_editor` in the main-branch keymap unless noted.

| Action | Gesture / key | Operator | Notes |
|---|---|---|---|
| Create link | LMB drag from socket | `node.link(detach=False)` | Multiple links can leave an output. An input takes one link unless it is a multi-input (pill-shaped) socket. ([manual](https://docs.blender.org/manual/en/latest/interface/controls/nodes/editing.html)) |
| Pick up / redirect existing links | **Ctrl**+LMB drag from a socket | `node.link(detach=True)` | "To reposition the outgoing links of a node, rather than adding a new one, hold Ctrl while dragging from an output socket. This works for single as well as for multiple outgoing links." Dragging a link off an input and releasing on empty space disconnects it. |
| Swap while dragging | Hold **Alt** during link drag | modal `SWAP` (LEFT_ALT / RIGHT_ALT, value ANY) | "To swap multiple links of a similar type, press and hold Alt while moving a link. This feature also works when adding a new link into a pre-existing socket." Since 3.5 this replaced the old auto-swap. |
| Cancel link drag | RMB or Esc | modal `CANCEL` | `km_node_link_modal_map` |
| **Cut links** | **Ctrl**+RMB drag (knife stroke) | `node.links_cut(path, cursor=15)` | Lasso select is moved to `Ctrl-Alt-LMB` because of this. Also a toolbar tool "Links Cut". |
| **Mute links** | **Ctrl+Alt**+RMB drag | `node.links_mute(path, cursor=39)` | "A muted link acts as though it's no longer there; this also means the input fields for specifying fixed values become visible again." Muting on the input side of a reroute also mutes its outputs. Toolbar tool added in 5.0. |
| **Add reroute** | **Shift**+RMB drag across link(s) | `node.add_reroute(path, cursor=11)` | Inserts a reroute where the stroke crosses the link. Toolbar tool in 5.0. If only one reroute is added it becomes active (5.0). |
| Detach node and move | **Alt**+LMB drag on node | `node.move_detach_links_release` (and `move_detach_links` on the select mouse) | "cut all the links attached to the selected nodes and move the nodes." |
| Make links | **J** | `node.link_make(replace=False)` | Connects open sockets of the selected nodes. Moved from F to J in 4.5. |
| Make and replace links | **Shift-J** | `node.link_make(replace=True)` | |
| Connect to output | **Shift-Alt**+LMB (GN), **Shift-Ctrl**+LMB (Shader, stand-in until a viewer exists) | `node.connect_to_output` | Connects to Material/World Output, Group Output, or the Group Output inside a group. |
| Link to viewer | **Shift-Ctrl**+LMB on node/socket | `node.select_link_viewer` | Repeated clicks cycle through outputs. Since 4.2 the viewer is moved closer to the node. |
| Edge-pan while dragging | automatic | `node.link(inside_padding=2.0, outside_padding=0.0, speed_ramp=1.0, max_speed=26.0, delay=0.5, zoom_influence=0.5)` | The view pans when links or nodes reach the region edge (3.0). Units are UI units; delay is in seconds. VERIFIED API RST |

**Link drawing and state** (VERIFIED release notes):
- **Wire Colors** overlay colors links by their socket type (3.0).
- Links whose sockets are **outside the view are dimmed**, to cut noise from long links (3.0).
- Selected links are fully highlighted, drawn **on top**, and not faded out of view (3.2). 5.3 highlights links **through reroute nodes**.
- Links attach horizontally to reroutes, and reroute labels are center aligned (3.2). The **Reroute Auto Labels** overlay derives labels from upstream reroutes (4.2, overlay `show_reroute_auto_labels`).
- Link curving was tuned for vertical links (3.4). Readability at different zoom and DPI was improved (4.0).
- **Muted node**: "Links will appear red as an indicator of passing through the muted node." Internal (pass-through) links show on muted nodes whether or not outputs are linked (4.5). VERIFIED manual and [4.5 notes](https://developer.blender.org/docs/release_notes/4.5/user_interface/)
- **Dashed links** mean a field flows through that link and needs an evaluation context (3.0; kept in 5.0). VERIFIED
- Socket picking when creating links was improved to reduce mis-clicks (4.1). VERIFIED [4.1 UI notes](https://developer.blender.org/docs/release_notes/4.1/user_interface/)
- Multi-input links are ordered: Python `NodeLink.multi_input_sort_id` ("highest ID is at the top", 4.1 API). VERIFIED

---

## 5. Invalid links, implicit conversion, and error reporting

### 5.1 Red (invalid) links, with reasons
- 3.0: "Node links between different types with no possible implicit conversion now turn red to indicate the error (Geometry Nodes)." VERIFIED [3.0 notes](https://developer.blender.org/docs/release_notes/3.0/nodes_physics/)
- 4.2: "Invalid (red) links now have some additional information for why they are invalid." Also: "Dragging a node onto a link does not remove the link anymore if it is incompatible. It's dimmed instead." VERIFIED [4.2 UI notes](https://developer.blender.org/docs/release_notes/4.2/user_interface/)
- 4.5: "Show link errors directly on link instead of on node." "Invalid zones are visualized better." "Tooltip when hovering over error icon shows more quickly." VERIFIED [4.5 UI notes](https://developer.blender.org/docs/release_notes/4.5/user_interface/)
- **Validation rules and exact messages**, in order (VERIFIED `node_tree_update.cc` → `update_link_validation`):
  1. Either socket is unavailable → invalid (no message).
  2. Menu-to-menu link where a menu has a conflict → "Use node groups to reuse the same menu multiple times".
  3. Link goes backwards in topological order → **"The links form a cycle which is not supported"**.
  4. Tree `validate_link(from_type, to_type)` fails → **"Conversion is not supported: <FromType> ▸ <ToType>"**.
  5. Link leaves a zone → **"Links can only go into a zone but not out"** (the zone's output node is also flagged invalid).
  6. **Structure-type (shape) mismatch**: target shape **line** (single) receiving a non-single → "Input expects a single value". Target **diamond** (field) receiving a grid or list → "Input expects a field or single value". Target **grid** → "Input expects a volume grid". Target **list** → "Input expects a list". Target **circle** (dynamic) accepts anything. If the source's inferred structure type is *Dynamic*, no error is shown, "to avoid many false positives".
  7. Shader trees: lighting-node placement errors (e.g. "Lighting nodes must be connected to the Light sockets of a Light Accumulation node before reaching the Material Output").
- Pattern worth copying: **validation is a pure pass over the graph that attaches a human-readable reason to each link**. The UI draws the link red and shows the reason on hover. Python sees `NodeLink.is_valid` (VERIFIED API).

### 5.2 Implicit conversions (VERIFIED [manual parts](https://docs.blender.org/manual/en/latest/interface/controls/nodes/parts.html))
- Color ↔ Vector: channels map to components.
- Color → Float: grayscale. In the compositor since 4.4 this uses **OCIO luminance** (VERIFIED [4.4 compositor notes](https://developer.blender.org/docs/release_notes/4.4/compositor/)).
- Color/Float/Vector → Shader: an implicit Emission.
- Float ↔ Integer: ints become floats; floats are **truncated**.
- Float → Vector: the value goes into every component. Vector → Float: **average** of components.
- Float ↔ Boolean: `> 0` is true; true → 1, false → 0.
- Rotation ↔ Matrix.
- Units caveat: a unitless Value into an angle socket is interpreted as **radians** regardless of scene units.
- 5.2 added explicit **"Implicit Conversion" nodes** to convert to a fixed type. **Make Group** now avoids type conversion on multi-connected inputs, and **Ungroup** inserts proxy/converter nodes so behavior stays identical after ungrouping. VERIFIED [5.2 UI notes](https://developer.blender.org/docs/release_notes/5.2/user_interface/)

### 5.3 Node warnings and errors on nodes
- "When the inputs to a node are invalid, it displays a warning in the title. Hovering over the warning icon shows the error message. These warnings are only generated when the node is executed, so a node must be connected to the *Group Output* to have a warning." VERIFIED [manual inspection](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/inspection.html)
- Warnings also show in the **modifier panel** so they don't get lost (3.0), ordered by severity then alphabetically (4.3). VERIFIED
- 4.3 added a **Warning node** for custom warnings in node groups and a per-node **Warning Propagation** setting (`Node.warning_propagation`: *All Messages*, *Errors and Warnings*, *Errors*, *None*). The label was shortened to "Propagate" in 5.1. Python: `for warning in modifier.node_warnings: print(warning.type, warning.message)`. VERIFIED [4.3 GN notes](https://developer.blender.org/docs/release_notes/4.3/geometry_nodes/), [manual node_editors](https://docs.blender.org/manual/en/latest/interface/controls/nodes/node_editors.html)
- **Find Node (`Ctrl-F`)** searches node names, socket labels, **warning messages** (5.1), string values, data-block references and group inputs (5.0), and dynamic labels (4.5). Picking a match pans to and centers the node. VERIFIED manual selecting, release notes
- The viewer node shows a warning when the GN modifier is not evaluated (5.0). VERIFIED
- The Join Bundle node header shows an info icon when duplicate keys are detected. VERIFIED manual bundles

---

## 6. Sockets: shapes, colors, and interaction

### 6.1 Socket shapes (current, 5.0+)
VERIFIED [New Socket Shapes blog](https://code.blender.org/2025/08/new-socket-shapes/), source constants `SOCK_DISPLAY_SHAPE_LINE/DIAMOND/CIRCLE/VOLUME_GRID/LIST`:
- **Vertical bar / line = Single**: "This input expects a single value or this output is always a single value."
- **Diamond = Field**: "This input expects a field or the output is a field." A single value connected to a field input is broadcast to every element.
- **Circle = Dynamic**: "This input allows different kinds of data or this output produces different kinds of data depending on the inputs." Example: the Math node, which works with single values, fields, lists and more.
- **Four squares = Grid** (volume grid) and a **List** shape: similar in meaning to the field diamond, for in-development types. Lists became a core type in 5.2.
- **Diamond with dot: removed** (it existed 3.0–4.5).
- **Static shapes**: "socket shapes never change depending on what they are linked to". The exception is Group Input/Output nodes, whose shapes are inferred. Group interface sockets have a **Shape** setting (`structure_type`): *Auto* (default), *Dynamic*, *Single*, *Field*, *Grid*. VERIFIED [manual groups](https://docs.blender.org/manual/en/latest/interface/controls/nodes/groups.html)
- **Multi-input sockets** are drawn as an elongated **pill/ellipsis** that grows with the number of links (`NODE_MULTI_INPUT_LINK_GAP = 0.25 * widget_unit`). VERIFIED manual, `node_intern.hh`
- **Extend (virtual) socket**: the hollow blank socket on Group Input/Output, zones, bundles, closures and the viewer. Its tooltip: "Connect a link to create a new socket." Dropping a link on it creates a new interface item with the matching type. VERIFIED manual groups, `node_socket_tooltip.cc`
- Geometry: `NODE_SOCKSIZE = 0.25 * widget_unit`, `NODE_DY = widget_unit` (row height), `NODE_DYS = widget_unit/2`, `NODE_RESIZE_MARGIN = 0.20 * widget_unit`, `NODE_LINK_RESOL = 12` (bezier subdivision used for hit testing). VERIFIED `node_intern.hh`

### 6.2 Color coding by data type
VERIFIED manual names plus `drawnode.cc` default RGBA (theme may override; do **not** copy the palette literally, design our own with the same *semantics*):

| Type | Manual name | Default RGBA (linear-ish, 0–1) |
|---|---|---|
| Float | light gray | 0.63, 0.63, 0.63 |
| Integer | lime green | 0.35, 0.55, 0.36 |
| Boolean | light pink | 0.80, 0.65, 0.84 |
| Vector (2D/3D/4D) | dark blue | 0.39, 0.39, 0.78 |
| Integer Vector (5.2) | — | 0.36, 0.47, 0.61 |
| Color | yellow | 0.78, 0.78, 0.16 |
| String | light blue | 0.44, 0.70, 1.00 |
| Rotation | pink | 0.65, 0.39, 0.78 |
| Matrix | dark pink | 0.72, 0.20, 0.52 |
| Menu (enum) | dark gray | 0.40, 0.40, 0.40 |
| Shader | bright green | 0.39, 0.78, 0.39 |
| Geometry | sea green | 0.00, 0.84, 0.64 |
| Bundle | dark turquoise | 0.30, 0.50, 0.50 |
| Closure | light brown | 0.49, 0.49, 0.23 |
| Object | orange | 0.93, 0.62, 0.36 |
| Collection | white | 0.96, 0.96, 0.96 |
| Material | salmon | 0.92, 0.46, 0.51 |
| Texture | pink | 0.62, 0.31, 0.64 |
| Image | apricot | 0.39, 0.22, 0.39 |
| Font / Sound | brown | 0.39, 0.34, 0.26 |

- Data-type menus use **socket-type icons** (4.5, 5.0). Socket data types were reordered for better accelerator keys (5.0). VERIFIED

### 6.3 Socket interaction details
- **Ctrl+click** a socket name to rename it directly in the node, for group/zone/bundle items (4.2; more in-node renaming and adding dynamic sockets directly in nodes in 5.2). Repeat and Simulation zone items are renamed with `Ctrl-LMB` or double-click in the list. VERIFIED release notes, manual repeat zone
- Selecting a socket label on a Group Input/Output node selects that item in the interface list. VERIFIED manual groups
- **Grayed-out inputs**: "Input values that don't affect the output are grayed out now" (4.4). Inputs are **auto-hidden** when their usage depends on a menu input (4.5). Socket labels on linked (library) trees are grayed out (5.0). VERIFIED
- **Inline sockets**: input and output sockets share a row on many nodes (4.5), and in the compositor (5.0). VERIFIED
- String sockets can use **placeholders** instead of labels, for wider input fields (4.3). Built-in nodes can have line **separators** (4.3). VERIFIED

---

## 7. Socket inspection on hover (live values)

VERIFIED [manual inspection](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/inspection.html), [5.0 UI notes](https://developer.blender.org/docs/release_notes/5.0/user_interface/), `node_socket_tooltip.cc`:
- "Socket inspection shows information about the value in a socket during the last evaluation." Values are **logged during evaluation**, so the node must be connected to the output. **Not logged during rendering**, for performance.
- **5.0 revamp** "more clearly separates the static information of a socket like the name and description from dynamic information like the last evaluated value." Color tooltips show the actual color swatch.
- **Tooltip block structure**, in order: (1) **Label** header (shown when the description is empty, for menus, or for optional-label sockets). (2) **Description** (a period is appended if missing). (3) **Value**, from the evaluation log if present. Otherwise, for an unlinked input, the **default value**. In GN, "Value: Unknown (not evaluated)". (4) **Expected bundle type**. (5) **Python** info: idname, when Python tooltips are enabled.
- **Value formats** (paraphrased):
  - Scalars: value on one line with type ("Float", "Integer", "Boolean" as True/False, "String").
  - Vectors: space-separated components with "2D/3D/4D Float Vector".
  - Colors: RGBA "(Linear)", "Float Color".
  - Rotation: shown in degrees.
  - Matrix: a 4×4 monospace grid, "4x4 Float Matrix".
  - Integer or float driven by the scene frame: "(Scene Frame)".
  - Object: shows "(Self Object)" when applicable.
  - Menu: the item name plus its description.
- **Field sockets**: "Field depending on:" with a bullet list of the field's input nodes (e.g. Position, Index), then "Type: Float Field" and similar. This explains *why* a value is not a single number.
- **Geometry sockets**: "Geometry components:" with bullets such as "Mesh: N vertices, N edges, N faces", "Point Cloud: N points", "Instances: N", "Volume: N grids", "Curve: N points, N splines", "Grease Pencil: N layers", plus edit-data flags. "Type: Geometry Set".
- **Multi-input sockets**: values listed **per connection, numbered 1, 2, 3…**
- **Bundles**: "Values:" with bullets `"key" (Type)`.
- Grids: "Empty Grid" / "Volume Grid".
- **Dangling reroute**: alert text "Dangling reroute nodes are ignored."
- Zones: the **Inspection Index** property on the Repeat and For Each zones picks *which iteration or element* is shown in socket inspection and the viewer. VERIFIED manual repeat/for-each zone
- Inspection works for node tools (4.2), and the compositor got socket value inspection in 5.2. VERIFIED [4.2 GN](https://developer.blender.org/docs/release_notes/4.2/geometry_nodes/), [5.2 compositor](https://developer.blender.org/docs/release_notes/5.2/compositor/)
- Limitation: viewer and inspection may be inaccurate when closures are evaluated in multiple contexts. VERIFIED manual evaluate closure

---

## 8. Viewer node and Spreadsheet (per-element inspection)

### 8.1 Viewer node (GN)
VERIFIED [manual viewer](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/output/viewer.html), release notes 3.0, 3.4, 4.1, 4.5, 5.0, 5.2:
- Shows intermediate data in the **Spreadsheet** and **3D viewport**. **`Shift-Ctrl-LMB`** on any node or socket connects it to the active viewer, and repeated clicks cycle outputs. Clicking a viewer activates it. The header eye icon toggles the spreadsheet between Evaluated and Viewer Node.
- **Dynamic inputs (5.0)**: any number of items. Dragging into the blank socket adds an item. Unlinking removes the item automatically (per-item **Auto Remove** setting). Non-geometry data can be viewed. **Single values are shown directly inside the viewer node.** Data-block names too (5.2).
- **Domain** dropdown (*Auto*, or a specific domain) sets where a field is evaluated. The default when not inferrable is **Face Corner for meshes** and **Point for curves**. The Geometry socket must be first.
- Viewport **attribute overlay**: colors, or **text values** (4.1). Opacity lives in the Overlays popover. The View menu *Viewer Node* option hides all viewer visualizations.
- **Shortcuts**: `Ctrl-1..9` assigns (the number shows in the node's upper-right corner), `1..9` activates or toggles (5.0). Numbers 1–9 only. Compositor viewers got the same in 4.4.
- **Pinning** keeps the spreadsheet on a given viewer.
- Not available in the Tool context.

### 8.2 Spreadsheet editor
VERIFIED [manual spreadsheet](https://docs.blender.org/manual/en/latest/editors/spreadsheet.html), release notes 3.0, 3.1, 4.3, 4.5, 5.0, 5.2:
- Rows are **elements** (vertex, face, spline, instance…) and columns are **attributes**. Headers and indices stay sticky while scrolling. Columns resize by drag, **double-click the edge to fit**, and reorder by drag (4.5). The layout persists. The column name shows in a tooltip. Tooltips add type detail (byte color integers; matrices only in tooltips).
- **Data Set region** on the left: the context path (moved here in 4.5), a pin, and **Object Evaluation State** (*Evaluated* / *Original* / *Viewer Node*). The **Viewer Path** lists the nested group path. **Viewer Data** picks which viewer item to show. A **Geometry** tree browses nested instances (4.3). **Domain** list shows element counts; domains absent from the geometry are grayed out (4.5).
- **Row filters** (Sidebar): *Enabled*, *Column*, *Operation* (*Equal To*, *Greater Than*, *Less Than*; non-numeric columns only support *Equal To*), *Value*, *Threshold*. A filter on a missing column is grayed out and ignored.
- The status bar shows rows, columns, and rows remaining after filtering.
- **Internal Attributes** toggle for names starting with `.` (4.5). Volume grid stats (5.0): name, type, class, voxel extent, min voxels, voxels, leaf voxels, tiles, size. Multiple geometries and **bundle contents** (5.0). **Geometry bundles** attached to a geometry (5.2).
- *Show Only Selected* in Edit Mode.

**Why this matters for AI**: the spreadsheet is a **tabular, per-element dump of the evaluated state at an arbitrary point in the graph**, chosen by the viewer. It is the ideal debugging surface for an agent: structured, filterable, and addressable by node path. Blender exposes it only through the UI, not directly as an API (INFERRED; the GeometrySet Python API from 4.5 is the scripting route).

---

## 9. Performance timings overlay

VERIFIED [manual node_editors](https://docs.blender.org/manual/en/latest/interface/controls/nodes/node_editors.html), [manual inspection](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/inspection.html), release notes 3.1, 4.2, 4.3:
- Overlay popover → **Timings** (`SpaceNodeOverlay.show_timing`). It shows each node's **last execution time** above the node. Only compositor (4.2+) and geometry nodes.
- When a group is used in several places, timings follow the **context path** (breadcrumbs).
- **Frame nodes show the total of their contained nodes. The Group Output node shows the total for the whole group.**
- Approximate: it includes copying and freeing geometry. Multithreading overlaps. **Field nodes do no work themselves**; their cost is added to the data-flow node that evaluates them.
- Node timings became more accurate in 4.3.
- Related: **Named Attributes** overlay (3.2) flags nodes and groups that read, write or remove named attributes (collision risk). 5.1 adds a performance text overlay in the 3D viewport.

---

## 10. Node visibility operations: mute, collapse, hide sockets, options, preview

VERIFIED keymap and [manual editing](https://docs.blender.org/manual/en/latest/interface/controls/nodes/editing.html):

| Operation | Key | Operator | Behavior |
|---|---|---|---|
| **Mute** | **M** | `node.mute_toggle` | "removes its contribution to the node tree, and makes all links pass through it without change". Pass-through links draw red. Evaluate Closure muted → passes values through by name. |
| **Collapse** | **H** | `node.hide_toggle` | Header only. Also the triangle toggle left of the header. Collapsed nodes draw more rectangular, not pill-shaped (5.0). |
| **Toggle unused sockets** | **Ctrl-H** | `node.hide_socket_toggle` | Collapses/expands unconnected sockets. |
| Collapse + hide unused | (no default key) | `node.collapse_hide_unused_toggle` | Both. |
| Node preview | **Shift-H** | `node.preview_toggle` | Compositor preview region. The header icon also toggles previews; a tree-wide *Previews* overlay exists. Shader preview resolution pref: `node_preview_resolution` default **120** (range 50–250). |
| Node options | (menu) | `node.options_toggle` | Show/hide properties. The 5.1 Node panel has toggles for Show Options, Mute, and color. |
| Overlays on/off | **Shift-Alt-Z** | `wm.context_toggle space_data.overlay.show_overlays` | |
| Custom node color | Sidebar → Node → Color | `Node.use_custom_color`, `Node.color` | Presets. *Copy Color* copies the active node's color to the selection. |
| Label | Sidebar → Node → Label | `Node.label` | Overrides the title. |

---

## 11. Node groups: Tab, Ctrl+G, Ctrl+Alt+G, and the interface panel

### 11.1 Operators (VERIFIED keymap, [manual groups](https://docs.blender.org/manual/en/latest/interface/controls/nodes/groups.html), release notes)
- **Make Group `Ctrl-G`** (`node.group_make`): creates Group Input/Output nodes from the connections to unselected nodes. **Grouping a single node preserves its interface, panels and default values, and takes its name.** Grouping multiple nodes gives generic names ("NodeGroup", "NodeGroup.001"). Hidden links are removed to avoid unused sockets (3.2). Input sockets are reused (3.4). Panels stay intact when wrapping a single node (4.5). The color tag is inherited (5.0). 5.2 avoids type conversion on multi-connected inputs and duplicate outputs.
- **Ungroup `Ctrl-Alt-G`** (`node.group_ungroup`): ungroups **all selected** group nodes (4.1). Adds proxy and converter nodes so behavior is unchanged (5.2).
- **Edit Group `Tab`** enters. **`Tab` again or `Ctrl-Tab`** exits (`node.group_edit(exit)`). **Double-click** a group enters, **double-click empty space** exits, and **breadcrumbs are clickable** (5.0). Breadcrumbs (Context Path overlay) show hierarchy and linked/packed status (5.0).
- **Separate `P`** (`node.group_separate(type='COPY'|'MOVE')`) moves or copies selected nodes to the parent tree.
- **Insert Into Group** (menu, `node.group_insert`): select nodes, then the group node last.
- **Join Group Inputs `Ctrl-J`** (`node.join_nodes`, 5.0): merges multiple Group Input nodes.
- Recursive groups are prohibited.
- Group nodes are **visually identified** by a stack-of-nodes indicator (5.0; previously an icon and green header). The data-block user count shows in the header (3.4). Group node names initialize from the group name (4.5).
- **New Group Input nodes by dragging inputs from the sidebar** (4.5). Group Input nodes can be duplicated freely; interface inputs that don't affect outputs are grayed (manual note).

### 11.2 Group interface panel (Sidebar → Group)
VERIFIED manual groups, 4.0/4.2/4.3/4.4/4.5/5.0/5.1 notes:
- **Group** subpanel: **Name**, **Description** (tooltip on title and in add menus; 4.2), **Color Tag** (header color; 4.2), **Node Width** plus *Set Default Node Width* (4.3), *Show Manage Panel* (GN), Usage *Modifier* / *Tool* (GN).
- **Group Sockets** tree view (4.0: "Group sockets are managed in new UI tree view together with panels. Drag-and-drop support for ordering sockets and inserting into panels."). Item types: **Input**, **Output**, **Panel** (always at the bottom of the node; **nestable** by drag, 4.4), **Panel Toggle** (a boolean checkbox in the panel header, 4.5; *Make Panel Toggle* / *Unlink Panel Toggle*). Specials: *Duplicate Item*. Multi-selection (5.1). Selecting a Group Input/Output node shows the interface properties in the Node tab too (5.0).
- **Socket properties**: *Type*; *Description* (socket tooltip); *Attribute Domain* and *Default Attribute* (GN outputs); *Subtype* (Int: None/Percentage/Factor; Float: None/Percentage/Factor/Mass/Angle/Time (Scene Relative)/Time (Absolute)/Distance/Wavelength/Color Temperature/Frequency; Vector: None/Percentage/Factor/Translation/Direction/Velocity/Acceleration/Euler Angles/XYZ; String: None/File Path; Pixel subtype added 5.2); *Dimensions* 2/3/4 (4.5); *Default*; *Min/Max* ("This does not clamp the actual data flowing through the socket"); *Expanded* for menus (4.5); *Default Input* (implicit input such as Position or Index; requires Hide Value; new "Scene Frame" default in 5.2); *Optional Label* (5.0); *Hide Value*; *Layer Selection*; *Hide in Modifier*; **Shape** (*Auto/Dynamic/Single/Field/Grid*).
- **Panel properties**: *Description* (hover tooltip; 4.3), *Closed by Default*.
- **Dynamic output visibility (5.0)**: the **Enable Output** node makes a group output visible or active depending on an input. Visibility is only affected when it is controlled by a **menu** input, not a plain boolean. VERIFIED [5.0 UI notes](https://developer.blender.org/docs/release_notes/5.0/user_interface/)
- **Menu Switch** creates custom enums on the interface (4.1). Index/Menu Switch have a **"+" button** to add items without the sidebar (5.0). Built-in nodes gained menu sockets (5.0).

---

## 12. Frames, reroutes, snapping, auto-offset, insertion on links

### 12.1 Frames
VERIFIED [manual frame](https://docs.blender.org/manual/en/latest/interface/controls/nodes/types/layout/frame.html), keymap, [4.5 UI notes](https://developer.blender.org/docs/release_notes/4.5/user_interface/), [Frame blog](https://code.blender.org/2025/05/frame-node-improvements/):
- **`F` = Join in New Frame** with a **rename popup** so the user can type a label immediately (`node.join_named`). With nothing selected it creates an empty frame (blog).
- **While dragging nodes, press `F`**: detaches from the current frame, or attaches to the frame under the cursor (transform modal `NODE_FRAME`). The **target frame border highlights**.
- **`Ctrl-P`** = Add to Frame (select the nodes, then the frame last). **`Alt-P`** = Remove from Frame. Dropping a node onto a frame also parents it.
- Properties: **Label Size**, **Shrink** (auto-fit around children; when on, the edges can't be dragged), **Text** (display a read-only Text data-block as a sticky note). Frames can be resized from corners and edges when Shrink is off.
- **Nested frames use alternating shading** by depth, slightly darker or lighter than the theme color (4.5). Label positions improved, and size accounts for the full bounding box (4.5). Frame labels get **automatic contrasting colors** (5.1). Label text only renders when a label is set (3.0). A new frame is added to the **common root frame** of the selected nodes (4.2).
- Timings overlay: a frame shows the **sum** of its children.
- Node Wrangler: `]` selects the frame's children, `[` selects the parent frame.

### 12.2 Reroute
- `Shift`+RMB drag across a link inserts a reroute. The Add Reroute toolbar tool (5.0). Node Wrangler `/` adds reroutes to all outputs.
- A reroute takes one input and many outputs, like a socket. Its type is set via `reroute_node.socket_idname` (4.3 API). Dangling reroutes are ignored, with a tooltip saying so. Tooltips show the reroute label (4.2). Auto labels propagate from upstream (4.2 overlay). VERIFIED manual reroute, release notes

### 12.3 Snapping
- Header snap toggle (`ToolSettings.use_snap_node`), **`Shift-Tab`** toggles. Holding **Ctrl** during transform or resize **inverts snapping** (resize modal `SNAP_INVERT_ON/OFF`). Snaps position and size to the background grid. The dot grid was introduced in 3.0. `snap_node_element` was removed in 4.4, so it is grid-only. Horizontal resize snapping (4.4). **Multiple nodes resize together** (5.2). Paste snaps (5.1). VERIFIED manual arranging, keymap, release notes

### 12.4 Transform
- `G` / LMB drag = move with edge-pan (`view2d_edge_pan=True`). `R` / `S` rotate and scale **only positions** of multiple nodes. Node width changes by dragging the left or right border. VERIFIED keymap, manual
- **Transform modal keys** (VERIFIED `km_transform_modal_map`): **`T` = toggle auto-offset direction** (`INSERTOFS_TOGGLE_DIR`). **Hold `Alt` = disable auto-attach/insert** (press = `NODE_ATTACH_OFF`, release = `NODE_ATTACH_ON`; 3.5). **`F` = frame attach/detach** (`NODE_FRAME`).
- `Home` = Frame All, `Numpad .` / mouse button 4 = Frame Selected, `` ` `` (grave accent) = View pie, MMB pan, wheel or `Ctrl-MMB` zoom. Smooth view (3.6). VERIFIED keymap, manual

### 12.5 Link insertion by dropping a node on a wire, plus auto-offset
VERIFIED manual editing and arranging, [4.2 UI notes](https://developer.blender.org/docs/release_notes/4.2/user_interface/), `node_relationships.cc`:
- **Eligibility**: exactly **one** selected node, with **at least one input and one output socket**. For an existing node being moved, it must have **no existing links** ("Nodes that have no connections can be inserted on a link"). A freshly added node may already be linked by link-drag search, and then only links touching that socket qualify.
- **Target picking**: every visible, non-dimmed link is sampled as a bezier with **12 segments**. Links whose segments intersect the node's bounds are candidates, and the one **closest to the node's upper-left corner** wins. It is highlighted as the insert target.
- **Compatibility**: the node's **main input** must accept the link's source type and its **main output** must feed the link's target type (`validate_link`). Otherwise the link is marked **invalid target** and drawn **dimmed**; the link is **not removed** (4.2). "This generally uses the first socket that matches the link type."
- **Auto-offset** (`PreferencesEdit.node_use_insert_offset`, default **True**; margin `node_margin` default **40**, range 0–255, scaled by UI scale): after insertion, it measures the gaps between the previous node, inserted node and next node. If the gaps are below the margin it shifts the **downstream chain** (or upstream if the direction is toggled with `T`) and nudges the inserted node. The shift is **animated over 0.25 s** (`NODE_INSOFS_ANIM_DURATION`). Direction toggles with `T` while moving.
- Duplicate hazard called out in the manual: a duplicate lands **exactly on top** of the original, "you can not easily tell that there are two nodes there".

---

## 13. Selection

VERIFIED keymap `_template_node_select` and `km_node_editor`, [manual selecting](https://docs.blender.org/manual/en/latest/interface/controls/nodes/selecting.html):

| Action | Input |
|---|---|
| Select | LMB press (select-passthrough, so a press on an already-selected node keeps the selection for dragging; a click deselects the others) |
| Extend / toggle | `Shift`+LMB (toggle) |
| Box select (tweak) | LMB drag on empty space; or `B`; or the toolbar Select Box tool. `W` cycles select tools (LMB-select preset). |
| Circle select | `C` |
| **Lasso** | **`Ctrl-Alt`+LMB drag** (add), **`Shift-Ctrl-Alt`+LMB drag** (subtract). The normal `Ctrl-RMB` lasso is used by Cut Links. |
| All / None / Invert | `A` / `Alt-A` / `Ctrl-I` |
| **Select Linked From** (upstream) | `L` |
| **Select Linked To** (downstream) | `Shift-L` |
| Select Grouped | `Shift-G` (Type, Color, Prefix/Suffix); `Shift-Ctrl-G` extends |
| Activate same type prev/next | `Shift-[` / `Shift-]` (centers view) |
| Find Node | `Ctrl-F` |
| Duplicate / Linked / Keep inputs | `Shift-D` / `Alt-D` (shares group data) / **`Shift-Ctrl-D`** (`node.duplicate_move_keep_inputs`, keeps incoming links) |
| Copy / Paste | `Ctrl-C` / `Ctrl-V` (copies internal links; pastes at cursor) |
| Delete / Dissolve / Cut | `X` or `Delete` / `Shift-X` or `Ctrl-Delete` (reconnect) / `Ctrl-X` (copy + dissolve, 5.3) |
| Context menu | RMB (LMB-select preset) (INFERRED from `params.context_menu_event`; the 3.5 context menu was "significantly improved") |

- The active node is the last selected, drawn with a lighter outline, and drives the Sidebar/Properties. Box, circle and lasso can also select links (toolbar description). VERIFIED manual

---

## 14. Zones (loops and higher-order constructs)

General rules (VERIFIED manual zone pages, `node_tree_update.cc`, release notes):
- A zone = **input node + output node + a tinted region between them**, containing the body. The region grows automatically to enclose the body nodes (INFERRED from screenshots and "orange area" wording).
- **Links may go into a zone but not out** ("Links can only go into a zone but not out"). Results leave only through the output node. Outside values used inside are constant across iterations (Repeat) or captured (Closure).
- Items are added by dragging into the **blank socket** or through the item list in Sidebar → Node → Properties. Rename with `Ctrl-LMB` on the socket or double-click in the list. Sockets on zone input and output are **aligned** (4.2). Item lists live in the properties panel (4.2). Invalid zones are visualized (4.5).

| Zone | Since | Inputs / outputs | Key properties |
|---|---|---|---|
| **Repeat** | 4.0 | *Iterations* (count), *Iteration* index output (from 0), default *Geometry* item. Each iteration writes to the output node, which feeds the next iteration. | *Repeat Items* (type per item), **Inspection Index** (which iteration inspection/viewer show) |
| **Simulation** | 3.6 | Input node evaluated **once at the start**. Outside links re-evaluate each step. *Delta Time* (s). *Skip* (bypass; hidden checkbox since 4.3). Output node stores state for the next frame. | *Simulation State* items, sub-steps, cache and bake (timeline strong yellow line; baked-frames overlay on the node, 4.2; packed bakes, 4.3). Modifier context only. Anonymous attributes are not propagated unless stored. |
| **For Each Geometry Element** | 4.3 | *Geometry*, *Selection*, *Index*, *Element* (single-element geometry; not for Face Corner) | *Domain*, *Inspection Index*. Outputs: *Main Geometry* (per-element values become attributes on the input geometry) and *Generated* (geometries joined; values below a geometry become anonymous attributes). The manual warns it is slower than fields for small geometry. |
| **Closure** | 5.0 | A zone defining a callable: its own inputs and outputs; **captures** outside values | *Sync Sockets*, *Define Signature*, input/output items with *Type* and *Shape* |

Adding: `bpy.ops.node.add_repeat_zone(offset=(150,0))` etc.; `swap_zone`; link-drag search supports zones (4.5).

---

## 15. Bundles and closures (5.0+)

VERIFIED [manual bundles](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/utilities/bundle/index.html), [closures](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/utilities/closure/index.html), [5.0 GN notes](https://developer.blender.org/docs/release_notes/5.0/geometry_nodes/), [5.1](https://developer.blender.org/docs/release_notes/5.1/geometry_nodes/), [5.2](https://developer.blender.org/docs/release_notes/5.2/geometry_nodes/), [blog](https://code.blender.org/2025/08/bundles-and-closures/):
- **Bundle** = a struct in a single socket (dark turquoise). It can hold geometry, fields, values, objects and nested bundles. Nodes: **Combine Bundle**, **Separate Bundle**, **Join Bundle** (merge; first occurrence wins on duplicate keys, with an info icon), **Get Bundle Item** and **Store Bundle Item** (5.1; **slash-separated paths** like `settings/size`, computed strings allowed; *Exists* output; *Remove* option). **Geometry Bundles** (5.2): *Set Geometry Bundle* / *Get Geometry Bundle* attach arbitrary data to a geometry across modifier and object boundaries. Available in Shader Nodes too. The compositor got bundles in 5.3.
- **Closure** = a function value (olive/light-brown socket). The **Closure zone** defines it, **Evaluate Closure** calls it. Items are matched **by name**. **Pass-through**: when muted or unconnected, Evaluate Closure passes matching-name inputs to outputs. Recursive calls up to a configurable **call stack depth limit** (5.2). **Closure to List** (5.2).
- **Signature syncing UX** (important pattern): bundles and closures match sockets **by name**. When connected nodes' signatures differ, a **Sync Sockets** icon (refresh icon) appears in the node header. "Sync happens automatically when a node is connected for the first time. Existing sockets are never updated automatically to avoid overwriting data." **Define Signature** locks the item list and types to stabilize published interfaces.
- **Lists** (5.2): Field to List, Closure to List, List Length, Get List Item, Filter List, Sort List, Combine List (5.3). Math nodes broadcast over lists (the shorter list repeats). This is why the **list socket shape** exists.

---

## 16. Node Wrangler (bundled add-on) conveniences

VERIFIED [manual Node Wrangler](https://docs.blender.org/manual/en/latest/addons/node/node_wrangler.html). Quick menu **`Shift-W`**; also a Sidebar panel.
- **Lazy Connect**: **`Alt`+RMB drag** from one node to another, with no need to hit sockets. "It will select the nodes nearest the start and end points of the drag … It tries to connect the best-matched sockets possible, based on their names, types, and whether they are open or not." **`Shift-Alt`+RMB drag** shows menus of outputs and inputs to pick exact sockets.
- **Lazy Mix**: `Shift-Ctrl`+RMB drag merges two outputs into a Mix-type node.
- **Merge selected**: automatic type detection with `Ctrl` + `=`/`8`/`-`/`/`/`0` (Add/Multiply/Subtract/Divide/Mix). `Ctrl-Alt` + key forces Mix. `Shift-Ctrl` + key forces Math (`Ctrl-,` greater than, `Ctrl-.` less than). Z-Combine `Ctrl-Numpad.`, Alpha Over `Ctrl-Alt-0` (compositor). 5.2 supports integer math.
- **Batch change** blend mode / math op: `Alt-Up`/`Alt-Down` cycle; `Alt` + op key.
- **Change Mix Factor**: `Alt-Left/Right` ±0.1, `Shift-Alt-Left/Right` ±0.01, `Shift-Ctrl-Alt-Left`/`0` → 0.0, `Shift-Ctrl-Alt-Right`/`1` → 1.0.
- **Delete Unused Nodes** `Alt-X`. **Swap Links** `Alt-S` (two nodes: swap outputs; one node: cycle or swap inputs). **Detach Outputs** `Shift-Alt-D`. **Reset Nodes** `Backspace` (keeps links). **Copy Settings** `Shift-C`. Copy/Clear/Modify Labels `Shift-V` / `Alt-L` / `Shift-Alt-L`. **Add Reroutes** `/`. **Link Active to Selected** `\` (`K`, `Shift-K`, `'`, `;` variants). **Align Nodes** `Shift-=` (even spacing). **Select children/parent frame** `]` / `[`. **Preview Node Output**: `Shift-Ctrl-LMB` (Shader), `Shift-Alt-LMB` (GN). Texture setups `Ctrl-T` / `Shift-Ctrl-T`. Reload images `Alt-R`. Move selected nodes to the tree center (5.1).
- Note: several NW features were absorbed into core over time: connect-to-output, viewer link, Join Nodes/frames, Alt-swap while dragging (INFERRED from the overlapping shortcuts in the core keymap).

---

## 17. Editor-specific notes (Shader, Compositor)

- **Shader editor**: `Shift-Ctrl-LMB` is bound to `connect_to_output(run_in_geometry_nodes=False)` as a "stand-in for viewer node until it's added" (keymap comment). Node previews are drawn over nodes (`show_preview`, overlay *Previews*). Glossy/Anisotropic BSDF merged in 4.0. Bundles and closures are supported in shaders (5.0). The **Inline Shader Nodes API** (5.0) flattens groups, reroutes and muted nodes for export. VERIFIED keymap, [5.0 Python notes](https://developer.blender.org/docs/release_notes/5.0/python_api/)
- **Compositor**: backdrop controls (`Alt-MMB` move, `V`/`Alt-V` zoom, `Alt-Home` fit, `Alt`+click sample), `Z` render changed, `Ctrl-R` read view layers, `Shift-H` previews. GPU compositing for final renders plus per-node execution timings (4.2). Node options became linkable single-value inputs (4.4). Viewer shortcuts (4.4). The default tree contains a Viewer (4.5). Backdrop gizmos (4.5). **Inlined sockets** (5.0). The compositor is a regular node group: `scene.compositing_node_group` (5.0). Asset shelf and built-in assets (5.0). **Socket value inspection** (5.2). **Effects stack** instead of a single compositor group, and **Group Output used as viewer if no viewer exists** (5.3). VERIFIED keymap, compositor release notes 4.2–5.3

---

## 18. Python API for nodes: how scripting-friendly is it?

### 18.1 Core API (VERIFIED bundled API RST / [docs.blender.org/api/current](https://docs.blender.org/api/current/))
- `bpy.data.node_groups.new(name, type)`, with tree types e.g. `"GeometryNodeTree"`, `"ShaderNodeTree"`, `"CompositorNodeTree"`. Materials and worlds have embedded `node_tree`. Since 5.0 the compositor is `scene.compositing_node_group = tree`; `scene.node_tree` was removed. `material.use_nodes` / `world.use_nodes` / `scene.use_nodes` are deprecated (removal in 6.0) because new data-blocks create node trees by default.
- `Nodes.new(type)`: "Warning: should be same as node.bl_idname, not node.type!" Returns a `Node`. Also `remove(node)`, `clear()`, `active`.
- `NodeLinks.new(input, output, *, verify_limits=True, handle_dynamic_sockets=False)`. Conventional usage is `links.new(from_node.outputs[...], to_node.inputs[...])`; the core link function swaps in and out if they are reversed (VERIFIED via the source comment "Rely on the way #node_add_link switches in/out if necessary"). `verify_limits` removes existing links over the socket's link limit. `handle_dynamic_sockets` handles virtual/extend sockets (e.g. linking to a zone's blank socket).
- `NodeLink`: `is_valid` (red-link state), `is_muted`, `multi_input_sort_id`.
- `Node`: `name` (unique id), `label`, `location`, `location_absolute`, `width`, `height`, `hide`, `mute`, `parent` (frame), `select`, `show_options`, `show_preview`, `use_custom_color`, `color`, `color_tag` (4.4), `warning_propagation`, plus `bl_idname`, `bl_label`, `bl_description`. Custom nodes implement `init`, `copy`, `free`, `update`, `insert_link`, `draw_buttons`, `draw_label`, `poll`.
- `NodeSocket`: `name`, `identifier`, `type`, `enabled`, `hide`, `hide_value`, `link_limit`, `display_shape`, `description`, `pin_gizmo`, `show_expanded`, `is_inactive` and `is_icon_visible` (4.5).
- **Group interface** (4.0 breaking change from `tree.inputs`/`tree.outputs`): `tree.interface.new_socket(name, *, description="", in_out='INPUT'|'OUTPUT', socket_type='DEFAULT', parent=None)` (socket_type accepts only base types like `NodeSocketFloat`); `new_panel(name, *, description="", default_closed=False)`; `copy(item)`; `remove(item, *, move_content_to_parent=True)`; `move(item, to_position)`; `move_to_parent(item, parent, to_position)`; iterate `tree.interface.items_tree` and check `item.item_type == 'SOCKET'`. Items can be looked up by identifier (5.0). `NodeTreeInterface.root_panel` (5.3). Opening and closing node panels from Python (5.2).
- `NodeTree` attributes: `description`, `color_tag`, `default_group_node_width`, `bl_use_group_interface` (4.4), `contains_tree(sub_tree)`, `interface_update(context)`.
- **Operators** (`bpy.ops.node.*`, context-dependent): `add_node(type, use_transform, settings, visible_output)`, `add_repeat_zone`, `add_zone`, `group_make`, `group_ungroup`, `join_named`, `link_make(replace)`, `links_cut(path)`, `links_mute`, `add_reroute`, `swap_node`, `sockets_sync(node_name)`, per-node item add/move/remove ops (`repeat_zone_item_add`, `combine_bundle_item_add`, `geometry_nodes_viewer_item_add`, …), `insert_offset`, `link_drag_operation_test`, `viewer_shortcut_set/get`, `find_node`. VERIFIED bundled `bpy.ops.node.rst`
- Warnings: `modifier.node_warnings` (4.3). GeometrySet API for evaluated geometry (4.5). GN modifier inputs became proper RNA properties in 5.2, replacing custom properties.

### 18.2 Minimal example (written for this report, INFERRED correct for 5.x)
```python
import bpy
tree = bpy.data.node_groups.new("Scatter", "GeometryNodeTree")
tree.interface.new_socket("Geometry", in_out='INPUT',  socket_type='NodeSocketGeometry')
tree.interface.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
gin  = tree.nodes.new("NodeGroupInput");  gin.location  = (-400, 0)
gout = tree.nodes.new("NodeGroupOutput"); gout.location = (400, 0)
dist = tree.nodes.new("GeometryNodeDistributePointsOnFaces"); dist.location = (0, 0)
tree.links.new(gin.outputs["Geometry"], dist.inputs["Mesh"])
tree.links.new(dist.outputs["Points"], gout.inputs["Geometry"])
invalid = [(l.from_socket.name, l.to_socket.name) for l in tree.links if not l.is_valid]
```

### 18.3 Scripting-friendliness assessment
**Strengths** (VERIFIED where cited):
- Everything visible in the UI is RNA-addressable: nodes, links, interface, frames (`parent`), mute, hide, colors, labels, previews.
- Validity (`is_valid`), warnings, and operator introspection (`bl_rna`) are available.
- Node idnames appear in tooltips when Python tooltips are enabled (5.0).
- A test hook enumerates link-drag operations (`link_drag_operation_test`).
- Background mode (`blender --background`) runs scripts headless; the Blender Lab MCP has `execute_blender_code_for_cli`.

**Weaknesses** (VERIFIED from release notes and MCP instructions; the synthesis is INFERRED):
- **Socket addressing is fragile**. Since 4.1, nodes with dynamic socket types break `outputs[index]`; "use `node.outputs[some_socket_identifier]`". 5.2 changed socket identifiers on Compare and Random Value. Names are **localized**, so `nodes["Principled BSDF"]` fails on a non-English UI (community blender-mcp instructions).
- **Enum identifiers change between versions** ("Never hardcode enum identifiers").
- **Breaking API churn**: the interface API rewrite (4.0), `NodeTreeInterface.new_panel` lost its `parent` argument (4.2), property renames (e.g. `Box/Ellipse Mask width → mask_width`, `Geometry Color node color → value`), compositor nodes replaced by shader counterparts (5.0), removal of `scene.node_tree` (5.0).
- **Operators need editor context** (a `SpaceNodeEditor` area); the data API does not. Low-level API calls do **not** auto-layout, auto-offset, or sync dynamic sockets unless asked.
- **Evaluation results are not exposed as a clean "inspect socket value" API**. Socket inspection logs and the spreadsheet are UI-only (INFERRED; no RNA accessor found in the bundled API for socket log values).
- **Field report**: "anything beyond a few nodes tends to produce errors or incorrect connections"; "Geometry Nodes in particular is brittle; the API changes between Blender versions, and Claude's training data doesn't always match the version you're running" ([MindStudio](https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance)).

---

## 19. Blender MCP server patterns

### 19.1 Official Blender Lab MCP server (v1.0.3, requires Blender 5.1+)
VERIFIED [blender.org/lab/mcp-server](https://www.blender.org/lab/mcp-server/) and the local install `~/.local/share/blender-mcp/1.0.3/blmcp`:
- **Architecture**: an MCP server (FastMCP, `uv run blender-mcp`) plus a Blender add-on from the Lab extensions repo `https://lab.blender.org/`. Source: `projects.blender.org/lab/blender_mcp`. Each tool module has a thin MCP wrapper and a separate `*_toolcode.py` that executes inside Blender.
- **Tools** (each with MCP `ToolAnnotations`: `readOnlyHint=True` for inspection, `destructiveHint=True` for code execution):
  - Code: `execute_blender_code` ("assign a JSON-serialisable dict to a variable named `result`") and `execute_blender_code_for_cli` (opens a .blend in background mode).
  - File summaries: `get_blendfile_summary_datablocks`, `_missing_files`, `_of_linked_libraries`, `_path_info`, `_usage_guess`, each with a `_for_cli` variant.
  - Objects: `get_objects_summary`, `get_object_detail_summary`.
  - Docs: `get_python_api_docs`, `search_api_docs`, `search_manual_docs` (full-text search over the **bundled RST manual and API docs**).
  - Screenshots: `get_screenshot_of_area_as_image`, `get_screenshot_of_window_as_image`, **`get_screenshot_of_window_as_json`** ("JSON description of the Blender window layout, areas, active object, and selection").
  - Navigation: `jump_to_tab_by_name`, `jump_to_tab_by_space_type`, `jump_to_view3d_object_by_name`, `jump_to_view3d_object_data_by_name`.
  - Rendering: `render_thumbnail_to_path`, `render_viewport_to_path`.
- **Server instructions** (`data/prompts.yml`): "NEVER assume missing values - inspect the scene first." "The `execute_blender_code` tool is a last resort." "Prefer operators (`bpy.ops`) for standard actions … Use the data API (`bpy.data`) for precise control or to avoid side effects." "Return structured data (dicts, lists) from executed code, not print output." Also a primer on data-blocks, visibility and units.
- **Safety**: "The MCP server will execute LLM generated code in Blender without any guards in place". It recommends isolated machines or VMs.
- Demos include generating Geometry Nodes documentation and querying data relations.
- **No dedicated node-graph tools**; node editing goes through `execute_blender_code`.

### 19.2 Community ahujasid/blender-mcp (~28.8k stars, MIT; package renamed `mcp-for-blender`)
VERIFIED [repo](https://github.com/ahujasid/blender-mcp), `src/blender_mcp/server.py` main branch:
- **Architecture**: the add-on runs a TCP socket server in Blender, and the MCP server talks JSON over `localhost:9876` (`BLENDER_HOST` / `BLENDER_PORT`).
- **Tools**: `get_addon_status`, `get_scene_info`, `get_object_info`, `get_viewport_screenshot(max_size=1000)`, `execute_blender_code`, **`describe_node_type(bl_idname, property_overrides)`**, **`bpy_api_lookup(query)`**, asset tools (Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D), `import_generated_asset`, `disable_telemetry`. Every tool takes a verbatim **`user_prompt`** for trajectory/telemetry.
- **`describe_node_type` pattern**: "Look up the property and socket schema of a Blender node type, without touching the current scene … inputs/outputs (name, type, socket index, default value), what non-default properties … and what enum values are valid … Internally this creates a throwaway node in a scratch node tree, optionally applies property_overrides, reads its schema, then deletes the scratch tree." `property_overrides` exists because "Socket layout for many nodes depends on these mode-like properties" (e.g. `{"data_type": "RGBA"}` on Mix).
- **`bpy_api_lookup`** returns JSON RNA schemas (argument names, types, required flags, enum identifiers, min/max, defaults) with `did_you_mean` suggestions.
- **Safe mode** `BLENDER_MCP_SAFE_MODE=1` validates scripts: only bpy/bmesh/mathutils/pure stdlib imports; no eval/exec/open, no os/subprocess/network, no handlers/timers/drivers, no class registration, no external .blend loading.
- **Server instructions**: check `blender_version` first. "Look shader nodes up by type, never by name" (localization). "Never hardcode enum identifiers; they change between Blender versions." Call `get_viewport_screenshot()` after changes to confirm.
- Other servers exist ([MScanter/blender-mcp-Geometry_Nodes](https://github.com/MScanter/blender-mcp-Geometry_Nodes), [RFingAdam/mcp-blender](https://github.com/RFingAdam/mcp-blender) with "218 tools") but I could not verify their details (repo fetch returned 404).

### 19.3 Lessons (INFERRED)
1. **Code execution plus docs is a weak interface for graphs.** The errors named in the field (socket indices, localized names, enum drift, version mismatch) all come from the lack of a **typed, versioned graph schema**. Our MCP should expose declarative graph ops rather than arbitrary code.
2. **Schema introspection without side effects** (`describe_node_type`) and **API lookup with `did_you_mean`** are the most valuable helpers. We should make them first-class and exact (from node declarations), not scraped.
3. **Visual verification loop**: screenshot after changes, plus a JSON screenshot for layout. We should add a **structured "graph snapshot"** (nodes, links, validity reasons, inspection values) so agents don't need pixels.
4. **Tool annotations** (`readOnlyHint` / `destructiveHint`) and a **safe mode** are good defaults.

---

## 20. Prioritized UX patterns to adopt for our patch editor

Priority: **P0** = must have for v1 parity and agent-friendliness; **P1** = strong differentiator; **P2** = later polish. Each item gives exact interaction details to implement (INFERRED design, grounded in the VERIFIED Blender behavior cited above). Shortcut suggestions are Mac-first: Blender's Ctrl becomes **Cmd** for commands, Alt becomes **Option**, and right-drag gestures keep **Ctrl/Option** modifiers.

### P0: core editing and agent contract

1. **Declaration-based patch definitions (single source of truth)**
   - Every patch type declares its sockets: stable `identifier`, display name, description, type, shape (single/field/dynamic/list), default, min/max, subtype, and a "main socket" flag.
   - UI, validation, link-drag search, tooltips, docs and MCP schemas are all generated from these declarations.
   - Why: Blender's reliability problems for agents come from index- and name-based addressing. Its best features (link-drag search, tooltips, sync) are declaration-driven (§3, §7, §18).
2. **Add menu with instant type-to-search (Space or Shift+A)**
   - Open at the cursor and start typing with no click.
   - Rank: exact word match, then main patch, then recents (a "recently used on top" option).
   - Search operation presets too: typing "multiply" yields "Math ▸ Multiply" preconfigured.
   - Search input sockets ("Layer ▸ Opacity").
   - Include local and library assets and custom patches, and hide names starting with `.`.
   - The node is placed so its main socket sits under the cursor, then follows the mouse until click; Esc removes it. (§2, §3)
3. **Link-drag search**
   - Releasing a wire on empty canvas opens the same search, **pre-filtered to compatible `Patch ▸ Socket` pairs**, with main sockets weighted first and items listed unfiltered but in final order at open.
   - Special entries: "Reroute", "New Group Input", "Group Input ▸ <existing>".
   - On pick: connect, align the linked socket under the cursor, start move mode, and **carry the source's default value** into the new node when it creates a group input (§3).
   - Expose the same enumeration via MCP: `list_link_options(socket_ref) → [{patch_type, socket_id, label, weight}]`.
4. **Knife-cut links: Ctrl+right-drag.** Draw a stroke; every link crossed is deleted on release. Cursor changes to a knife. Also a toolbar tool for trackpad users (§4).
5. **Reroute stroke: Shift+right-drag.** Inserts a reroute on each link crossed; a single inserted reroute becomes selected. Also a double-click-on-wire alternative (INFERRED, trackpad friendly) (§4, §12.2).
6. **Mute/bypass: M on nodes, Ctrl+Option+right-drag on links**
   - A muted patch passes matching inputs to outputs. Pass-through links draw red/dimmed inside the node body.
   - A muted link acts as disconnected and reveals the input's default-value field again (§4, §10).
7. **Invalid-link reasons on the wire**
   - Invalid links render red, with an error badge on hover right on the link.
   - Messages: "Conversion not supported: Color ▸ Layer", "Links form a cycle", "Links can only go into a loop, not out", "Input expects a single value", "Input expects a list".
   - Dropping a node on an incompatible wire **dims the wire and doesn't break it**.
   - Validation is a pure pass, and results are exposed to MCP as `{link_id, valid, reason}` (§5.1).
8. **Implicit conversions table**
   - Document and implement: number↔boolean (>0 true), number→vector (all components), vector→number (average), color↔vector, color→number (luminance), int↔float (truncate).
   - Show a small conversion glyph on the wire (INFERRED improvement) (§5.2).
9. **Socket colors by type, and shapes by structure**
   - Distinct hue per data type (define our own palette: number, boolean, string, color, point/vector, layer, event/pulse, etc.), with wire colors matching the source socket.
   - Static shapes: **line = single value**, **diamond = per-element/field-like**, **circle = dynamic/polymorphic**, **pill = multi-input**. Hollow "+" socket = create a new item.
   - Dashed wire = a lazily evaluated/contextual signal. Never change shapes based on connections except on group I/O (§6).
10. **Hover inspection tooltips with live values**
    - Static block: name and description. Dynamic block: the last evaluated value with type, e.g. "Value: 0.75 · Number", "Point: 120, 44", "Color swatch + RGBA", "Pulse: fired 3 frames ago" (INFERRED Origami-specific).
    - "Value: not evaluated" when the node doesn't contribute to output.
    - Multi-input: numbered list per connection. Field-like: "depends on: Index, Position".
    - Same data via MCP `inspect_socket(socket_ref)` (§7).
11. **Warnings on nodes**
    - Header warning icon (info/warning/error severity), quick hover tooltip, per-group **propagation setting**, and an aggregated list in the inspector.
    - Searchable with Find (§5.3).
12. **Groups**
    - **Cmd+G** make group: a single node wraps and keeps its interface, defaults and name. Multiple nodes derive the interface from boundary links.
    - **Cmd+Option+G** ungroup: must preserve behavior, inserting converter nodes if needed.
    - **Tab / double-click** enter. **Tab, Cmd+Tab, double-click empty canvas, or clickable breadcrumbs** exit. Breadcrumbs always visible (§11.1).
13. **Group interface panel**
    - Tree view of Inputs/Outputs/**nested Panels** with drag-reorder and multi-select.
    - Per socket: type, description (tooltip), default, soft min/max (UI only, no clamp), subtype (percentage/factor/angle/time/distance…), hide value, optional label, shape.
    - Panels: description, closed-by-default, optional **panel toggle** checkbox.
    - Drag a link onto the hollow socket of Group Input/Output to create an interface item. Drag an input from the sidebar into the canvas for an extra Group Input node (§11.2).
14. **Selection model**
    - Click select, Shift toggle, box drag on empty canvas, lasso Cmd+Option+drag (Shift to subtract).
    - **L / Shift+L** select upstream/downstream, Shift+G select grouped (type/color/name prefix), Cmd+F find by name/socket/warning/value (pans to result).
    - Duplicate **Shift+D** (offset from the original, INFERRED fix for Blender's "exactly on top" hazard), **Cmd+Shift+D** duplicate keeping inputs.
    - Copy/paste at cursor, internal links included; paste between documents and app instances as text/JSON on the clipboard (Blender 5.1 cross-instance paste) (§13).
15. **Stable, versioned, typed graph API for MCP**
    - `add_patch(type, props, position?)`, `connect(from_socket_id, to_socket_id)`, `set_value`, `group(node_ids)`, `describe_patch_type(type, property_overrides)` (side-effect-free, like `describe_node_type`), `lookup_api(query) → did_you_mean`, `graph_snapshot()` with validity reasons, `inspect_socket`, and viewer data.
    - Use identifiers, never localized names. Operations are idempotent and batchable. Annotate tools with readOnly/destructive hints (§18.3, §19.3).

### P1: flow and debugging differentiators

16. **Drop-on-wire insertion plus animated auto-offset**
    - Dragging a single node with ≥1 input and ≥1 output over a wire highlights the nearest crossed wire (closest to the node's top-left).
    - On release, connect main input and main output. If the gap to neighbors is below the margin (default 40 pt), shift the downstream chain right with a 0.25 s ease.
    - **T** flips the direction (push upstream left). Hold **Option** to suppress attaching.
    - Only for unconnected nodes, or for nodes just created by link-drag search on links touching their connected socket (§12.5).
17. **Viewer patch plus per-element Spreadsheet panel**
    - **Cmd+Shift+click** any node or socket to route it to the active viewer; repeated clicks cycle outputs, and the viewer auto-positions near the node.
    - The viewer accepts many items (the hollow socket adds one; unlinking auto-removes it) and shows single values inline.
    - A spreadsheet panel lists per-element values (layers, list items, events over time) with sticky headers, resizable/reorderable columns, filters (=, >, < with threshold), row counts, and a pin.
    - Number keys 1–9 toggle assigned viewers (Cmd+1..9 assign).
    - MCP resource: `viewer_data(viewer_id) → table` (§8).
18. **Loop and higher-order zones with inspection index**
    - Repeat (iterations + iteration index), For Each (per layer/element), and Simulation/Stateful-over-frames (state carried to the next frame; delta time; skip).
    - Draw as an input/output node pair with a tinted enclosing region that auto-grows. Links may enter but never exit (show a red link with reason).
    - An "Inspection Index" chooses which iteration hover values and the viewer show (§14).
19. **Timings overlay**
    - Toggle in the overlays popover. Per-node last execution time. Frames sum children. Group Output shows the group total.
    - Label as approximate. Field/lazy nodes attribute cost to consumers (§9).
20. **Frames (comments/sections)**
    - **F** frames the selection and opens an inline label field immediately. **F while dragging** attaches/detaches with frame-border highlight. Cmd+P / Option+P add/remove.
    - Properties: label size, shrink-to-fit (default on), rich-text note body, color.
    - Nested frames alternate light/dark tint, and labels auto-contrast (§12.1).
21. **Collapse and socket hiding**: **H** collapses to header, **Cmd+H** hides unconnected sockets, and a combined command. Collapsed nodes keep their links attached to header anchors (§10).
22. **Swap patch (Shift+S)**: replace a node's type from the search menu, reconnecting links by matching socket **name and type**; unmatched links drop. Preserve data-block/asset references and zone contents (§2.2).
23. **Signature sync for struct-like and callable patches**
    - Bundles (struct sockets matched by name, slash paths for nested get/set) and closures (function values with captured outside values).
    - A **Sync** icon appears in the header on mismatch. Sync automatically on the first connection. Never auto-change existing sockets. "Define Signature" lock for published components.
    - Maps well to Origami JS patches and component interfaces (INFERRED) (§15).
24. **Grayed-out irrelevant inputs**: inputs that cannot affect the output, or are hidden by a menu choice, render dimmed or auto-hidden (§6.3).
25. **Make Links (J) and Connect-to-Output (Shift+Option+click)**: J connects open sockets among selected nodes (Shift+J replaces). Shift+Option+click wires a node's primary output to the group or document output for quick previews (§4).
26. **Lazy connect (Option+right-drag, from Node Wrangler)**
    - Drag from anywhere on node A to node B; auto-pick the best-matching sockets by name, type and openness.
    - Shift+Option+right-drag pops output/input pickers.
    - Great for trackpads and low precision (§16).
27. **Edge pan while dragging** nodes or links near the canvas edge: inside padding 2 UI units, max speed 26 units/s, 0.5 s ramp delay, zoom influence 0.5 (§4).

### P2: polish and power-user

28. **Snapping**: grid snap toggle (Shift+Tab), hold Cmd to invert during move/resize, multi-node resize, snap on paste (§12.3).
29. **Node Wrangler-style batch tools**: align selected with even spacing (Shift+=), delete unused nodes (Option+X), reset node to defaults (Backspace), copy settings to selected (Shift+C), batch rename labels, swap links (Option+S), add reroutes to all outputs (/), change mix factor with Option+arrows (±0.1 / ±0.01) (§16).
30. **Overlays popover**: wire colors, reroute auto labels, breadcrumbs, previews, timings, named-attribute usage (for us: "uses global state / external data" badges, INFERRED) (§9, node_editors).
31. **Custom node color and color tag** for groups (header color), with presets and "copy color to selected" (§10, §11.2).
32. **Operation-preset search entries** and socket-level search in the add menu (§2.1).
33. **Duplicate-linked** (Option+D) shares group definitions instead of copying (§13).
34. **Rich tooltips for developers**: show patch idname and version when "developer tooltips" is on (Blender 5.0 Python tooltips) (§7).
35. **Recents and "No Catalog" buckets** for assets; hide internal helpers with a leading `.` (§2.1).

---

## 21. Open questions and gaps

- The exact **grid step size** for node snapping and the default theme **noodle curving** value were not verified (theme defaults file not found at the fetched path).
- The **exact 4.3 link-drag insertion behavior** is partly unclear: the commit notes "The exact behavior still has to be figured out", so the source is the only reference.
- Whether socket inspection values are **readable from Python** (no RNA accessor found in the bundled API) is unconfirmed. If not, agents can't read hover values without screenshots.
- **Trackpad gestures**: Blender relies heavily on RMB drags (cut, reroute, mute, lazy connect). The Mac-first equivalents (toolbar tools exist since 5.0 for Cut/Mute/Reroute) need user testing.
- Third-party GN-specific MCP servers (MScanter, RFingAdam) could not be inspected (404 / not fetched).
- The Blender 5.3 release date and final keymap may still shift; the keymap here is main-branch as of 2026-09-16.
