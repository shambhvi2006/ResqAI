import { buildWoundPrompt } from "./prompts.js";

const API_KEY = import.meta.env.VITE_GEMMA_API_KEY;
const MODE = import.meta.env.VITE_GEMMA_MODE || "studio";
const STUDIO_MODEL = import.meta.env.VITE_GEMMA_STUDIO_MODEL || "gemini-2.5-flash";

const STUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OLLAMA_BASE = "http://localhost:11434/api/chat";

export function parseGemmaJSON(text) {
  const raw = String(text || "");
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!cleaned) {
    throw new Error("Gemma returned an empty response. Please try again, or use the text description.");
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("Gemma returned invalid JSON: " + cleaned.slice(0, 300));
  }
}

function extractText(data) {
  if (MODE === "local") {
    return data.message?.content || "";
  }
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (text) return text;

  const reason = candidate?.finishReason || data.promptFeedback?.blockReason;
  if (reason) {
    throw new Error(`Gemma returned no text. Reason: ${reason}`);
  }
  return "";
}

async function callStudio(payload) {
  if (!API_KEY && MODE !== "local") {
    throw new Error("Missing VITE_GEMMA_API_KEY in .env");
  }
  const res = await fetch(`${STUDIO_BASE}/models/${STUDIO_MODEL}:generateContent?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI Studio error ${res.status} using ${STUDIO_MODEL}: ${err}`);
  }
  return res.json();
}

async function callOllama(payload) {
  const res = await fetch(OLLAMA_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma3:4b",
      messages: [
        { role: "system", content: payload.systemInstruction.parts[0].text },
        { role: "user", content: payload.contents[0].parts.map(p => p.text || "").join(" ") },
      ],
      stream: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Local Gemma error ${res.status}: ${err}`);
  }
  return res.json();
}

// TEXT CALL — for protocol generation, fallback, report
export async function callGemmaText(systemPrompt, userMessage, retries = 2) {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
  };

  for (let i = 0; i <= retries; i++) {
    try {
      const data = MODE === "local"
        ? await callOllama(payload)
        : await callStudio(payload);
      const text = extractText(data);
      return parseGemmaJSON(text);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
    }
  }
}

// VISION CALL — for wound assessment and inventory scan
export async function callGemmaVision(
  systemPrompt,
  base64Image,
  mimeType = "image/jpeg",
  retries = 2,
  userText = "Analyze this image and return JSON as instructed."
) {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: userText },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };

  for (let i = 0; i <= retries; i++) {
    try {
      const data = await callStudio(payload); // vision always uses Studio
      const text = extractText(data);
      return parseGemmaJSON(text);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Convert file to base64 string
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // strip data:image/jpeg;base64,
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function assessWound({ imageBase64, description, language }) {
  const prompt = buildWoundPrompt(language);
  const userText = description?.trim()
    ? `Analyze this wound image. The user also described it as: "${description.trim()}". Return only the required JSON.`
    : "Analyze this wound image and return only the required JSON.";

  if (imageBase64) {
    try {
      return await callGemmaVision(prompt, imageBase64, "image/jpeg", 1, userText);
    } catch (visionError) {
      if (!description?.trim()) throw visionError;
      console.warn("Vision wound assessment failed, falling back to text.", visionError);
    }
  }

  if (description?.trim()) {
    try {
      return await callGemmaText(
        prompt,
        `Assess this wound description and return the required JSON: ${description}`
      );
    } catch (textError) {
      console.warn("Text wound assessment failed, using local fallback.", textError);
      return buildLocalWoundFallback(description);
    }
  }

  throw new Error("Add a photo or description before analysis.");
}

function buildLocalWoundFallback(description = "") {
  const text = description.toLowerCase();
  const hasBurn = /burn|scald/.test(text);
  const hasFracture = /fracture|broken|bone|deform/.test(text);
  const hasBleeding = /bleed|blood/.test(text);
  const hasSevere = /deep|arterial|spurting|unconscious|severe|large/.test(text);
  const location = [
    "knee",
    "arm",
    "leg",
    "hand",
    "palm",
    "finger",
    "foot",
    "ankle",
    "head",
    "face",
    "mouth",
    "teeth",
  ].find((word) => text.includes(word)) || "unknown";

  return {
    severity: hasSevere || hasFracture ? "serious" : "minor",
    wound_type: hasBurn ? "burn" : hasFracture ? "fracture" : text.includes("abrasion") ? "abrasion" : "injury",
    bleed_rate: hasBleeding ? "slow" : "none",
    location,
    immediate_risk: "Assessment used the written description because AI vision did not return valid JSON.",
    contraindications: ["Do not ignore worsening pain, swelling, heavy bleeding, or loss of movement."],
  };
}
