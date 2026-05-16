import { extractJSONObject } from "../utils/jsonValidator";

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL || "resqai-gemma";
const OLLAMA_TIMEOUT_MS = Number(import.meta.env.VITE_OLLAMA_TIMEOUT_MS || 1800);

export type LocalTriageResult = {
  severity: string;
  condition: string;
  call_ambulance: boolean;
  key_signals: string[];
  triage_reasoning: string;
  risk_flags: string[];
};

const TRIAGE_SYSTEM_PROMPT = `You are ResqAI's local emergency triage extraction model.
Return JSON only with exactly these fields:
severity, condition, call_ambulance, key_signals, triage_reasoning, risk_flags.

Rules:
- Severity must be one of: critical, high, moderate, low.
- condition must be snake_case.
- key_signals and risk_flags must be arrays of short strings.
- Do not include markdown fences or extra commentary.`;

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function callLocalTriageModel(
  userMessage: string,
  availableResources?: string
): Promise<LocalTriageResult> {
  const fullMessage = buildLocalUserMessage(userMessage, availableResources);
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: TRIAGE_SYSTEM_PROMPT },
        { role: "user", content: fullMessage },
      ],
      stream: false,
      options: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = String(data.message?.content || "").replace(/```json|```/gi, "").trim();
  const parsed = extractJSONObject(text);

  return {
    severity: String(parsed.severity || "moderate").toLowerCase(),
    condition: String(parsed.condition || "general_emergency"),
    call_ambulance: Boolean(parsed.call_ambulance),
    key_signals: Array.isArray(parsed.key_signals)
      ? parsed.key_signals.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
    triage_reasoning: String(parsed.triage_reasoning || ""),
    risk_flags: Array.isArray(parsed.risk_flags)
      ? parsed.risk_flags.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

function buildLocalUserMessage(userMessage: string, availableResources?: string): string {
  let fullMessage = `Emergency: ${userMessage.trim()}.`;
  if (availableResources?.trim()) {
    fullMessage += ` Available resources: ${availableResources.trim()}.`;
  }
  fullMessage += " Extract emergency triage context and respond with JSON only.";
  return fullMessage;
}
