const MODE_CONFIG = {
  local: {
    label: "Enhanced Local + Cloud",
    className: "ai-mode-indicator ai-mode-indicator--local",
  },
  cloud: {
    label: "Cloud AI",
    className: "ai-mode-indicator ai-mode-indicator--cloud",
  },
  offline: {
    label: "Fallback",
    className: "ai-mode-indicator ai-mode-indicator--offline",
  },
};

export default function AIModeIndicator({ source = "cloud" }) {
  const config = MODE_CONFIG[source] || MODE_CONFIG.cloud;
  return <div className={config.className}>{config.label}</div>;
}
