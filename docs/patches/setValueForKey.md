<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Set Value for Key

Adds or replaces one named field in a JSON object and outputs the updated copy.

| | |
|---|---|
| Type key | `setValueForKey` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | set field, update object, add key, set property, put value, assign, change json, set object for key |

## How it works
Set Value for Key takes a JSON object and gives back a copy with one entry changed. The original object stays as it was for any other patch reading it.

- **Object** is the object to start from.
- **Key** is the entry to set. If Object already has it, its value is replaced in the same position; otherwise the entry is added at the end.
- **Value** is the new value. Change the patch's type to store text, numbers, booleans, colors, points, JSON, or media.
- **Output** is the updated object, on the same frame any input changes.

While Key is empty, Output is Object unchanged, so you can insert the patch into a chain safely.

## Tips
- Chain several of these to build a request body field by field.
- To combine whole objects at once, use Object Join.
- Keys are top-level only: "user.name" is one key with a dot in it, not a nested field.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Object**<br>`object` | `json` | `{}` | The JSON object to start from; it isn't changed for other patches. |
| **Key**<br>`key` | `text` | `""` | The entry to add or replace, matched exactly; empty passes Object through unchanged. |
| **Value**<br>`value` | `variant` | `0` | The new value for Key. Its type follows the patch's type. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `json` | A copy of Object with Key set to Value. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `json`, `image`, `video`, `sound`.

## Examples

### Mark a post as liked before sending it

```text
layer heart rectangle "Heart" @171,400 48x48
layer preview text "Preview" @24,480 text←preview_text.text
patch tap_heart interaction layer=@heart
patch liked switch flip←tap_heart.tap
patch post jsonObject<number> key="postId" value=81
patch with_like setValueForKey<boolean> object←post.object key="liked" value←liked.on
patch preview_text jsonToText json←with_like.output pretty=false
```

### Add a request field from a counter

```text
layer more_button rectangle "Load More" @24,760 342x52
patch tap_more interaction layer=@more_button
patch page counter increase←tap_more.tap
patch query jsonObject<text> key="sort" value="newest"
patch with_page setValueForKey<number> object←query.object key="page" value←page.count
patch feed networkRequest request←tap_more.tap url="https://example.com/feed" body←with_page.output
```

## Common mistakes

- The change never reaches the original data: Set Value for Key makes a copy. Read from its Output downstream instead of from the original object.
- A nested field isn't updated and a new key with a dot appears instead: keys are top-level only. Read the inner object with Value for Key, set the field on it, then set it back on the outer object.
- The value disappears on the next frame after a tap: this patch has no memory. Store the value in a Switch, Counter, or Sample and Hold and wire that into Value.

## Pairs well with

- [JSON Object](jsonObject.md): Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Object Join](objectJoin.md): Merges several JSON objects into one, with later objects overwriting keys that earlier ones already have.
- [JSON to Text](jsonToText.md): Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Set Value for Key (`builtin.structure.setobjectforkey`)
- **Also imports:** `builtin.structure.setObjectForKey`

| Sonobe port | Origami label |
|---|---|
| `output` | Object |
