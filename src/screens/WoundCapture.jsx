import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { triageEmergency } from "../services/gemmaService";

const RESOURCE_QUESTION =
  "What do you have available nearby? You can also send me a photo or video of the scene.";

const CPR_GUIDE_TEXT =
  "Place heel of your dominant hand on the centre of their chest. Stack your other hand on top, fingers interlaced and raised. Arms straight, lock your elbows. Push down 5-6cm - harder than you think. Release fully between compressions. Aim for 100-120 per minute.";

const statusText = {
  idle: "Tap mic or type to begin",
  listening: "Listening...",
  thinking: "ResqAI is assessing...",
  speaking: "Speaking guidance...",
  waiting: "Waiting for your response...",
  resources: "Choose what is available nearby",
  metronome: "CPR rhythm guide running",
};

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function getPreferredVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return (
    voices.find((voice) => voice.name === "Google UK English Female") ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-gb")) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-us")) ||
    null
  );
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, 800 / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8).replace(/^data:image\/jpeg;base64,/, ""));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function Waveform({ active }) {
  return (
    <div className={`voice-waveform ${active ? "voice-waveform--active" : ""}`} aria-label="Listening">
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} style={{ animationDelay: `${index * 100}ms` }} />
      ))}
    </div>
  );
}

function needsCprGuide(result) {
  const condition = String(result?.condition || "");
  const steps = (result?.steps || []).join(" ").toLowerCase();
  return condition === "cardiac_arrest" || steps.includes("compressions");
}

