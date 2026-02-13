import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// 👇 PWA: registra SW e gestisci refresh
import { registerSW } from "virtual:pwa-register";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // segnala all'app che c'è un update
    window.dispatchEvent(new CustomEvent("pwa:update-available"));
  },
  onOfflineReady() {
    // opzionale
    console.log("PWA offline ready");
  },
});

window.__PWA_UPDATE_SW__ = updateSW;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
