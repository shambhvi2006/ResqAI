import { useState } from "react";
import { HelpCircle, MessageSquare } from "lucide-react";
import { useSession } from "../context/SessionContext.jsx";

const LANGUAGES = [
  { code: "en", label: "English", native: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi", native: "हिंदी", flag: "🇮🇳" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ", flag: "🇮🇳" },
  { code: "bn", label: "Bengali", native: "বাংলা", flag: "🇮🇳" },
  { code: "ta", label: "Tamil", native: "தமிழ்", flag: "🇮🇳" },
  { code: "te", label: "Telugu", native: "తెలుగు", flag: "🇮🇳" },
];

const EMERGENCIES = [
  { value: "bleeding", label: "Bleeding" },
  { value: "burns", label: "Burns" },
  { value: "fracture", label: "Fracture" },
  { value: "choking", label: "Choking" },
  { value: "unconscious", label: "Unconscious" },
  { value: "poisoning", label: "Poisoning" },
  { value: "cardiac", label: "Cardiac" },
  { value: "other_describe", label: "Other / Describe", icon: MessageSquare, immediate: true },
  { value: "not_sure", label: "Not sure", icon: HelpCircle, immediate: true },
];

export default function LanguageSelect() {
  const { dispatch } = useSession();
  const [selected, setSelected] = useState("en");
  const [selectedEmergency, setSelectedEmergency] = useState("bleeding");

  const handleStart = () => {
    dispatch({ type: "SET_LANGUAGE", payload: selected });
    dispatch({ type: "SET_EMERGENCY", payload: selectedEmergency });
    dispatch({ type: "SET_PHASE", payload: "wound" });
  };

  const handleEmergencyTap = (emergency) => {
    if (!emergency.immediate) {
      setSelectedEmergency(emergency.value);
      return;
    }

    dispatch({ type: "SET_LANGUAGE", payload: selected });
    dispatch({
      type: "SET_EMERGENCY",
      payload: emergency.value === "other_describe" ? null : emergency.value,
    });
    dispatch({ type: "SET_PHASE", payload: "wound" });
  };

  return (
    <div className="screen fade-in" style={{ paddingTop: 0 }}>
      {/* Hero section */}
      <div style={{ paddingTop: 48, paddingBottom: 32, textAlign: "center" }}>
        {/* Logo mark */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: 12,
          background: "#ffffff",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
          boxShadow: "var(--shadow-card)",
        }}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path d="M18 4C10.27 4 4 10.27 4 18s6.27 14 14 14 14-6.27 14-14S25.73 4 18 4z"
              stroke="#111111" strokeWidth="1.5" fill="none" />
            <path d="M18 10v16M10 18h16" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.15em",
          color: "var(--green-primary)",
          textTransform: "uppercase",
          marginBottom: 10,
        }}>
          Emergency First Aid
        </div>

        <h1 style={{
          fontSize: 36,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          marginBottom: 12,
          color: "var(--text-primary)",
        }}>
          ResQ<span style={{ color: "var(--green-primary)" }}>AI</span>
        </h1>

        <p style={{
          color: "var(--text-secondary)",
          fontSize: 15,
          lineHeight: 1.6,
          maxWidth: 280,
          margin: "0 auto",
        }}>
          Offline wound assessment & step-by-step treatment — works without internet
        </p>
      </div>

      {/* Offline badge */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 36 }}>
        <span className="badge badge--green">
          <span className="pulse-dot" />
          Works Offline
        </span>
        <span className="badge badge--green">
          AI-Powered
        </span>
      </div>

      {/* Language picker */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          marginBottom: 14,
        }}>
          Select Language / भाषा चुनें
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => setSelected(lang.code)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: "var(--radius-sm)",
                border: selected === lang.code
                  ? "1px solid var(--green-primary)"
                  : "1px solid var(--border)",
                background: selected === lang.code
                  ? "var(--green-subtle)"
                  : "var(--bg-secondary)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ fontSize: 20 }}>{lang.flag}</span>
              <div style={{ textAlign: "left" }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: selected === lang.code ? "var(--green-primary)" : "var(--text-primary)",
                  lineHeight: 1.2,
                }}>
                  {lang.native}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang.label}</div>
              </div>
              {selected === lang.code && (
                <svg style={{ marginLeft: "auto" }} width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l3.5 3.5L13 4.5" stroke="#111111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Emergency picker */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          marginBottom: 14,
        }}>
          Emergency Type
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {EMERGENCIES.map((emergency) => (
            <button
              key={emergency.value}
              onClick={() => handleEmergencyTap(emergency)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minHeight: 56,
                padding: "14px 12px",
                borderRadius: "var(--radius-sm)",
                border: !emergency.immediate && selectedEmergency === emergency.value
                  ? "1px solid var(--green-primary)"
                  : "1px solid var(--border)",
                background: !emergency.immediate && selectedEmergency === emergency.value
                  ? "var(--green-subtle)"
                  : "var(--bg-secondary)",
                color: !emergency.immediate && selectedEmergency === emergency.value
                  ? "var(--green-primary)"
                  : "var(--text-primary)",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s ease",
              }}
            >
              {emergency.icon && <emergency.icon size={18} strokeWidth={2.2} />}
              {emergency.label}
            </button>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{
        display: "flex",
        gap: 10,
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        background: "#ffffff",
        border: "1px solid var(--border)",
        marginBottom: 24,
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M8 1.5L14.5 13H1.5L8 1.5z" stroke="#111111" strokeWidth="1.5" />
          <path d="M8 6v3.5M8 11v.5" stroke="#111111" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p style={{ fontSize: 12, color: "var(--amber-warn)", lineHeight: 1.5 }}>
          <strong>Not a substitute for medical care.</strong> For severe injuries, call emergency services immediately.
        </p>
      </div>

      {/* CTA */}
      <button className="btn btn--primary" onClick={handleStart} style={{ marginBottom: 12 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2C5.13 2 2 5.13 2 9s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 5v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Start Assessment
      </button>

      <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", paddingBottom: 32 }}>
        Powered by Gemma 4 · Runs on-device
      </p>
    </div>
  );
}