export default function WoundCapture() {
  const [appState, setAppState] = useState("idle");
  const [conversationPhase, setConversationPhase] = useState("initial");
  const [currentSteps, setCurrentSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [severity, setSeverity] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [typedText, setTypedText] = useState("");
  const [confirmationTranscript, setConfirmationTranscript] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [resourceQuestionVisible, setResourceQuestionVisible] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [showCprGuide, setShowCprGuide] = useState(false);
  const [metronomeRunning, setMetronomeRunning] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [imageReady, setImageReady] = useState(false);

  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(false);
  const timeoutRef = useRef(null);
  const confirmationTimerRef = useRef(null);
  const runIdRef = useRef(0);
  const stateRef = useRef("idle");
  const stepsRef = useRef([]);
  const nextQuestionRef = useRef("");
  const originalScenarioRef = useRef("");
  const inputPurposeRef = useRef("initial");
  const cprGuideRef = useRef(false);
  const thumbnailUrlRef = useRef("");
  const imageBase64Ref = useRef("");
  const confirmTranscriptRef = useRef(null);

  useEffect(() => {
    stateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    stepsRef.current = currentSteps;
  }, [currentSteps]);

  const clearAdvanceTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearConfirmationTimer = useCallback(() => {
    if (confirmationTimerRef.current) {
      window.clearTimeout(confirmationTimerRef.current);
      confirmationTimerRef.current = null;
    }
  }, []);

  const clearImage = useCallback(() => {
    if (thumbnailUrlRef.current) {
      URL.revokeObjectURL(thumbnailUrlRef.current);
      thumbnailUrlRef.current = "";
    }
    imageBase64Ref.current = "";
    setThumbnailUrl("");
    setImageReady(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const stopMetronome = useCallback(() => {
    setMetronomeRunning(false);
  }, []);

  const speakText = useCallback((text, onEnd) => {
    if (!text || !window.speechSynthesis) {
      onEnd?.();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getPreferredVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.85;
    utterance.pitch = 0.95;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
  }, []);

  const startListening = useCallback(
    (purpose = inputPurposeRef.current) => {
      const SpeechRecognition = getSpeechRecognition();
      if (!SpeechRecognition || !mountedRef.current) {
        setAppState("idle");
        return;
      }

      inputPurposeRef.current = purpose;
      clearAdvanceTimer();
      clearConfirmationTimer();
      stopMetronome();
      window.speechSynthesis?.cancel();
      recognitionRef.current?.abort?.();

      const recognition = new SpeechRecognition();
      recognition.lang = navigator.language;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => mountedRef.current && setAppState("listening");
      recognition.onresult = (event) => {
        const spokenText = event.results?.[0]?.[0]?.transcript?.trim() || "";
        if (!spokenText) return;
        setTranscript(spokenText);
        confirmTranscriptRef.current?.(spokenText);
      };
      recognition.onerror = () => {
        if (mountedRef.current && stateRef.current === "listening") setAppState("idle");
      };
      recognition.onend = () => {
        if (mountedRef.current && stateRef.current === "listening") setAppState("idle");
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        setAppState("idle");
      }
    },
    [clearAdvanceTimer, clearConfirmationTimer, stopMetronome]
  );

  const askResources = useCallback(
    (runId) => {
      if (!mountedRef.current || runId !== runIdRef.current) return;
      setConversationPhase("resources");
      setResourceQuestionVisible(true);
      setAppState("resources");
      speakText(RESOURCE_QUESTION);
    },
    [speakText]
  );

  const askFollowUp = useCallback(
    (runId) => {
      if (!mountedRef.current || runId !== runIdRef.current) return;
      const question = nextQuestionRef.current.trim() || "Is there anything else I can help with?";
      setConversationPhase("followup");
      setFollowUpQuestion(question);
      setAppState("waiting");
      speakText(question, () => {
        if (mountedRef.current && runId === runIdRef.current) startListening("followup");
      });
    },
    [speakText, startListening]
  );

  const handleStepsFinished = useCallback(
    (stage, runId) => {
      const hasCpr = cprGuideRef.current;
      const continueAfterCpr = () => {
        if (stage === "initial") {
          askResources(runId);
          return;
        }
        askFollowUp(runId);
      };

      if (hasCpr) {
        setMetronomeRunning(true);
        setAppState("metronome");
        speakText("Follow the pulse on screen. Push hard on every beat.", continueAfterCpr);
        return;
      }

      continueAfterCpr();
    },
    [askFollowUp, askResources, speakText]
  );

  const speakAndAdvance = useCallback(
    (index, stage) => {
      const runId = runIdRef.current;
      const step = stepsRef.current[index];

      if (!step || !mountedRef.current) {
        handleStepsFinished(stage, runId);
        return;
      }

      clearAdvanceTimer();
      setCurrentStepIndex(index);
      setAppState("speaking");

      speakText(step, () => {
        if (!mountedRef.current || runId !== runIdRef.current) return;
        timeoutRef.current = window.setTimeout(() => {
          if (!mountedRef.current || runId !== runIdRef.current) return;
          if (index + 1 < stepsRef.current.length) {
            speakAndAdvance(index + 1, stage);
            return;
          }
          handleStepsFinished(stage, runId);
        }, index + 1 < stepsRef.current.length ? 3500 : 2000);
      });
    },
    [clearAdvanceTimer, handleStepsFinished, speakText]
  );

  const runTriage = useCallback(
    async (message, options = {}) => {
      const stage = options.stage || "initial";
      const image = options.image;
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      clearAdvanceTimer();
      clearConfirmationTimer();
      stopMetronome();
      setShowConfirmation(false);
      setResourceQuestionVisible(false);
      setFollowUpQuestion("");
      if (stage === "initial") {
        stepsRef.current = [];
        cprGuideRef.current = false;
        setCurrentSteps([]);
        setCurrentStepIndex(0);
        setShowCprGuide(false);
        setMetronomeRunning(false);
      }
      window.speechSynthesis?.cancel();
      recognitionRef.current?.abort?.();
      setAppState("thinking");

      try {
        const result = await triageEmergency(message, image);
        if (!mountedRef.current || runId !== runIdRef.current) return;

        if (image) clearImage();

        const steps = result.steps || [];
        nextQuestionRef.current = result.next_question || "";
        setSeverity(result.severity);

        if (stage === "initial") {
          setConversationPhase("resources");
          const askAfterClassification = () => askResources(runId);
          if (result.warn_message) {
            speakText(result.warn_message, askAfterClassification);
          } else {
            askAfterClassification();
          }
          return;
        }

        stepsRef.current = steps;
        setCurrentSteps(steps);
        setCurrentStepIndex(0);
        setConversationPhase("refined_steps");
        const shouldShowCprGuide = needsCprGuide(result);
        cprGuideRef.current = shouldShowCprGuide;
        setShowCprGuide(shouldShowCprGuide);

        const beginSteps = () => {
          if (!mountedRef.current || runId !== runIdRef.current) return;
          speakAndAdvance(0, stage);
        };

        if (result.warn_message) {
          speakText(result.warn_message, beginSteps);
        } else {
          beginSteps();
        }
      } catch {
        if (image) clearImage();
        if (mountedRef.current && runId === runIdRef.current) {
          setAppState("waiting");
          startListening(inputPurposeRef.current);
        }
      }
    },
    [askResources, clearAdvanceTimer, clearConfirmationTimer, clearImage, speakAndAdvance, speakText, startListening, stopMetronome]
  );

  const proceedWithTranscript = useCallback(
    (heardText) => {
      const purpose = inputPurposeRef.current;
      if (purpose === "resources") {
        runTriage(
          `Original emergency: ${originalScenarioRef.current}. Available resources: ${heardText}. Adjust steps based on what they have.`,
          { stage: "refined" }
        );
        return;
      }

      if (purpose === "followup") {
        runTriage(`Original emergency: ${originalScenarioRef.current}. Additional info: ${heardText}`, {
          stage: "refined",
        });
        return;
      }

      originalScenarioRef.current = heardText;
      runTriage(heardText, { stage: "initial", image: imageBase64Ref.current || undefined });
    },
    [runTriage]
  );

  const confirmTranscript = useCallback(
    (heardText) => {
      clearConfirmationTimer();
      setConfirmationTranscript(heardText);
      setShowConfirmation(true);
      speakText(`I heard: ${heardText}. Starting assessment.`);
      confirmationTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setShowConfirmation(false);
        proceedWithTranscript(heardText);
      }, 3000);
    },
    [clearConfirmationTimer, proceedWithTranscript, speakText]
  );

  useEffect(() => {
    confirmTranscriptRef.current = confirmTranscript;
  }, [confirmTranscript]);

  const restartForCorrection = () => {
    clearConfirmationTimer();
    setShowConfirmation(false);
    setConfirmationTranscript("");
    startListening(inputPurposeRef.current);
  };

  const handleTypedSubmit = () => {
    const text = typedText.trim();
    if (!text) return;
    if (conversationPhase === "resources") {
      inputPurposeRef.current = "resources";
    } else if (conversationPhase === "followup") {
      inputPurposeRef.current = "followup";
    }
    setTypedText("");
    setTranscript(text);
    confirmTranscript(text);
  };

  const handleDescribeResources = () => {
    inputPurposeRef.current = "resources";
    startListening("resources");
  };

  const handleNothingAvailable = () => {
    runTriage(
      `Original emergency: ${originalScenarioRef.current}. No medical supplies available. Give steps using only hands and no equipment.`,
      { stage: "refined" }
    );
  };

  const handleResourcePhotoSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    console.log("ResqAI camera file selected:", file.name, file.type, file.size);

    clearImage();
    const objectUrl = URL.createObjectURL(file);
    thumbnailUrlRef.current = objectUrl;
    setThumbnailUrl(objectUrl);
    setImageReady(true);

    try {
      const image = await compressImage(file);
      if (!mountedRef.current) return;
      imageBase64Ref.current = image;
      setImageReady(false);
      runTriage(
        "Here is the emergency scene. Refine guidance based on what you can see and what supplies are visible.",
        { stage: "refined", image }
      );
    } catch {
      clearImage();
    }
  };

  const openCamera = () => {
    document.getElementById("camera-input")?.click();
  };

  const toggleListening = () => {
    if (appState === "listening") {
      recognitionRef.current?.stop?.();
      setAppState("idle");
      return;
    }
    startListening(inputPurposeRef.current);
  };

  const replayFromStep = (index) => {
    runIdRef.current += 1;
    stopMetronome();
    speakText(currentSteps[index]);
    setCurrentStepIndex(index);
  };

  useEffect(() => {
    mountedRef.current = true;
    window.speechSynthesis?.getVoices?.();
    window.speechSynthesis?.addEventListener?.("voiceschanged", getPreferredVoice);
    startListening("initial");

    return () => {
      mountedRef.current = false;
      clearAdvanceTimer();
      clearConfirmationTimer();
      clearImage();
      recognitionRef.current?.abort?.();
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.removeEventListener?.("voiceschanged", getPreferredVoice);
    };
  }, [clearAdvanceTimer, clearConfirmationTimer, clearImage, startListening]);

  const visibleStatus =
    appState === "speaking"
      ? `Speaking step ${currentStepIndex + 1} of ${currentSteps.length}`
      : appState === "listening" && inputPurposeRef.current === "followup"
      ? "Listening for your answer..."
      : imageReady
      ? "📷 Image ready - speak to analyze"
      : statusText[appState] || statusText.waiting;

  return (
    <div className="screen fade-in">
      <section className="screen-header">
        <div className="eyebrow">Triage</div>
        <h2>Tell ResqAI what happened</h2>
        <p>{transcript || "Speak naturally, or type below. ResqAI will guide you step by step."}</p>
      </section>

      {showConfirmation && (
        <div className="card" style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <strong style={{ lineHeight: 1.4 }}>I heard: {confirmationTranscript}</strong>
          <button type="button" className="btn btn--secondary" onClick={restartForCorrection}>
            That's wrong - re-speak
          </button>
        </div>
      )}

      {severity && <div className={`badge badge--${severity === "critical" ? "red" : "amber"}`}>{severity}</div>}

      <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 12, padding: "16px 0" }}>
        {currentSteps.map((step, index) => (
          <button
            key={`${step}-${index}`}
            className="step-card"
            onClick={() => replayFromStep(index)}
            style={{
              cursor: "pointer",
              opacity: index < currentStepIndex ? 0.6 : 1,
              borderColor: index === currentStepIndex && appState === "speaking" ? "var(--red-alert)" : undefined,
            }}
          >
            <span className="eyebrow">{index + 1}</span>
            <span className="step-action">{step}</span>
          </button>
        ))}

        {showCprGuide && (
          <div className="card cpr-guide">
            <h3>CPR Rhythm Guide</h3>
            <p>{CPR_GUIDE_TEXT}</p>
            <button
              type="button"
              className={`cpr-metronome ${metronomeRunning ? "cpr-metronome--active" : ""}`}
              onClick={stopMetronome}
              aria-label="Stop CPR metronome"
            />
            <strong className={`cpr-beat-text ${metronomeRunning ? "cpr-beat-text--active" : ""}`}>
              Push. Release. Push. Release.
            </strong>
          </div>
        )}

        {resourceQuestionVisible && (
          <div className="card" style={{ display: "grid", gap: 12, background: "#F0F4FF" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 800 }}>ResqAI asks:</span>
            <strong style={{ lineHeight: 1.45 }}>{RESOURCE_QUESTION}</strong>
            <div style={{ display: "grid", gap: 10 }}>
              <button type="button" className="btn btn--secondary" onClick={openCamera}>
                📷 Take Photo
              </button>
              <button type="button" className="btn btn--secondary" onClick={handleDescribeResources}>
                🎤 Describe
              </button>
              <button type="button" className="btn btn--secondary" onClick={handleNothingAvailable}>
                ✓ Nothing available
              </button>
            </div>
          </div>
        )}

        {followUpQuestion && (
          <div className="card" style={{ display: "grid", gap: 6, background: "#F0F4FF" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 800 }}>ResqAI asks:</span>
            <strong style={{ lineHeight: 1.45 }}>{followUpQuestion}</strong>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <textarea
          value={typedText}
          onChange={(event) => setTypedText(event.target.value)}
          placeholder={
            conversationPhase === "resources"
              ? "Type what you have nearby..."
              : "Type what happened..."
          }
          rows={2}
        />
        <button type="button" className="btn btn--secondary" onClick={handleTypedSubmit}>
          Send typed message
        </button>
      </div>

      <div style={{ display: "grid", justifyItems: "center", gap: 14, paddingBottom: 24 }}>
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt="Selected emergency scene"
            style={{
              width: 56,
              height: 56,
              borderRadius: 8,
              objectFit: "cover",
              border: "1px solid var(--border)",
            }}
          />
        )}
        {appState === "listening" ? <Waveform active /> : <Waveform />}
        {appState !== "listening" && <div className="badge">{visibleStatus}</div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <input
            id="camera-input"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleResourcePhotoSelected}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={openCamera}
            aria-label="Take photo"
            style={{
              width: 48,
              height: 48,
              minHeight: 48,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "#ffffff",
              color: "#111111",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Camera size={22} strokeWidth={2.2} />
          </button>
          <button
            className="btn btn--danger"
            onClick={toggleListening}
            aria-label={appState === "listening" ? "Stop listening" : "Start listening"}
            style={{ width: 64, height: 64, minHeight: 64, borderRadius: "50%", padding: 0 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
              <path d="M5 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
