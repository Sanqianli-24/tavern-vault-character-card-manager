import React from "react";
import { createRoot } from "react-dom/client";
import CharacterManager from "../app/character-manager";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到应用挂载节点");

createRoot(root).render(
  <React.StrictMode>
    <CharacterManager />
  </React.StrictMode>,
);
