import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LAUNCH_WAIT_MS, startLaunch } from "./app/launch.ts";
import { Root } from "./app/Root.tsx";
import "./theme/tokens.css";
import "./theme/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );

// A window the desktop app opened for a prototype renders it first, never the demo: the render waits for it to be
// read, and not for long. Everywhere else there is nothing to wait for.
const launching = startLaunch();
if (launching) void Promise.race([launching, new Promise((resolve) => setTimeout(resolve, LAUNCH_WAIT_MS))]).then(render);
else render();
