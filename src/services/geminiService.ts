import { buildSafeFallback, extractJSONObject, normalizeTriageResult } from "../utils/jsonValidator";
import { getGeminiSystemPrompt } from "../utils/promptBuilder";

const GEMINI_API_KEY = import.meta.env.VITE_GEMMA_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMMA_STUDIO_MODEL || "gemini-2.0-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function callGeminiTriage(
  prompt: string,
  imageBase64?: string
): Promise<ReturnType<typeof normalizeTriageResult>> {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing VITE_GEMMA_API_KEY in .env");
  }

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (imageBase64) {
    parts.unshift({
      inline_data: {
        mime_type: "image/jpeg",
        data: imageBase64,
      },
    });
  }

  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: getGeminiSystemPrompt() }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.15,
          topP: 0.8,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text = extractGeminiText(data);
  const parsed = text ? extractJSONObject(text) : buildSafeFallback(prompt, "cloud");
  return normalizeTriageResult(parsed, "cloud");
}

function extractGeminiText(data: any): string {
  const candidate = data.candidates?.[0];
  const functionArgs = candidate?.content?.parts?.[0]?.functionCall?.args;
  if (functionArgs) {
    return JSON.stringify(functionArgs);
  }

  const parts = candidate?.content?.parts || [];
  return parts
    .map((part: any) => part.text || "")
    .join("")
    .replace(/```json|```/gi, "")
    .trim();
}
