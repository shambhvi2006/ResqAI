import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";

const CONFIG = {
  critical: {
    query: "hospital",
    fallbackQuery: "hospital+near+me",
    label: "Nearest Hospital ->",
    fallbackLabel: "Find nearest hospital",
    background: "#FFF0F0",
    border: "#DC2626",
    color: "#DC2626",
  },
  serious: {
    query: "urgent+care",
    fallbackQuery: "urgent+care+near+me",
    label: "Nearest Urgent Care ->",
    fallbackLabel: "Find nearest urgent care",
    background: "#FFFBEB",
    border: "#F59E0B",
    color: "#92400E",
  },
  minor: {
    query: "pharmacy",
    fallbackQuery: "pharmacy+near+me",
    label: "Nearest Pharmacy ->",
    fallbackLabel: "Find nearest pharmacy",
    background: "#F0FDF4",
    border: "#22C55E",
    color: "#166534",
  },
};

export default function HospitalDirections({ severity, condition }) {
  const [coords, setCoords] = useState(null);
  const [locationFailed, setLocationFailed] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const config = CONFIG[severity] || CONFIG.serious;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!navigator.geolocation) {
      setLocationFailed(true);
    } else {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoords({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationFailed(false);
        },
        () => setLocationFailed(true),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const mapsUrl = useMemo(() => {
    if (coords && !locationFailed) {
      return `https://www.google.com/maps/search/${config.query}/@${coords.lat},${coords.lng},14z`;
    }
    return `https://www.google.com/maps/search/${config.fallbackQuery}`;
  }, [config.fallbackQuery, config.query, coords, locationFailed]);

  const label = coords && !locationFailed ? config.label : config.fallbackLabel;

  return (
    <div
      className="hospital-directions-card"
      style={{
        background: config.background,
        borderColor: config.border,
        color: config.color,
      }}
      data-condition={condition || "unknown"}
    >
      <button type="button" onClick={() => window.open(mapsUrl, "_blank", "noopener,noreferrer")}>
        <MapPin size={22} strokeWidth={2.4} />
        <span>{label}</span>
      </button>
      {!isOnline && <p>Tap when connected to get directions</p>}
    </div>
  );
}
