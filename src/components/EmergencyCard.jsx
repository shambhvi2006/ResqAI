export default function EmergencyCard({ step, index, active, completed, onClick }) {
  return (
    <button
      type="button"
      className="step-card"
      onClick={onClick}
      style={{
        cursor: "pointer",
        opacity: completed ? 0.6 : 1,
        borderColor: active ? "var(--red-alert)" : undefined,
      }}
    >
      <span className="eyebrow">{index + 1}</span>
      <span className="step-action">{step}</span>
    </button>
  );
}
