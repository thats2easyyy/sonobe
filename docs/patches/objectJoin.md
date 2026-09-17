<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Object Join

Merges several JSON objects into one, with later objects overwriting keys that earlier ones already have.

| | |
|---|---|
| Type key | `objectJoin` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | merge objects, combine json, object assign, spread, extend, defaults and overrides, merge headers |

## How it works
Object Join combines the entries of several JSON objects into one object.

- **Object 1**, **Object 2**, and so on are merged in order. Change the number of inputs to add more.
- When two objects have the same key, the later object's value wins. The key keeps the position where it first appeared.
- The merge is shallow: if both objects hold a nested object under the same key, the later nested object replaces the earlier one completely.
- Inputs that aren't objects are skipped.
- **Object** is the merged result, updated on the same frame any input changes.

## Tips
- Put defaults in Object 1 and overrides in Object 2.
- Build request headers from separate JSON Object patches, such as `Content-Type` and `Authorization`, then join them.
- To change a single key, Set Value for Key is simpler.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Object 1, Object 2, …** (`object1`, `object2`, …) · `json` · default `{}`

An object to merge; its keys overwrite the same keys from earlier inputs.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Object**<br>`object` | `json` | One object holding every entry from the inputs; for duplicate keys, the later input's value. |

## Examples

### Combine request headers

```text
layer refresh_button rectangle "Refresh" @24,760 342x52
patch tap_refresh interaction layer=@refresh_button
patch content_type jsonObject<text> key="Content-Type" value="application/json"
patch auth jsonObject<text> key="Authorization" value="Bearer demo-token"
patch headers objectJoin[2] object1←content_type.object object2←auth.object
patch inbox networkRequest request←tap_refresh.tap url="https://example.com/inbox" headers←headers.object
```

### Apply a theme override to default settings

```text
layer settings_text text "Settings" @24,120 text←settings_text_value.text
patch defaults jsonFile asset="default_settings"
patch dark_mode jsonObject<text> key="theme" value="dark"
patch settings objectJoin[2] object1←defaults.json object2←dark_mode.object
patch settings_text_value jsonToText json←settings.object
```

## Common mistakes

- Your override doesn't take effect: it's in an earlier input, and later inputs win. Put defaults first and overrides last.
- A nested setting loses its other fields: the merge is shallow, so a nested object is replaced, not combined. Join the nested objects separately, then set the result back with Set Value for Key.

## Pairs well with

- [JSON Object](jsonObject.md): Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data.
- [Set Value for Key](setValueForKey.md): Adds or replaces one named field in a JSON object and outputs the updated copy.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Get Keys](getKeys.md): Lists the names of every entry in a JSON object as an array of text, so you can show or loop over them.
- [JSON to Text](jsonToText.md): Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Object Join
