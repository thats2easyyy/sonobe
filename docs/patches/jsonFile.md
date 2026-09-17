<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# JSON File

Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.

| | |
|---|---|
| Type key | `jsonFile` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | data file, json asset, load json, local data, mock data, fixture, sample data, import json |

## How it works
JSON File reads a `.json` file stored in your project and outputs its contents as data.

- Drop a `.json` file onto the patch editor to create the patch, or choose the file in the inspector. The file lives in the project's assets, so it travels with the prototype.
- **JSON** is the file's data: usually an object or an array.
- **Loading** is true while the file is being read. It usually lasts a frame or two when the prototype starts.
- **Error** turns on when the file is missing or isn't valid JSON, and **Error Message** explains why.

When you replace the file, the patch reads it again. The previous data stays on screen until the new data is ready.

## Tips
- Use a JSON File as mock data while you design, then swap in a Network Request with the same shape.
- Read fields with Value for Key or Value at Path, and make rows with Loop Over Array.
- Keep files small. Very large files slow down loading.

## Coming from Origami
Formerly called Data File.

## Inputs

This patch has no fixed inputs.

## Outputs

| Output | Type | Description |
|---|---|---|
| **JSON**<br>`json` | `json` | The file's contents as data; empty until the file has loaded, and while there's an error. |
| **Loading**<br>`loading` | `boolean` | True while the file is being read. |
| **Error**<br>`error` | `boolean` | True when the file is missing, can't be read, or isn't valid JSON. |
| **Error Message**<br>`errorMessage` | `text` | Why the file couldn't be loaded, or empty text when there's no error. |

## Settings

Settings configure the patch itself instead of flowing through cables.

| Setting | Type | Default | Description |
|---|---|---|---|
| **File**<br>`asset` | `text` | `""` | The id of a JSON file in the project's assets. Drop a .json file on the patch editor to add one. |

## Examples

### Build a contact list from mock data

```text
layer contacts group "Contacts" @0,100 390x700 layout=column spacing=12
  layer contact_name text "Contact Name" text←names.value
patch people jsonFile asset="contacts"
patch rows loopOverArray array←people.json
patch names valueForKey<text> object←rows.items key="name"
```

### Show a loading message until the file is ready

```text
layer loading_label text "Loading" @24,120 enabled←catalog.loading
layer product_count text "Product Count" @24,160 text←count_products.count
patch catalog jsonFile asset="catalog"
patch products valueForKey object←catalog.json key="products"
patch count_products arrayCount array←products.value
```

## Common mistakes

- Error Message says the file isn't valid JSON: the file has comments, trailing commas, or single quotes. Fix it in a text editor and replace the asset.
- The first frame shows empty rows or placeholder text: the file is still loading. Wire Loading into a placeholder's Enabled, or hide the list until JSON arrives.

## Pairs well with

- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Value at Path](valueAtPath.md): Reads a value deep inside JSON with a dot path like results.0.title, including every match with * or a .. search.
- [Array Sort](arraySort.md): Sorts a JSON array from smallest to largest or the reverse, optionally by a field such as price or name.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Data File (`builtin.dataFile`)
