# Troubleshooting

Symptoms, causes, and fixes.

Related: `simulation`, `gestures`, `graph-basics`

## First moves

1. Call `get_diagnostics` (use `severity: "warning"` to cut noise). Most problems are already named there, with ops to fix them.
2. Call `explain` with `audience: "engineer"` and the ids involved. It shows the chain from gesture to property.
3. Reproduce the problem:
   - `sim_reset`.
   - `sim_dispatch` the gesture on the real target. Read the hit report.
   - `sim_get_values` along the chain: the interaction output, the switch, the animation, then the layer property. Find where the value stops changing.
4. Fix the smallest thing. Re-run the same simulation to prove it.

## Nothing happens on tap

- **The hit report says it hit nothing:**
  - The layer has `opacity` 0, `enabled` off, or `hitTest` off. Diagnostics name this `untouchable_layer`.
  - The touch landed outside the layer. Target `"@layerId"` instead of a point.
- **It hit a different layer:** something in front (text, an overlay) catches the touch. Group them, or turn off `hitTest` on the covering layer.
- **Nothing heard it:** no interaction patch has `layer` set to this layer or one of its parents.
- **The switch changed but the layer didn't:** the chain isn't connected to a layer property, or a Transition's `start` equals its `end`. Look for `unused_patch` info.

## It snaps back on release

`down` is a state that ends when the finger lifts. For a change that stays, wire `tap` into a Switch's `flip`. The designer calls this "toggles".

## It jumps instead of animating

- A Switch or Interaction is wired straight into a Transition's `progress`, which only ever gets 0 or 1. Put `popAnimation` or `classicAnimation` in between.
- The animation sits after the Transition. Animate the 0…1 value, not the final units.

## Errors from write tools

Nothing changed when a write fails. Fix the call and retry.

| Code                                                 | Meaning                                      | Fix                                                                                   |
| ---------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `unknown_patch_type`, `unknown_port`, `unknown_prop` | a name doesn't exist                         | use the "did you mean"; confirm with `describe_patch_types` or `describe_layer_types` |
| `type_mismatch`                                      | the output type can't drive that input       | apply a suggested converter (the ops are included) or pick a matching port            |
| `wrong_direction`                                    | `from` is an input or `to` is an output      | swap them (suggested op included)                                                     |
| `already_connected`                                  | the input already has a connection           | `replaceExisting: true`, or merge sources with `or` (pulses) or `add` (numbers)       |
| `self_edge`                                          | a patch feeds its own input                  | put a `delay1` in between                                                             |
| `revision_conflict`                                  | the document changed since you read it       | re-read, then retry with the new `expectedRevision`                                   |
| `unknown_ref`                                        | a `$ref` wasn't defined earlier in the batch | add `"ref"` on the op that creates the item                                           |
| `human_edit` (undo)                                  | the newest change is the person's            | ask first; pass its `txnId` to undo it anyway                                         |

## Diagnostics worth knowing

- `pulse_into_state` (warning): a pulse drives a steady input. Insert a Switch, using the suggested ops.
- `feedback_loop` (info): the loop reads the previous frame's value. That's fine when intended.
- `unused_patch` (info): nothing uses the patch's outputs.
- `dangling_link`, `missing_layer` (errors): something points at a deleted item. Disconnect it or reset the value.

## Other surprises

- **Values look wrong in simulation right after edits.** The session hot-swapped the document and kept state. `sim_reset` gives a clean start.
- **"isn't implemented yet"** in runtime issues: that patch outputs default values for now. Pick another patch, or tell the person.
- **A loop shows one copy.** Every copy sits at the same position. Feed `gridLayout` positions into the layer.
- **Screenshots fail** in headless mode. Verify with `sim_get_values` and `sim_trace`, and suggest opening the project in the Sonobe app.
- **Changes vanished** after a headless session: the host wasn't autosaving, so call `save_document`. `get_document_info` shows "unsaved changes".
