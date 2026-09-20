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
- **Only the first tap works:** an `or` merges a state such as `down`, which stays on, so Or never turns on again. Merge `tap` pulses instead.

## It stops dead when released

A thrown layer needs the release speed. Wire the gesture's `down` into the spring's `gestureActive` and its `velocity` into `gestureVelocity` (see `gestures`). A `velocity` patch on a position reads 0 on the release frame.

## It snaps back on release

`down` is a state that ends when the finger lifts. For a change that stays, wire `tap` into a Switch's `flip`. The designer calls this "toggles".

## Old ports stay on instances after a rebuild

`updateInterface` merges ports by key. Send the whole interface with `"replace": true`, or unpublish ports with `null`. The result lists every cable it cut; reconnect the ones you still need (see `components`).

## It jumps instead of animating

- A Switch or Interaction is wired straight into a Transition's `progress`, which only ever gets 0 or 1. Put `popAnimation` or `classicAnimation` in between.
- The animation sits after the Transition. Animate the 0…1 value, not the final units.

## Errors from write tools

Nothing changed when a write fails. Fix the call and retry.

| Code                                                 | Meaning                                 | Fix                                                                                   |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| `unknown_patch_type`, `unknown_port`, `unknown_prop` | a name doesn't exist                    | use the "did you mean"; confirm with `describe_patch_types` or `describe_layer_types` |
| `type_mismatch`                                      | the output type can't drive that input  | apply a suggested converter (the ops are included) or pick a matching port            |
| `wrong_direction`                                    | `from` is an input or `to` is an output | swap them (suggested op included)                                                     |
| `already_connected`                                  | the input already has a connection      | `replaceExisting: true`, or merge sources with `or` (pulses) or `add` (numbers)       |
| `self_edge`                                          | a patch feeds its own input             | put a `delay1` in between                                                             |
| `revision_conflict`                                  | the document changed since you read it  | re-read, then retry with the new `expectedRevision`                                   |
| `unknown_ref`                                        | no op in the batch defines that `$ref`  | add `"ref"` on the op that creates the item; the error lists the batch's refs         |
| `unknown_field`                                      | an op or port has no such field         | use the "did you mean"; `updateInterface` takes `replace: true` for a whole side      |
| `id_taken`                                           | an item already has that id             | remove the old item earlier in the same batch, or leave `id` out                      |
| `id_retired`                                         | an earlier batch removed that id        | undo the removal and rebuild in one batch, or leave `id` out to get `_2`              |
| `human_edit` (undo)                                  | the newest change is the person's       | ask first; pass its `txnId` to undo it anyway                                         |
| `capture_timeout` (import)                           | the page didn't finish within 90 s plus `waitMs` | the message names the step; follow its hint, such as `waitFor` for a page that loads late, or import without `screenshot` |
| `cancelled`                                          | the call was cancelled before it changed anything | nothing to undo; call it again when ready                                  |

## Diagnostics worth knowing

- `pulse_into_state` (warning): a pulse drives a steady input. Insert a Switch, using the suggested ops.
- `feedback_loop` (info): an intentional loop. It goes through `delay1`, or values only come back when a pulse fires (a Next button's page jump, a sample-and-hold grab). Nothing to fix; describe it as part of the design.
- `feedback_loop` (warning): values feed back every frame, so they can drift or oscillate. If it's on purpose, insert `delay1` on the named cable (the ops are included); otherwise disconnect it.
- `unused_patch` (info): nothing uses the patch's outputs.
- `unused_input` (info): nothing inside a component reads that published input, so values sent to it do nothing. Read it with `$in.key`, or unpublish it.
- `undriven_output` (warning): a cable reads an instance output that nothing inside the component drives, so it stays at its default. Connect `$out.key` inside, or disconnect the cable.
- `dangling_link`, `missing_layer` (errors): something points at a deleted item. Disconnect it or reset the value.
- `empty_loop` (runtime warning, in sim results and the Live viewer section): a layer or component has 0 copies because an empty loop erased real items, or a `loopSelect` picked past the end. The message says where the empty loop started; apply one of its ops (usually `outOfRange` on that Loop Select). It goes away once the copies are back.

## Other surprises

- **Values look wrong in simulation right after edits.** The session hot-swapped the document and kept compatible state, such as springs mid-flight and switches that are on. `sim_reset` gives a clean start. An empty loop is not leftover state: a list that went empty comes back on its own, so if it stays empty, the wiring empties it (see the `empty_loop` warning).
- **"isn't implemented yet"** in runtime issues: that patch outputs default values for now. Pick another patch, or tell the person.
- **A loop shows one copy.** Every copy sits at the same position. Feed `gridLayout` positions into the layer.
- **A loop shows zero copies, and values read `null`.** Something feeding the layer is an empty loop, which wins over every other loop. Read the `sim_get_values` note and any `empty_loop` warning; they name where it started. The usual cause is a `loopSelect` index past the end, often in a feedback loop whose `delay1` passes one value on the first frame. Set `outOfRange` to `"fallback"` or `"clamp"` (see `loops`).
- **A headless screenshot looks slightly off.** Headless servers draw the screen themselves: text uses approximate metrics, and video, Lottie and shaders are placeholders. Check exact values with `sim_get_values`, or open the project in the Sonobe app.
- **A long call timed out in a script you wrote** (an MCP SDK client): the SDK gives up after 60 s by default. Pass `onprogress` together with `resetTimeoutOnProgress: true`. Without `onprogress` the client never asks for progress, so there's nothing to reset the timer. Check `list_history` before retrying: a call that got past its last step may have finished.
- **Changes vanished** after a headless session: the host wasn't autosaving, so call `save_document`. `get_document_info` shows "unsaved changes".
- **Unsaved work is gone after the app quit or crashed.** The app keeps it as a draft. `list_documents` lists it as `draft:<id>`, and `open_document({ "ref": "draft:<id>" })` brings it back (the person can also open it from the welcome screen). Then save it with `save_document({ "path": … })`.
