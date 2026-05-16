import offlineTriageData from "./offlineTriage.json";

const SYSTEM_PROMPT = `You are ResqAI, a calm emergency first-aid assistant.
You MUST always respond by calling the triage_emergency function.
Never respond with plain text. Never ask questions before triaging.
Even for vague inputs like "what to do" or "help" — always call the function.
Default to severity "serious" if unsure. Always give at least 3 steps.
Respond in the same language the user writes in.`;

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

export async function triageEmergency(
  userMessage: string,
  imageBase64?: string,
  availableResources?: string
): Promise<TriageResult> {
  const apiKey = import.meta.env.VITE_GEMMA_API_KEY;

  try {
    const parts: any[] = [];

    if (imageBase64) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
    }

    let fullMessage = `Emergency: ${userMessage}.`;
    if (availableResources) {
      fullMessage += ` Available resources: ${availableResources}.`;
    }
    fullMessage += ` Call triage_emergency now.`;
    parts.push({ text: fullMessage });

    const requestBody = {
      system_instruction: { parts: [{ text: buildSystemPrompt(availableResources) }] },
      contents: [{ role: "user", parts }],
      tools: [
        {
          function_declarations: [
            {
              name: "triage_emergency",
              description: "Triage an emergency situation and provide first aid steps",
              parameters: {
                type: "OBJECT",
                properties: {
                  severity: {
                    type: "STRING",
                    enum: ["critical", "serious", "minor"],
                    description: "Severity level of the emergency",
                  },
                  call_ambulance: {
                    type: "BOOLEAN",
                    description: "Whether to call an ambulance immediately",
                  },
                  steps: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "First aid steps, 4-8 items, each under 15 words",
                  },
                  condition: {
                    type: "STRING",
                    description: "Snake case condition identifier e.g. severe_bleeding",
                  },
                  warn_message: {
                    type: "STRING",
                    description: "One urgent warning sentence for critical cases",
                  },
                  estimated_time_minutes: {
                    type: "NUMBER",
                    description: "Minutes until professional care is critical, 0 means immediate",
                  },
                  next_question: {
                    type: "STRING",
                    description: "Follow up question if needed, empty string if not",
                  },
                },
                required: [
                  "severity",
                  "call_ambulance",
                  "steps",
                  "condition",
                  "warn_message",
                  "estimated_time_minutes",
                  "next_question",
                ],
              },
            },
          ],
        },
      ],
      tool_config: {
        function_calling_config: { mode: "ANY" },
      },
    };

    console.log("Sending to Gemma:", fullMessage);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", errorText);
      throw new Error(`API failed: ${response.status}`);
    }

    const data = await response.json();
    console.log("Raw response:", JSON.stringify(data).slice(0, 600));

    const part = data.candidates?.[0]?.content?.parts?.[0];

    if (part?.functionCall?.args) {
      console.log("Got function call:", part.functionCall.name);
      return finalizeResult(part.functionCall.args as TriageResult, availableResources);
    }

    if (part?.text) {
      console.log("Got plain text, parsing...");
      const jsonMatch = part.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.steps) return finalizeResult(parsed, availableResources);
        } catch (e) {}
      }
    }

    console.log("Falling back to offline triage");
    return finalizeResult(await triageOffline(userMessage), availableResources);
  } catch (error) {
    console.warn("Gemma emergency triage failed; using offline fallback.", error);
    return finalizeResult(await triageOffline(userMessage), availableResources);
  }
}

function buildSystemPrompt(availableResources?: string): string {
  const resources = availableResources?.trim();
  if (!resources) return SYSTEM_PROMPT;

  const noSuppliesInstruction = isNoSuppliesContext(resources)
    ? `
CRITICAL: User has NO medical supplies. Every single step must use bare hands only.
Never mention cloth, gauze, bandage, dressing, or any medical item.`
    : "";

  return `${SYSTEM_PROMPT}

The person has access to the following resources: ${resources}.
Tailor every step to use these specific resources.
For example if they have 'cloth and water', say 'soak the cloth in water and apply pressure'
not 'use a sterile dressing'. If they have nothing, give bare-hands-only instructions.${noSuppliesInstruction}`;
}

