/** Entry for the injected walker bundle: exposes captureDom as `window.__sonobeCapture`. */

import { captureDom } from "./walk.ts";

(globalThis as { __sonobeCapture?: typeof captureDom }).__sonobeCapture = captureDom;
