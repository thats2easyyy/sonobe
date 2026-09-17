<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text to JSON

Reads text written in JSON format and turns it into data the JSON patches can use.

| | |
|---|---|
| Type key | `textToJson` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | parse json, json parse, read json text, decode json, string to object, text to data |

## How it works
Text to JSON reads text such as `{"name": "Ada"}` or `[1, 2, 3]` and outputs it as JSON data.

- **Text** is the JSON-formatted text to read. It must be standard JSON: keys and text in double quotes, no trailing commas, no comments.
- **JSON** is the result. It can be an object, an array, or a single value such as a number.
- **Error** turns on when the text isn't valid JSON, and **Error Message** explains why. While there's an error, JSON is empty.
- Empty text, or text with only spaces, gives empty JSON without an error.

## Tips
- Use it on text that holds data, such as a WebSocket message or text from a script.
- JSON to Text does the reverse.
- Show Error Message in a Text layer while you debug a payload.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` (multiline) | `""` | JSON-formatted text to read; empty text gives empty JSON. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **JSON**<br>`json` | `json` | The data the text describes, or empty when the text is empty or invalid. |
| **Error**<br>`error` | `boolean` | True when Text isn't valid JSON. |
| **Error Message**<br>`errorMessage` | `text` | Why the text couldn't be read, or empty text when there's no error. |

## Examples

### Read a list of sizes from text

```text
layer headline text "Headline" @24,120 fontSize←medium_size.value
patch sizes textToJson text="[16,24,32]"
patch medium_size valueAtIndex<number> array←sizes.json index=1
```

### Show why a payload won't parse

```text
layer error_banner text "Parse Error" @24,80 enabled←payload.error text←payload.errorMessage
patch payload textToJson text="{broken"
```

## Common mistakes

- Error turns on for text that looks fine: it uses single quotes, unquoted keys, or a trailing comma. Write keys and text in double quotes and remove the last comma.
- JSON is empty but Error is off: the text is empty or only spaces. Check that the upstream text has arrived.

## Pairs well with

- [JSON to Text](jsonToText.md): Turns any JSON value into readable JSON text, for checking data on screen or sending it as a message.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [WebSocket Receive](webSocketReceive.md): Outputs the text or JSON messages a server sends over a WebSocket connection, and pulses when each new one arrives.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text to JSON
