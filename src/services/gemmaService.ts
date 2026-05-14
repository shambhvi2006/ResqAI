import offlineTriageData from "./offlineTriage.json";

const API_KEY = import.meta.env.VITE_GEMMA_API_KEY;
const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemma-2-27b-it:generateContent";

const SYSTEM_PROMPT = `You are ResqAI, an emergency first-aid assistant. You speak calmly and clearly.
When given an emergency, always call the triage_emergency function.
Steps must be short, imperative, and immediately actionable.
Never say 'consult a doctor' as the only step — always give immediate first steps too.
If the user's message is in Hindi or any other language, respond with steps in that same language.
Ask a follow-up question only if it would meaningfully change your triage (e.g. age of patient,
whether they are conscious). Do not ask unnecessary questions.`;

export type TriageSeverity = "critical" | "serious" | "minor";

export type TriageResult = {
  severity: TriageSeverity;
  call_ambulance: boolean;
  steps: string[];
  estimated_time_minutes: number;
  condition: string;
  warn_message: string;
  next_question: string;
};

type OfflineTriageData = Record<string, TriageResult>;

const offlineConditions = offlineTriageData as OfflineTriageData;

const TRIAGE_TOOL = {
  function_declarations: [
    {
      name: "triage_emergency",
      description: "Return emergency first-aid triage for the user's situation.",
      parameters: {
        type: "OBJECT",
        properties: {
          severity: {
            type: "STRING",
            enum: ["critical", "serious", "minor"],
          },
          call_ambulance: { type: "BOOLEAN" },
          steps: {
            type: "ARRAY",
            items: { type: "STRING" },
            maxItems: 8,
          },
          estimated_time_minutes: {
            type: "NUMBER",
            description: "0 means immediate; otherwise minutes until professional care is critical.",
          },
          condition: {
            type: "STRING",
            description: 'Snake_case identifier like "choking_adult" or "cardiac_arrest".',
          },
          warn_message: {
            type: "STRING",
            description: "One sentence, only populated when severity is critical.",
          },
          next_question: {
            type: "STRING",
            description: "Follow-up question if more information would change triage, otherwise empty.",
          },
        },
        required: [
          "severity",
          "call_ambulance",
          "steps",
          "estimated_time_minutes",
          "condition",
          "warn_message",
          "next_question",
        ],
      },
    },
  ],
};

