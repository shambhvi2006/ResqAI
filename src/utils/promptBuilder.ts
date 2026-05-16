type LocalTriageContext = {
  severity?: string;
  condition?: string;
  call_ambulance?: boolean;
  key_signals?: string[];
  triage_reasoning?: string;
  risk_flags?: string[];
};

type PromptBuilderOptions = {
  userMessage: string;
  availableResources?: string;
  imageAttached?: boolean;
  imageContext?: string;
  localTriage?: LocalTriageContext | null;
};

const BASE_SYSTEM_PROMPT = `You are ResqAI, an emergency medical assistant.
Generate only valid JSON with exactly these fields:
severity, call_ambulance, steps, estimated_time_minutes, condition, warn_message, next_question.

Safety rules:
- Prefer immediate life-saving actions first.
- Do not provide medication dosages.
- Keep steps short, concrete, and sequential.
- Respond in the same language as the user when possible.
- If the situation sounds life-threatening, clearly recommend emergency services.`;

export function buildEnhancedPrompt({
  userMessage,
  availableResources,
  imageAttached,
  imageContext,
  localTriage,
}: PromptBuilderOptions): string {
  const sections = [
    "You are ResqAI, an emergency medical assistant.",
    "",
    "Use the following emergency triage priors from a local specialist model as guidance, not as the final answer.",
    formatLocalTriage(localTriage),
    "",
    "Rendering rules:",
    '- Return JSON only with fields: "severity", "call_ambulance", "steps", "estimated_time_minutes", "condition", "warn_message", "next_question".',
    '- Valid severity values: "critical", "high", "moderate", "low".',
    "- Keep steps brief and practical for a stressed user.",
    "- If image context is attached, use only broad visible scene cues and do not overclaim diagnosis from the image.",
    availableResources?.trim()
      ? `Available resources nearby: ${availableResources.trim()}`
      : "Available resources nearby: unknown",
    imageAttached ? `Image context: ${imageContext || "An image is attached. Use it only for high-level scene observations."}` : "Image context: none",
    "",
    `Original user message: "${userMessage.trim()}"`,
  ];

  return sections.filter(Boolean).join("\n");
}

export function getGeminiSystemPrompt(): string {
  return BASE_SYSTEM_PROMPT;
}

function formatLocalTriage(localTriage?: LocalTriageContext | null): string {
  if (!localTriage) {
    return "- Local triage unavailable. Reason from the user message directly.";
  }

  return [
    `- Severity estimate: ${localTriage.severity || "unknown"}`,
    `- Suspected condition: ${localTriage.condition || "unknown"}`,
    `- Ambulance recommended: ${localTriage.call_ambulance ? "yes" : "no or unclear"}`,
    `- Key signals: ${(localTriage.key_signals || []).join(", ") || "none extracted"}`,
    `- Risk flags: ${(localTriage.risk_flags || []).join(", ") || "none extracted"}`,
    `- Triage reasoning: ${localTriage.triage_reasoning || "not provided"}`,
  ].join("\n");
}
