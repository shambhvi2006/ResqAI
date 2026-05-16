import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useSession } from "../context/SessionContext.jsx";
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
  confirming: "Confirm what ResqAI heard",
  waiting: "Waiting for your response...",
  "mic-denied": "Microphone access denied",
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

function sanitizeBareHandsSteps(steps) {
  return steps.map((step) => {
    const text = String(step || "");
    if (!/(cloth|gauze|bandage|dressing|suppl|medical item|sterile|pad)/i.test(text)) {
      return text;
    }

    if (/press|pressure|bleed|blood|wound/i.test(text)) {
      return "Press directly with your bare hand.";
    }

    if (/cover|wrap|protect/i.test(text)) {
      return "Keep your bare hand over the injury.";
    }

    if (/clean|rinse|wash/i.test(text)) {
      return "Do not search for supplies.";
    }

    return "Continue using only bare hands.";
  });
}

function isTranscriptTriageable(text) {
  const cleaned = text?.trim().toLowerCase();

  if (!cleaned || cleaned.length < 8) return false;

  const emergencyKeywords = [
    "cut",
    "bleeding",
    "blood",
    "wound",
    "burn",
    "fracture",
    "broken",
    "pain",
    "injury",
    "hurt",
    "fell",
    "fall",
    "unconscious",
    "not breathing",
    "choking",
    "chest pain",
    "accident",
    "crash",
    "swelling",
    "sprain",
    "head",
    "arm",
    "leg",
    "hand",
    "finger",
    "foot",
    "face",
  ];

  return emergencyKeywords.some((word) => cleaned.includes(word));
}

