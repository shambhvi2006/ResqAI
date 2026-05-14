import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { SessionProvider } from "./context/SessionContext.jsx";
import { registerSW } from "virtual:pwa-register";

registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("resqai-app-updated"));
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent("resqai-offline-ready"));
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>
);
