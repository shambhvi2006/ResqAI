import { useSession } from "../context/SessionContext.jsx";
import StepExecution from "./StepExecution.jsx";

export default function ProtocolDisplay() {
  const { woundAssessment, protocol, currentStepIndex, isMuted, dispatch } = useSession();
  const steps = protocol?.steps || [];
  const currentStep = steps[currentStepIndex];
  const isCritical = woundAssessment?.severity === "critical";

  if (!protocol || !currentStep) {
    return (
      <div className="screen fade-in center-screen">
        <p>No protocol available.</p>
        <button className="btn btn--primary" onClick={() => dispatch({ type: "SET_PHASE", payload: "report" })}>
          Generate Hospital Report
        </button>
      </div>
    );
  }

  return (
    <div className="screen fade-in">
      <section className="screen-header">
        <div className="eyebrow">Step 3 of 4</div>
        <h2>First-Aid Protocol</h2>
        <p>Emergency guidance only. Seek professional medical help as soon as possible.</p>
      </section>

      {isCritical && (
        <div className="alert alert--error strong-alert">
          Critical injury. Call emergency services now if you can.
        </div>
      )}

      <div className="card info-grid">
        <Info label="Severity" value={woundAssessment?.severity} />
        <Info label="Type" value={woundAssessment?.wound_type} />
        <Info label="Bleeding" value={woundAssessment?.bleed_rate} />
        <Info label="Location" value={woundAssessment?.location} />
      </div>

      {!!protocol.do_not?.length && (
        <div className="do-not-banner">
          <strong>DO NOT</strong>
          {protocol.do_not.map((item) => <span key={item}>{item}</span>)}
        </div>
      )}

      {protocol.when_to_stop && <div className="alert alert--warning">{protocol.when_to_stop}</div>}

      <div className="protocol-toolbar">
        <span className="badge badge--green">
          Step {currentStepIndex + 1} / {steps.length}
        </span>
        <button className="btn btn--ghost" onClick={() => dispatch({ type: "TOGGLE_MUTE" })}>
          {isMuted ? "Unmute" : "Mute"}
        </button>
      </div>

      <StepExecution currentStep={currentStep} isLastStep={currentStepIndex >= steps.length - 1} />

      <button className="btn btn--secondary" onClick={() => dispatch({ type: "SET_PHASE", payload: "report" })}>
        Generate Hospital Report
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