export default function WoundCapture() {
  const { emergencyType } = useSession();
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
  const [availableResources, setAvailableResources] = useState("");
  const [transcriptError, setTranscriptError] = useState("");
  const [showMicFallback, setShowMicFallback] = useState(false);
  const [micFallbackText, setMicFallbackText] = useState("");

  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(false);
  const timeoutRef = useRef(null);
  const confirmationTimerRef = useRef(null);
  const listeningFallbackTimerRef = useRef(null);
  const recognitionStartTimerRef = useRef(null);
  const hasProcessedRef = useRef(false);
  const runIdRef = useRef(0);
  const stateRef = useRef("idle");
  const stepsRef = useRef([]);
  const nextQuestionRef = useRef("");
  const originalScenarioRef = useRef("");
  const inputPurposeRef = useRef("initial");
  const cprGuideRef = useRef(false);
  const availableResourcesRef = useRef("");
  const thumbnailUrlRef = useRef("");
  const imageBase64Ref = useRef("");
  const confirmTranscriptRef = useRef(null);

  useEffect(() => {
    stateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    stepsRef.current = currentSteps;
  }, [currentSteps]);

  useEffect(() => {
    availableResourcesRef.current = availableResources;
  }, [availableResources]);

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

  const clearListeningFallbackTimer = useCallback(() => {
    if (listeningFallbackTimerRef.current) {
      window.clearTimeout(listeningFallbackTimerRef.current);
      listeningFallbackTimerRef.current = null;
    }
  }, []);

  const clearRecognitionStartTimer = useCallback(() => {
    if (recognitionStartTimerRef.current) {
      window.clearTimeout(recognitionStartTimerRef.current);
      recognitionStartTimerRef.current = null;
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
      clearListeningFallbackTimer();
      clearRecognitionStartTimer();
      stopMetronome();
      window.speechSynthesis?.cancel();
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      }
      hasProcessedRef.current = false;
      setShowMicFallback(false);
      setMicFallbackText("");
      setAppState("listening");

      listeningFallbackTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current && stateRef.current === "listening" && !hasProcessedRef.current) {
          setShowMicFallback(true);
        }
      }, 8000);

      recognitionStartTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current || stateRef.current !== "listening") return;

        const recognition = new SpeechRecognition();
        recognition.lang = navigator.language || "en-GB";
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
          if (hasProcessedRef.current) return;
          if (!event.results?.[0]?.isFinal) return;
          const spokenText = event.results[0][0].transcript;
          if (!spokenText || spokenText.trim().length < 2) return;
          hasProcessedRef.current = true;
          clearListeningFallbackTimer();
          setShowMicFallback(false);
          window.speechSynthesis?.cancel();
          recognition.abort();
          setTranscript(spokenText);
          setAppState("confirming");
          confirmTranscriptRef.current?.(spokenText);
        };

        recognition.onerror = (event) => {
          if (event.error === "no-speech") {
            if (mountedRef.current && stateRef.current === "listening" && !hasProcessedRef.current) {
              recognition.onend = null;
              startListening(inputPurposeRef.current);
            }
            return;
          }
          if (event.error === "not-allowed") {
            clearListeningFallbackTimer();
            setShowMicFallback(false);
            setAppState("mic-denied");
            return;
          }
          console.log("Speech error:", event.error);
        };

        recognition.onend = () => {
          if (mountedRef.current && stateRef.current === "listening" && !hasProcessedRef.current) {
            startListening(inputPurposeRef.current);
          }
        };

        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          setAppState("idle");
        }
      }, 800);
    },
    [
      clearAdvanceTimer,
      clearConfirmationTimer,
      clearListeningFallbackTimer,
      clearRecognitionStartTimer,
      stopMetronome,
    ]
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
      const resourceContext = options.availableResources ?? availableResourcesRef.current;
      const preStepMessage = options.preStepMessage;
      const bareHandsOnly = options.bareHandsOnly || /nothing|no supplies|bare hands only/i.test(resourceContext);
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      clearAdvanceTimer();
      clearConfirmationTimer();
      stopMetronome();
      setShowConfirmation(false);
      setTranscriptError("");
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
        const result = await triageEmergency(message, image, stage === "initial" ? undefined : resourceContext);
        if (!mountedRef.current || runId !== runIdRef.current) return;

        if (image) clearImage();

        const steps = bareHandsOnly ? sanitizeBareHandsSteps(result.steps || []) : result.steps || [];
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

        if (preStepMessage) {
          speakText(preStepMessage, beginSteps);
          return;
        }

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
        setAvailableResources(heardText);
        availableResourcesRef.current = heardText;
        runTriage(
          `Original emergency: ${originalScenarioRef.current}. Available resources: ${heardText}. Adjust steps based on what they have.`,
          { stage: "refined", availableResources: heardText }
        );
        return;
      }

      if (purpose === "followup") {
        runTriage(`Original emergency: ${originalScenarioRef.current}. Additional info: ${heardText}`, {
          stage: "refined",
          availableResources: availableResourcesRef.current,
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
      recognitionRef.current?.stop?.();
      clearConfirmationTimer();
      window.speechSynthesis?.cancel();
      const cleanedText = heardText?.trim() || "";
      const requiresEmergencyDescription = inputPurposeRef.current === "initial";

      if (requiresEmergencyDescription && !isTranscriptTriageable(cleanedText)) {
        setConfirmationTranscript("");
        setShowConfirmation(false);
        setTranscriptError("Please describe the emergency or injury with a little more detail.");
        setAppState("waiting");
        speakText("Please describe the emergency or injury with a little more detail.", () => {
          if (mountedRef.current) startListening("initial");
        });
        return;
      }

      setTranscriptError("");
      setConfirmationTranscript(cleanedText);
      setShowConfirmation(true);
      setAppState("confirming");
      speakText(`I heard: ${cleanedText}. Tap confirm or say again.`);
    },
    [clearConfirmationTimer, speakText, startListening]
  );

  useEffect(() => {
    confirmTranscriptRef.current = confirmTranscript;
  }, [confirmTranscript]);

  const acceptConfirmation = () => {
    clearConfirmationTimer();
    const heardText = confirmationTranscript;
    setShowConfirmation(false);
    proceedWithTranscript(heardText);
  };

  const restartForCorrection = () => {
    clearConfirmationTimer();
    setShowConfirmation(false);
    setConfirmationTranscript("");
    setTranscriptError("");
    recognitionRef.current?.abort?.();
    speakText("Please describe the emergency again", () => {
      if (mountedRef.current) startListening(inputPurposeRef.current);
    });
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

  const handleMicFallbackSubmit = () => {
    const text = micFallbackText.trim();
    if (!text) return;
    hasProcessedRef.current = true;
    clearListeningFallbackTimer();
    recognitionRef.current?.abort?.();
    setShowMicFallback(false);
    setMicFallbackText("");
    setTranscript(text);
    setAppState("confirming");
    confirmTranscript(text);
  };

  const handleDescribeResources = () => {
    inputPurposeRef.current = "resources";
    startListening("resources");
  };

  const handleNothingAvailable = () => {
    const resources = "absolutely nothing available, no medical supplies, no cloth, no bandages, bare hands only";
    const message = `Original emergency: ${originalScenarioRef.current}. The person has NO supplies available at all — no cloth, no gauze, no bandages, nothing. Rewrite all steps using ONLY bare hands. Do not mention cloth, gauze, dressings, or any supplies in any step.`;
    setAvailableResources(resources);
    availableResourcesRef.current = resources;
    stepsRef.current = [];
    setCurrentSteps([]);
    setCurrentStepIndex(0);
    setShowCprGuide(false);
    cprGuideRef.current = false;
    runTriage(
      message,
      {
        stage: "refined",
        availableResources: resources,
        preStepMessage: "Adapting instructions for no supplies available",
        bareHandsOnly: true,
      }
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
      const resources = "photo or video of the emergency scene and visible supplies";
      setAvailableResources(resources);
      availableResourcesRef.current = resources;
      imageBase64Ref.current = image;
      setImageReady(false);
      runTriage(
        "Here is the emergency scene. Refine guidance based on what you can see and what supplies are visible.",
        { stage: "refined", image, availableResources: resources }
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
    const micRequest = navigator.mediaDevices?.getUserMedia?.({ audio: true });

    if (!micRequest) {
      setAppState("mic-denied");
      return () => {
        mountedRef.current = false;
        clearAdvanceTimer();
        clearConfirmationTimer();
        clearListeningFallbackTimer();
        clearRecognitionStartTimer();
        clearImage();
        recognitionRef.current?.abort?.();
        window.speechSynthesis?.cancel();
        window.speechSynthesis?.removeEventListener?.("voiceschanged", getPreferredVoice);
      };
    }

    micRequest
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        if (!mountedRef.current) return;
        if (emergencyType === "not_sure") {
          speakText("Describe what you can see happening and I will assess it", () => {
            if (mountedRef.current) startListening("initial");
          });
        } else {
          startListening("initial");
        }
      })
      .catch(() => {
        if (mountedRef.current) setAppState("mic-denied");
      });

    return () => {
      mountedRef.current = false;
      clearAdvanceTimer();
      clearConfirmationTimer();
      clearListeningFallbackTimer();
      clearRecognitionStartTimer();
      clearImage();
      recognitionRef.current?.abort?.();
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.removeEventListener?.("voiceschanged", getPreferredVoice);
    };
  }, [
    clearAdvanceTimer,
    clearConfirmationTimer,
    clearImage,
    clearListeningFallbackTimer,
    clearRecognitionStartTimer,
    emergencyType,
    speakText,
    startListening,
  ]);

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
        <div className="confirmation-card">
          <div>
            <span>I heard:</span>
            <strong>{confirmationTranscript}</strong>
          </div>
          <div className="confirmation-actions">
            <button type="button" className="confirmation-button confirmation-button--yes" onClick={acceptConfirmation}>
              ✓ Yes, that's right
            </button>
            <button type="button" className="confirmation-button confirmation-button--redo" onClick={restartForCorrection}>
              ↺ Re-record
            </button>
          </div>
        </div>
      )}

      {transcriptError && (
        <div className="alert alert--warning" style={{ marginBottom: 12 }}>
          {transcriptError}
        </div>
      )}

      {appState === "mic-denied" && (
        <div className="card" style={{ display: "grid", gap: 12, marginBottom: 12 }}>
          <strong>Microphone access denied.</strong>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Please allow microphone access in your browser settings and refresh the page.
          </p>
          <button type="button" className="btn btn--secondary" onClick={() => window.location.reload()}>
            Refresh page
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
        {showMicFallback && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, width: "100%" }}>
            <input
              className="text-input"
              value={micFallbackText}
              onChange={(event) => setMicFallbackText(event.target.value)}
              placeholder="Type here if mic isn't working"
            />
            <button type="button" className="btn btn--secondary compact-btn" onClick={handleMicFallbackSubmit}>
              Send
            </button>
          </div>
        )}
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
