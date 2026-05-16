import { useEffect, useState } from "react";
import { isOllamaAvailable } from "../services/ollamaService";

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";

function StatusPill({ label, status }) {
  return (
    <span className={`health-pill health-pill--${status}`}>
      <span className="health-pill__dot" />
      {label}
    </span>
  );
}

export default function AIHealthPanel() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localReady, setLocalReady] = useState(false);
  const [lastChecked, setLastChecked] = useState("");

  const cloudConfigured = Boolean(import.meta.env.VITE_GEMMA_API_KEY);
  const offlineReady = true;
  const isOnline = navigator.onLine;

  useEffect(() => {
    refreshHealth();

    const handleOnline = () => refreshHealth();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  async function refreshHealth() {
    setLoading(true);
    try {
      const available = await isOllamaAvailable();
      setLocalReady(available);
    } catch {
      setLocalReady(false);
    } finally {
      setLastChecked(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setLoading(false);
    }
  }

  const overallStatus = localReady ? "ok" : cloudConfigured ? "cloud" : "fallback";

  return (
    <div className={`health-panel health-panel--${expanded ? "open" : "closed"}`}>
      <button
        type="button"
        className={`health-panel__trigger health-panel__trigger--${overallStatus}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="health-panel__trigger-dot" />
        AI Health
      </button>

      {expanded && (
        <div className="health-panel__card">
          <div className="health-panel__row">
            <strong>Inference status</strong>
            <button type="button" className="health-panel__refresh" onClick={refreshHealth} disabled={loading}>
              {loading ? "Checking..." : "Refresh"}
            </button>
          </div>

          <div className="health-panel__pills">
            <StatusPill label={localReady ? "Local ready" : "Local unavailable"} status={localReady ? "ok" : "muted"} />
            <StatusPill label={cloudConfigured ? "Cloud configured" : "Cloud missing key"} status={cloudConfigured ? "cloud" : "warn"} />
            <StatusPill label={offlineReady ? "Offline fallback ready" : "Offline missing"} status={offlineReady ? "fallback" : "warn"} />
          </div>

          <div className="health-panel__meta">
            <span>Network: {isOnline ? "online" : "offline"}</span>
            <span>Ollama: {OLLAMA_URL}</span>
            <span>Last checked: {lastChecked || "not yet"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
