import { useSession } from "./context/SessionContext.jsx";
import LanguageSelect from "./screens/LanguageSelect.jsx";
import WoundCapture from "./screens/WoundCapture.jsx";
import InventoryScan from "./screens/InventoryScan.jsx";
import ProtocolDisplay from "./screens/ProtocolDisplay.jsx";
import HospitalReport from "./screens/HospitalReport.jsx";
import EmergencyHelp from "./screens/EmergencyHelp.jsx";

function AppHeader() {
  const isLocal = import.meta.env.VITE_GEMMA_MODE === "local";
  return (
    <header className="app-header">
      <strong>ResQ<span>AI</span></strong>
      {isLocal && <span className="badge badge--green">Local Mode</span>}
    </header>
  );
}

const PHASES = ["selection", "wound", "inventory", "protocol", "report"];

function StepBar({ current }) {
  const progressPhase = current === "emergencyHelp" ? "wound" : current;
  const idx = PHASES.indexOf(progressPhase);
  return (
    <div className="step-bar">
      {PHASES.slice(1).map((phase, index) => (
        <div
          key={phase}
          className={`step-bar__item ${
            index < idx - 1
              ? "step-bar__item--done"
              : index === idx - 1
              ? "step-bar__item--active"
              : ""
          }`}
        />
      ))}
    </div>
  );
}

export default function App() {
  const { phase, isLoading, error, dispatch } = useSession();

  const renderScreen = () => {
    switch (phase) {
      case "selection":
        return <LanguageSelect />;
      case "wound":
        return <WoundCapture />;
      case "emergencyHelp":
        return <EmergencyHelp />;
      case "inventory":
        return <InventoryScan />;
      case "protocol":
        return <ProtocolDisplay />;
      case "report":
        return <HospitalReport />;
      default:
        return <LanguageSelect />;
    }
  };

  return (
    <>
      <AppHeader />
      {phase !== "selection" && <StepBar current={phase} />}
      {isLoading && <div className="global-status"><span className="spinner" /> Working...</div>}
      {error && (
        <button className="global-error" onClick={() => dispatch({ type: "CLEAR_ERROR" })}>
          {error}
        </button>
      )}
      <main className="app-main">{renderScreen()}</main>
    </>
  );
}
