import React from "react";
import { createRoot } from "react-dom/client";
import CharacterManager from "../app/character-manager";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到应用挂载节点");

const storedTheme = localStorage.getItem("tavern-vault-theme");
if (storedTheme === "dark" || storedTheme === "fresh") {
  document.documentElement.dataset.theme = storedTheme;
}

createRoot(root).render(
  <React.StrictMode>
    <CharacterManager />
  </React.StrictMode>,
);
