import { Root } from "./app/Root.tsx";
import { mountEditor } from "./app/mount.tsx";
import "./theme/tokens.css";
import "./theme/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

mountEditor(root, <Root />);
