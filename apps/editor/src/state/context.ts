/** React context holding the current EditorSession (see EditorProvider). */

import { createContext } from "react";
import type { EditorSession } from "./session.ts";

export const EditorContext = createContext<EditorSession | null>(null);
