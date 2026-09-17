<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Network Request

Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.

| | |
|---|---|
| Type key | `networkRequest` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Web-limited |
| Search terms | http request, fetch, api call, rest api, get request, post request, download, load data, graphql, ajax |

## How it works
Network Request loads data from the internet when **Request** gets a pulse (a signal that's on for one frame). Nothing is sent until then, so changing the URL alone doesn't reload anything.

- **URL** is the address to load, starting with `https://`.
- **Method** is usually GET to read data. Use POST, PUT, PATCH, or DELETE to send data, with **Body** holding the JSON to send.
- **URL Parameters** and **Headers** are JSON objects added to the request, such as `{"q": "shoes"}` or an `Authorization` header.
- Right-click to choose what **Result** holds: JSON (the default), Text, Image, Video, or Sound.
- **Loading** is true while the request runs. **Finished** pulses when it ends, successfully or not.
- **Error** turns on when something went wrong, and **Error Message** says why in plain words. A failed request keeps the last good Result on screen.

## Tips
- Wire When Prototype Starts into Request to load data on open.
- Turn on **Stream** for servers that send results bit by bit, like AI text, so Result fills in as data arrives.
- In the web player, servers must allow cross-origin requests (CORS), and `http://` URLs are blocked. The desktop app has neither limit.

## Coming from Origami
Expect GraphQL Stream is now **Stream** and also handles NDJSON and server-sent events. The Boolean Error port is **Error**, and the JSON one is **Error Details**. Finished, Error Message, and Status are new, and Method adds PUT, PATCH, and DELETE.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Request**<br>`request` | `pulse` | — | Pulse to send the request. A new pulse replaces a request that's still loading. |
| **URL**<br>`url` | `text` (url) | `""` | The address to load, starting with https:// or http://. Spaces at either end are ignored. |
| **Method**<br>`method` | `enum` | `get` | How the request talks to the server. Most APIs use GET to read and POST to send. |
| **URL Parameters**<br>`urlParameters` | `json` | `{}` | A JSON object whose keys and values are added to the end of the URL, like {"q": "shoes"} becoming ?q=shoes. |
| **Headers**<br>`headers` | `json` | `{}` | A JSON object of extra request headers, such as an Authorization token. |
| **Body**<br>`body` | `json` | `{}` | The JSON to send with POST, PUT, PATCH, or DELETE. It's ignored for GET. |
| **Content Type**<br>`contentType` | `enum` · advanced | `auto` | How Body is packaged. Auto picks form data when Body includes media, and JSON otherwise. |
| **Stream**<br>`stream` | `boolean` · advanced | `false` | When on, Result updates as data arrives instead of waiting for the whole response, for streaming APIs such as AI text generation. |
| **Disable Timeout**<br>`disableTimeout` | `boolean` · advanced | `false` | When on, the request can take longer than 60 seconds. When off, a request still loading after 60 seconds fails. |

**Method options**

- **GET** (`get`): Reads data. Body isn't sent.
- **POST** (`post`): Sends Body to create something or run an action.
- **PUT** (`put`): Sends Body to replace something.
- **PATCH** (`patch`): Sends Body to change part of something.
- **DELETE** (`delete`): Asks the server to remove something.

**Content Type options**

- **Auto** (`auto`): Form data when Body contains an image, video, or sound; JSON otherwise.
- **JSON (application/json)** (`json`): Sends Body as JSON text.
- **Form Data (multipart/form-data)** (`multipartFormData`): Sends each key of Body as a form field, with media as file uploads.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Result**<br>`result` | `variant` | The response as the patch's type: JSON, text, image, video, or sound. It keeps the last good response when a later request fails. |
| **Loading**<br>`loading` | `boolean` | True while a request is in progress. |
| **Finished**<br>`finished` | `pulse` | Pulses when a request ends, whether it worked or failed. |
| **Error**<br>`error` | `boolean` | True when the most recent request failed. |
| **Error Message**<br>`errorMessage` | `text` | A plain-language reason the most recent request failed, or empty text when it worked. |
| **Status**<br>`status` | `number` · advanced | The HTTP status code of the last response, like 200 or 404; 0 before any response or when the server couldn't be reached. |
| **Error Details**<br>`errorDetails` | `json` · advanced | A JSON object describing the last failure, including the status and the server's error body; null when the last request worked. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `json` (default), `text`, `image`, `video`, `sound`.

## Examples

### Load a headline when the prototype opens

A spinner shows while the text loads.

```text
layer headline text "Headline" @24,160 text←fetch_headline.result
layer spinner oval "Spinner" @183,420 24x24 opacity←fetch_headline.loading
patch on_start whenPrototypeStarts
patch fetch_headline networkRequest<text> request←on_start.started url="https://example.com/headline.txt"
```

### Tap to download a new photo

```text
layer photo image "Photo" @16,120 358x240 image←fetch_photo.result
layer reload_button rectangle "Reload Button" @16,400 358x56
patch tap_reload interaction layer=@reload_button
patch fetch_photo networkRequest<image> request←tap_reload.tap url="https://example.com/photo.jpg"
```

## Common mistakes

- Changing the URL doesn't load anything new: requests only start on a pulse. Wire Pulse on Change on the URL, or a Tap, into Request.
- Error Message says the response isn't valid JSON: the server sent a web page or plain text. Switch the patch to Text to see what came back, and check the URL.
- It works in the desktop app but fails on a phone: the web player follows browser rules, so the server must allow cross-origin requests and the URL must use https://.

## Pairs well with

- [When Prototype Starts](whenPrototypeStarts.md): Sends one pulse on the prototype's first frame, and again each time the prototype restarts.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Pulse on Change](pulseOnChange.md): Sends a pulse whenever a watched value changes, such as a new page number or a different tab.
- [Base64 Decode](base64Decode.md): Turns base64 text back into text, JSON, an image, or a sound.

## Availability

**Web-limited.** In the web player, browsers enforce CORS, block http:// URLs from https pages, and forbid some headers; the desktop app sends requests without those limits.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Network Request (`builtin.network.request`)

| Sonobe port | Origami label |
|---|---|
| `stream` | Expect GraphQL Stream |
| `error` | Error (Boolean) |
| `errorDetails` | Error (JSON) |