function finalizeResult(value: Partial<TriageResult>, availableResources?: string): TriageResult {
  const result = normalizeTriageResult(value);
  return isNoSuppliesContext(availableResources) ? sanitizeBareHandsResult(result) : result;
}

function normalizeTriageResult(value: Partial<TriageResult>): TriageResult {
  const severity = ["critical", "serious", "minor"].includes(String(value.severity))
    ? (value.severity as TriageSeverity)
    : "serious";
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step) => String(step).trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    severity,
    call_ambulance: Boolean(value.call_ambulance),
    steps: steps.length ? steps : ["Check breathing.", "Control immediate danger.", "Call emergency services if worsening."],
    estimated_time_minutes: Number(value.estimated_time_minutes ?? 10),
    condition: toSnakeCase(String(value.condition || "general_emergency")),
    warn_message: severity === "critical" ? String(value.warn_message || "") : "",
    next_question: String(value.next_question || ""),
  };
}

export async function triageOffline(condition: string): Promise<TriageResult> {
  try {
    const closestCondition = offlineConditions[condition] ? condition : getClosestCondition(condition);
    const result = offlineConditions[closestCondition] || offlineConditions.cardiac_arrest;
    return cloneTriageResult(result);
  } catch (error) {
    console.warn("Offline emergency triage failed; using cardiac arrest fallback.", error);
    return cloneTriageResult(offlineConditions.cardiac_arrest);
  }
}

function cloneTriageResult(result: TriageResult): TriageResult {
  return {
    ...result,
    steps: [...result.steps],
  };
}

function isNoSuppliesContext(availableResources?: string): boolean {
  return /nothing|no supplies|bare hands only/i.test(availableResources || "");
}

function sanitizeBareHandsResult(result: TriageResult): TriageResult {
  return {
    ...result,
    steps: result.steps.map((step) => sanitizeBareHandsStep(step)),
  };
}

function sanitizeBareHandsStep(step: string): string {
  if (!/(cloth|gauze|bandage|dressing|suppl|medical item|sterile|pad)/i.test(step)) {
    return step;
  }

  if (/press|pressure|bleed|blood|wound/i.test(step)) {
    return "Press directly with your bare hand.";
  }

  if (/cover|wrap|protect/i.test(step)) {
    return "Keep your bare hand over the injury.";
  }

  if (/clean|rinse|wash/i.test(step)) {
    return "Do not search for supplies.";
  }

  return "Continue using only bare hands.";
}

function getClosestCondition(input: string): string {
  const text = String(input || "").toLowerCase();

  for (const [condition, keywords] of Object.entries(keywordMap)) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
      return conditionAliases[condition] || condition;
    }
  }

  return "cardiac_arrest";
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
  return normalizeText(input).replace(/\s+/g, "_") || "general_emergency";
}

const conditionAliases: Record<string, string> = {
  choking: "choking_adult",
  burn: "burn_second_degree",
};

const keywordMap: Record<string, string[]> = {
  cardiac_arrest: ["cpr", "cardiac", "heart", "not breathing", "no pulse", "unconscious", "collapsed", "arrest"],
  choking: ["chok", "throat", "heimlich", "cant breathe", "can't breathe"],
  severe_bleeding: ["bleed", "blood", "cut", "wound", "gash", "stab"],
  burn: ["burn", "fire", "scald", "hot"],
  seizure: ["seizure", "fit", "convuls", "shaking"],
  stroke: ["stroke", "face drooping", "arm weak", "speech"],
  fracture: ["fracture", "broken", "bone", "snap"],
  anaphylaxis: ["allerg", "epipen", "swelling", "anaphyl"],
};
