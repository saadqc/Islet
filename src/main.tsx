import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/700-italic.css";
import App from "./App";
import "./styles.css";
Promise.all([
  document.fonts.load("13px Inter"),
  document.fonts.load('13px "JetBrains Mono"'),
  document.fonts.ready,
]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
