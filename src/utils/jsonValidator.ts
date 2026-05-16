export type TriageSeverity = "critical" | "high" | "moderate" | "low";
export type TriageSource = "local" | "cloud" | "offline";

export type TriageResult = {
  severity: TriageSeverity;
  call_ambulance: boolean;
  steps: string[];
  estimated_time_minutes: number;
  condition: string;
  warn_message: string;
  next_question: string;
  _source: TriageSource;
  _triageContext?: Record<string, unknown>;
};

const VALID_SEVERITIES: TriageSeverity[] = ["critical", "high", "moderate", "low"];

export function extractJSONObject(text: string): Record<string, unknown> {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON found in model response.");
  }
  return JSON.parse(match[0]);
}

export function validateTriageResult(
  value: unknown,
  source: TriageSource,
  fallbackInput = ""
): TriageResult {
  try {
    return normalizeTriageResult(value, source);
  } catch (error) {
    console.warn("Invalid emergency JSON, using safe fallback.", error);
    return buildSafeFallback(fallbackInput, source);
  }
}

export function normalizeTriageResult(value: unknown, source: TriageSource): TriageResult {
  const record = isRecord(value) ? value : {};
  const severity = normalizeSeverity(record.severity);
  const steps = Array.isArray(record.steps)
    ? record.steps.map((step) => String(step || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    severity,
    call_ambulance: Boolean(record.call_ambulance),
    steps: steps.length
      ? steps
      : [
          "Check if the person is breathing normally.",
          "Move them away from immediate danger if safe.",
          "Call emergency services if symptoms are severe or worsening.",
        ],
    estimated_time_minutes: normalizeMinutes(record.estimated_time_minutes, severity),
    condition: toSnakeCase(String(record.condition || "general_emergency")),
    warn_message: String(record.warn_message || ""),
    next_question: String(record.next_question || ""),
    _source: source,
    _triageContext: isRecord(record._triageContext) ? record._triageContext : undefined,
  };
}

export function buildSafeFallback(input = "", source: TriageSource = "offline"): TriageResult {
  const text = String(input || "").toLowerCase();
  const choking = /chok|can't breathe|cant breathe|blocked throat/.test(text);
  const cardiac = /cpr|not breathing|no pulse|collapsed|unconscious|cardiac|heart attack/.test(text);
  const bleeding = /bleed|blood|deep cut|spurting|severe cut|gash/.test(text);

  if (cardiac) {
    return {
      severity: "critical",
      call_ambulance: true,
      steps: [
        "Call emergency services immediately.",
        "Start CPR if the person is not breathing normally.",
        "Use an AED if one is available nearby.",
      ],
      estimated_time_minutes: 0,
      condition: "cardiac_arrest",
      warn_message: "Begin CPR now if there is no normal breathing.",
      next_question: "Is the person breathing or responding at all?",
      _source: source,
    };
  }

  if (choking) {
    return {
      severity: "critical",
      call_ambulance: true,
      steps: [
        "Call emergency services if the airway stays blocked.",
        "Ask if they can cough or speak.",
        "Give back blows and abdominal thrusts if they cannot breathe.",
      ],
      estimated_time_minutes: 0,
      condition: "choking_adult",
      warn_message: "Treat this as a blocked airway emergency.",
      next_question: "Can the person cough, speak, or breathe at all?",
      _source: source,
    };
  }

  if (bleeding) {
    return {
      severity: "high",
      call_ambulance: true,
      steps: [
        "Apply firm direct pressure to the wound.",
        "Keep the injured area raised if possible.",
        "Call emergency services if bleeding is heavy or does not stop.",
      ],
      estimated_time_minutes: 5,
      condition: "severe_bleeding",
      warn_message: "Heavy bleeding can become life-threatening quickly.",
      next_question: "Is the bleeding soaking through your pressure quickly?",
      _source: source,
    };
  }

  return {
    severity: "moderate",
    call_ambulance: false,
    steps: [
      "Check breathing, bleeding, and responsiveness.",
      "Keep the person still and away from danger.",
      "Call emergency services if symptoms worsen or you are unsure.",
    ],
    estimated_time_minutes: 10,
    condition: "general_emergency",
    warn_message: "",
    next_question: "What symptoms are you seeing right now?",
    _source: source,
  };
}

function normalizeSeverity(value: unknown): TriageSeverity {
  const text = String(value || "").toLowerCase();
  if (VALID_SEVERITIES.includes(text as TriageSeverity)) {
    return text as TriageSeverity;
  }
  if (text === "serious") return "high";
  if (text === "minor") return "low";
  return "moderate";
}

function normalizeMinutes(value: unknown, severity: TriageSeverity): number {
  const minutes = Number(value);
  if (Number.isFinite(minutes) && minutes >= 0) return minutes;
  if (severity === "critical") return 0;
  if (severity === "high") return 5;
  return 10;
}

function toSnakeCase(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, "_") || "general_emergency";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