export async function triageEmergency(
  userMessage: string,
  imageBase64?: string
): Promise<TriageResult> {
  try {
    if (!API_KEY) {
      throw new Error("Missing VITE_GEMMA_API_KEY");
    }

    const parts: Array<Record<string, unknown>> = [{ text: userMessage }];
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: imageBase64,
        },
      });
    }

    const response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        tools: [TRIAGE_TOOL],
        tool_config: {
          function_calling_config: {
            mode: "ANY",
            allowed_function_names: ["triage_emergency"],
          },
        },
        generation_config: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Google AI Studio error ${response.status}: ${message}`);
    }

    const data = await response.json();
    const args = extractFunctionArgs(data);
    return normalizeTriageResult(args);
  } catch (error) {
    console.warn("Gemma emergency triage failed; using offline fallback.", error);
    return triageOffline(getClosestCondition(userMessage));
  }
}

export async function triageOffline(condition: string): Promise<TriageResult> {
  try {
    const closestCondition = offlineConditions[condition]
      ? condition
      : getClosestCondition(condition);
    const result = offlineConditions[closestCondition] || offlineConditions.severe_bleeding;
    return cloneTriageResult(result);
  } catch (error) {
    console.warn("Offline emergency triage failed; using severe bleeding fallback.", error);
    return cloneTriageResult(offlineConditions.severe_bleeding);
  }
}

function extractFunctionArgs(data: unknown): unknown {
  const candidate = (data as any)?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const functionCallPart = parts.find((part: any) => part.functionCall || part.function_call);
  const functionCall = functionCallPart?.functionCall || functionCallPart?.function_call;

  if (!functionCall?.args) {
    const reason = candidate?.finishReason || candidate?.finish_reason || (data as any)?.promptFeedback?.blockReason;
    throw new Error(`Gemma returned no triage function call${reason ? `: ${reason}` : ""}`);
  }

  return functionCall.args;
}

function normalizeTriageResult(value: unknown): TriageResult {
  const result = value as Partial<TriageResult>;
  const severity = result.severity;

  if (!["critical", "serious", "minor"].includes(String(severity))) {
    throw new Error("Gemma returned invalid triage severity.");
  }

  const steps = Array.isArray(result.steps)
    ? result.steps.map((step) => String(step).trim()).filter(Boolean).slice(0, 8)
    : [];

  if (!steps.length) {
    throw new Error("Gemma returned no triage steps.");
  }

  return {
    severity: severity as TriageSeverity,
    call_ambulance: Boolean(result.call_ambulance),
    steps,
    estimated_time_minutes: Number(result.estimated_time_minutes ?? 0),
    condition: toSnakeCase(String(result.condition || "unknown_emergency")),
    warn_message: severity === "critical" ? String(result.warn_message || "") : "",
    next_question: String(result.next_question || ""),
  };
}

function cloneTriageResult(result: TriageResult): TriageResult {
  return {
    ...result,
    steps: [...result.steps],
  };
}

function getClosestCondition(input: string): string {
  const text = normalizeText(input);
  const scored = Object.keys(conditionKeywords).map((condition) => ({
    condition,
    score: scoreCondition(text, conditionKeywords[condition]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].condition : "severe_bleeding";
}

function scoreCondition(text: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return text.includes(normalizedKeyword) ? score + normalizedKeyword.length : score;
  }, 0);
}

function normalizeText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSnakeCase(input: string): string {
  return normalizeText(input).replace(/\s+/g, "_") || "unknown_emergency";
}

const conditionKeywords: Record<string, string[]> = {
  choking_adult: ["choking", "choke", "airway blocked", "can't breathe", "food stuck", "गला", "दम घुट"],
  cardiac_arrest: ["cardiac arrest", "no pulse", "not breathing", "collapsed", "cpr", "unresponsive"],
  severe_bleeding: ["severe bleeding", "bleeding", "blood", "spurting", "hemorrhage", "cut", "खून"],
  burn_second_degree: ["burn", "blister", "scald", "hot water", "second degree", "जल"],
  anaphylaxis: ["anaphylaxis", "allergic", "swelling throat", "epipen", "wheezing", "hives"],
  seizure: ["seizure", "fit", "convulsion", "shaking", "epilepsy", "दौरा"],
  stroke: ["stroke", "face droop", "slurred speech", "arm weakness", "लकवा"],
  diabetic_emergency: ["diabetic", "diabetes", "low sugar", "hypoglycemia", "insulin", "sugar"],
  poisoning: ["poison", "poisoning", "overdose", "chemical", "tablet", "swallowed"],
  head_injury: ["head injury", "hit head", "concussion", "head wound", "skull", "सिर"],
  heat_stroke: ["heat stroke", "overheated", "high temperature", "hot sun", "heat exhaustion"],
  fracture: ["fracture", "broken bone", "broken", "deformity", "bone", "हड्डी"],
  nosebleed: ["nosebleed", "nose bleed", "bloody nose", "नाक"],
  drowning: ["drowning", "drowned", "near drowning", "water inhaled", "pool"],
  chest_pain: ["chest pain", "heart attack", "pressure in chest", "left arm pain", "सीने"],
  eye_injury: ["eye injury", "chemical in eye", "eye", "vision", "आंख"],
  electric_shock: ["electric shock", "electrocuted", "current", " बिजली", "shock"],
  snakebite: ["snakebite", "snake bite", "snake", "venom", "सांप"],
  hypothermia: ["hypothermia", "freezing", "too cold", "cold exposure", "shivering"],
  allergic_reaction_mild: ["mild allergy", "rash", "itching", "sneezing", "mild allergic"],
};
