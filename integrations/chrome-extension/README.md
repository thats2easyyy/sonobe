# Sonobe Capture for Chrome

A Chrome extension that copies a web page, or one element of it, as a design you paste into Sonobe as real layers. It runs the same DOM walker as File → Import Design… (`@sonobe/import`), right in the tab you're looking at, so it works on signed-in pages, pages behind a VPN, and anything else you can open in Chrome.

## Build and install

From a Sonobe checkout with dependencies installed:

```sh
node integrations/chrome-extension/build.ts
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick `integrations/chrome-extension/dist`.

## Use it

1. Open the page. For a phone layout, turn on device mode in Chrome's developer tools (⌥⌘I, then ⇧⌘M) and pick a device first.
2. Click the Sonobe Capture button (⌥⇧S), then:
   - **Copy page** copies the whole page.
   - **Pick an element…** (or ⌥⇧E) highlights what's under the pointer. Press ↑ to select the parent, ↓ to go back, and click or press Return to copy it.
3. In Sonobe, press ⌘V. The design lands as a new screen, one undo step.

**Embed images from other sites** asks Chrome for access to every site, so the extension can download images and fonts that pages load from CDNs. Without it, those stay linked to their web addresses.

## What it can't read

Chrome doesn't let extensions run on browser pages (`chrome://`), the Chrome Web Store, or PDFs. Hidden elements aren't captured, and CSS animations don't come along; build motion with patches.

## Test

```sh
node integrations/chrome-extension/smoke.ts
```

Builds a test copy (`dist-test/`, with site access granted up front), loads it into Chromium with Playwright, copies a page through the service worker, picks a card with the element picker, reads the clipboard, and imports the capture.
