import { useEffect, useState } from "react";
import { useSession } from "../context/SessionContext.jsx";
import { speakInstruction } from "../lib/tts.js";

export default function EmergencyHelp() {
  const { woundAssessment, language, isMuted, dispatch } = useSession();
  const [locationError, setLocationError] = useState("");
  const isCritical = woundAssessment?.severity === "critical";

  useEffect(() => {
    if (isMuted) return;
    const warning = isCritical
      ? "Call an ambulance now if possible. Continue first aid while help is coming."
      : "This injury may need medical help. You can call an ambulance now.";
    speakInstruction(warning, language, { critical: isCritical });
  }, [isCritical, isMuted, language]);

  function callAmbulance() {
    window.location.href = "tel:108";
  }

  function findNearestHospital() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Location permission unavailable. Search hospital near me manually.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        window.location.href = `https://www.google.com/maps/search/hospital+near+me/@${latitude},${longitude},15z`;
      },
      () => {
        setLocationError("Location permission unavailable. Search hospital near me manually.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  return (
    <div className="screen fade-in">
      <section className="screen-header">
        <div className="eyebrow">Emergency Help</div>
        <h2>Do you want to call an ambulance now?</h2>
        <p>Emergency guidance only. Seek professional medical help as soon as possible.</p>
      </section>

      <div className="card emergency-summary">
        <Info label="Severity" value={woundAssessment?.severity} />
        <Info label="Wound Type" value={woundAssessment?.wound_type} />
        <Info label="Immediate Risk" value={woundAssessment?.immediate_risk} />
      </div>

      <button className="btn btn--danger emergency-action" onClick={callAmbulance}>
        Call Ambulance
        <span>108</span>
      </button>

      <div className="card hospital-card">
        <h3>Nearest hospital and directions</h3>
        <button className="btn btn--secondary" onClick={findNearestHospital}>
          Find Nearest Hospital
        </button>
        {locationError && <div className="alert alert--warning">{locationError}</div>}
      </div>

      <button
        className="btn btn--primary"
        onClick={() => dispatch({ type: "SET_PHASE", payload: "inventory" })}
      >
        Continue First Aid
      </button>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "Unknown"}</strong>
    </div>
  );
}
