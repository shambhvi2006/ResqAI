import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "../context/SessionContext.jsx";
import { assessWound } from "../lib/gemmaClient.js";

const PROMPTS = {
  en: {
    title: "Show Your Wound",
    subtitle: "Position the injury within the frame, then capture or describe it",
    capture: "Capture Photo",
    retake: "Retake",
    analyse: "Analyse Wound",
    orDescribe: "Or describe the wound",
    placeholder: "e.g. Deep cut on left palm, about 4cm long, bleeding actively...",
    analysing: "Analysing...",
    hint: "Make sure the wound is well-lit and in focus",
  },
  hi: {
    title: "घाव दिखाएं",
    subtitle: "चोट को फ्रेम में रखें, फिर कैप्चर करें या बताएं",
    capture: "फोटो लें",
    retake: "दोबारा लें",
    analyse: "घाव का विश्लेषण करें",
    orDescribe: "या घाव का वर्णन करें",
    placeholder: "जैसे: बाएं हाथ की हथेली पर गहरा कट, लगभग 4 सेमी लंबा, खून बह रहा है...",
    analysing: "विश्लेषण हो रहा है...",
    hint: "सुनिश्चित करें कि घाव अच्छी रोशनी में हो",
  },
  pa: {
    title: "ਜ਼ਖ਼ਮ ਦਿਖਾਓ",
    subtitle: "ਸੱਟ ਨੂੰ ਫ਼੍ਰੇਮ ਵਿੱਚ ਰੱਖੋ, ਫਿਰ ਕੈਪਚਰ ਕਰੋ ਜਾਂ ਦੱਸੋ",
    capture: "ਫੋਟੋ ਖਿੱਚੋ",
    retake: "ਦੁਬਾਰਾ ਖਿੱਚੋ",
    analyse: "ਜ਼ਖ਼ਮ ਦਾ ਵਿਸ਼ਲੇਸ਼ਣ ਕਰੋ",
    orDescribe: "ਜਾਂ ਜ਼ਖ਼ਮ ਦਾ ਵਰਣਨ ਕਰੋ",
    placeholder: "ਜਿਵੇਂ: ਖੱਬੀ ਹਥੇਲੀ 'ਤੇ ਡੂੰਘਾ ਕੱਟ, ਲਗਭਗ 4 ਸੈਮੀ ਲੰਮਾ...",
    analysing: "ਵਿਸ਼ਲੇਸ਼ਣ ਹੋ ਰਿਹਾ ਹੈ...",
    hint: "ਯਕੀਨੀ ਕਰੋ ਕਿ ਜ਼ਖ਼ਮ ਚੰਗੀ ਰੋਸ਼ਨੀ ਵਿੱਚ ਹੋਵੇ",
  },
};

function getLang(code) {
  return PROMPTS[code] || PROMPTS.en;
}

export default function WoundCapture() {
  const { language, dispatch } = useSession();
  const t = getLang(language);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [mode, setMode] = useState("camera"); // "camera" | "captured" | "text"
  const [capturedImage, setCapturedImage] = useState(null); // base64
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [listening, setListening] = useState(false);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch {
      setMode("text");
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startCamera]);

  // Capture frame
  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    setCapturedImage(base64);
    setMode("captured");
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const retake = () => {
    setCapturedImage(null);
    setMode("camera");
    startCamera();
  };

  // Voice input
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = language === "hi" ? "hi-IN" : language === "pa" ? "hi-IN" : "en-IN";
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (e) => {
      setDescription((prev) => prev + " " + e.results[0][0].transcript);
    };
    recognition.start();
  };

  // Submit
  const handleAnalyse = async () => {
    if (!capturedImage && !description.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const result = await assessWound({
        imageBase64: capturedImage,
        description: description.trim(),
        language,
      });

      dispatch({
        type: "SET_WOUND",
        payload: { ...result, imageBase64: capturedImage, description },
      });

      const nextPhase = ["serious", "critical"].includes(result.severity)
        ? "emergencyHelp"
        : "inventory";
      dispatch({ type: "SET_PHASE", payload: nextPhase });
    } catch (err) {
      setError(err.message || "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = (capturedImage || description.trim().length > 10) && !loading;

  return (
    <div className="screen fade-in">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header */}
      <div style={{ paddingTop: 24, paddingBottom: 20 }}>
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}>
          Step 1 of 4
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 6 }}>
          {t.title}
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
          {t.subtitle}
        </p>
      </div>

      {/* Camera / captured image */}
      {mode !== "text" && (
        <div style={{ marginBottom: 16 }}>
          <div className="camera-wrap">
            {mode === "camera" && (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div className="camera-overlay">
                  <div className="camera-crosshair" />
                </div>
                {!cameraReady && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--bg-card)",
                  }}>
                    <div className="spinner" />
                  </div>
                )}
              </>
            )}

            {mode === "captured" && capturedImage && (
              <img src={`data:image/jpeg;base64,${capturedImage}`} alt="Wound" />
            )}
          </div>

          {/* Hint */}
          {mode === "camera" && (
            <p style={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 8,
              fontFamily: "var(--font-mono)",
            }}>
              {t.hint}
            </p>
          )}

          {/* Camera controls */}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {mode === "camera" && (
              <button className="btn btn--primary" onClick={capturePhoto} disabled={!cameraReady}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M6.5 2h5l1.5 2h2A1.5 1.5 0 0117 5.5v9A1.5 1.5 0 0115.5 16h-13A1.5 1.5 0 011 14.5v-9A1.5 1.5 0 012.5 4h2L6.5 2z"
                    stroke="currentColor" strokeWidth="1.5" />
                </svg>
                {t.capture}
              </button>
            )}
            {mode === "captured" && (
              <button className="btn btn--secondary" onClick={retake} style={{ flex: "0 0 auto", width: "auto", padding: "16px 20px" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8a6 6 0 106-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M2 4v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t.retake}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {t.orDescribe}
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {/* Text description */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t.placeholder}
          rows={4}
          style={{
            width: "100%",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            fontSize: 14,
            fontFamily: "var(--font-sans)",
            padding: "14px 48px 14px 14px",
            lineHeight: 1.6,
            resize: "none",
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "var(--green-primary)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
        />
        {/* Voice button */}
        <button
          onClick={startVoice}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 32,
            height: 32,
            borderRadius: 8,
            background: listening ? "var(--green-subtle)" : "var(--bg-elevated)",
            border: listening ? "1px solid var(--green-primary)" : "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: listening ? "var(--green-primary)" : "var(--text-secondary)",
            transition: "all 0.2s",
          }}
          title="Voice input"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="4.5" y="1" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2 6.5a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M7 11.5v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: "12px 14px",
          borderRadius: "var(--radius-sm)",
          background: "var(--red-glow)",
          border: "1px solid rgba(239,68,68,0.2)",
          color: "var(--red-alert)",
          fontSize: 13,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        className="btn btn--primary"
        onClick={handleAnalyse}
        disabled={!canSubmit}
        style={{ marginBottom: 32 }}
      >
        {loading ? (
          <>
            <div className="spinner" style={{ borderTopColor: "#0a0f0d", borderColor: "rgba(0,0,0,0.2)" }} />
            {t.analysing}
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 1l2.5 5.5H17l-4.5 3.5 1.5 5.5L9 13l-5 2.5 1.5-5.5L1 6.5h5.5L9 1z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            {t.analyse}
          </>
        )}
      </button>
    </div>
  );
}
