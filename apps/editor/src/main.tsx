import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./app/Root.tsx";
import "./theme/tokens.css";
import "./theme/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
