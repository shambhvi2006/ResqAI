import { createContext, useContext, useReducer } from "react";

const initialSession = {
  language: "en",
  emergencyType: null,
  startTime: null,
  woundAssessment: null,
  inventory: [],
  protocol: null,
  currentStepIndex: 0,
  stepHistory: [],
  failureCount: 0,
  phase: "selection",
  isLoading: false,
  error: null,
  isMuted: false,
  incidentReport: null,
};

function sessionReducer(state, action) {
  switch (action.type) {
    case "SET_LANGUAGE":
      return { ...state, language: action.payload };
    case "SET_EMERGENCY":
      return { ...state, emergencyType: action.payload, startTime: Date.now() };
    case "SET_WOUND":
      return { ...state, woundAssessment: action.payload };
    case "SET_INVENTORY":
      return { ...state, inventory: action.payload };
    case "SET_PROTOCOL":
      return { ...state, protocol: action.payload, currentStepIndex: 0, failureCount: 0 };
    case "NEXT_STEP":
      if (!state.protocol?.steps?.[state.currentStepIndex]) return state;
      return {
        ...state,
        stepHistory: [
          ...state.stepHistory,
          { step: state.protocol.steps[state.currentStepIndex], completed: true, timestamp: Date.now() },
        ],
        currentStepIndex: state.currentStepIndex + 1,
        failureCount: 0,
      };
    case "STEP_FAILED":
      if (!state.protocol?.steps?.[state.currentStepIndex]) {
        return { ...state, failureCount: state.failureCount + 1 };
      }
      return {
        ...state,
        stepHistory: [
          ...state.stepHistory,
          { step: state.protocol.steps[state.currentStepIndex], completed: false, timestamp: Date.now() },
        ],
        failureCount: state.failureCount + 1,
      };
    case "REPLACE_CURRENT_STEP": {
      if (!state.protocol?.steps?.length) return state;
      const newSteps = [...state.protocol.steps];
      newSteps[state.currentStepIndex] = action.payload;
      return { ...state, protocol: { ...state.protocol, steps: newSteps }, failureCount: state.failureCount + 1 };
    }
    case "SET_REPORT":
      return { ...state, incidentReport: action.payload };
    case "SET_PHASE":
      return { ...state, phase: action.payload };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload, isLoading: false };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "TOGGLE_MUTE":
      return { ...state, isMuted: !state.isMuted };
    case "RESET_SESSION":
    case "RESET":
      return { ...initialSession };
    default:
      return state;
  }
}

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, dispatch] = useReducer(sessionReducer, initialSession);

  return (
    <SessionContext.Provider value={{ ...session, session, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
