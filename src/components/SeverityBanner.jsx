export default function SeverityBanner({ severity }) {
  if (!severity) return null;
  const tone = severity === "critical" ? "red" : severity === "high" ? "amber" : "neutral";
  return <div className={`badge badge--${tone}`}>{severity}</div>;
}
