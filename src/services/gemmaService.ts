import offlineTriageData from "./offlineTriage.json";
import { callGeminiTriage } from "./geminiService";
import { callLocalTriageModel, isOllamaAvailable } from "./ollamaService";
import { buildEnhancedPrompt } from "../utils/promptBuilder";
import { buildSafeFallback, type TriageResult, validateTriageResult } from "../utils/jsonValidator";

type OfflineTriageData = Record<string, Omit<TriageResult, "_source" | "_triageContext">>;

const offlineConditions = offlineTriageData as OfflineTriageData;

export async function triageEmergency(
  userMessage: string,
  imageBase64?: string,
  availableResources?: string
): Promise<TriageResult> {
  const input = String(userMessage || "").trim();
  let localTriage = null;
  let source: TriageResult["_source"] = "cloud";

  try {
    if (await isOllamaAvailable()) {
      localTriage = await callLocalTriageModel(input, availableResources);
      source = "local";
    }
  } catch (error) {
    console.warn("Local triage extraction unavailable, continuing with cloud AI.", error);
  }

  const prompt = buildEnhancedPrompt({
    userMessage: input,
    availableResources,
    imageAttached: Boolean(imageBase64),
    localTriage,
  });

  try {
    const cloudResult = await callGeminiTriage(prompt, imageBase64);
    return validateTriageResult(
      {
        ...cloudResult,
        _source: source,
        _triageContext: localTriage || undefined,
      },
      source,
      input
    );
  } catch (error) {
    console.warn("Cloud triage failed, using offline fallback.", error);
    return triageOffline(input, localTriage);
  }
}

export async function triageOffline(
  condition: string,
  localTriage?: Record<string, unknown> | null
): Promise<TriageResult> {
  try {
    const closestCondition = offlineConditions[condition] ? condition : getClosestCondition(condition);
    const result = offlineConditions[closestCondition] || offlineConditions.cardiac_arrest;
    return validateTriageResult(
      {
        ...cloneOfflineResult(result),
        _triageContext: localTriage || undefined,
      },
      "offline",
      condition
    );
  } catch (error) {
    console.warn("Offline emergency triage failed; using safe fallback.", error);
    return buildSafeFallback(condition, "offline");
  }
}

function cloneOfflineResult(result: OfflineTriageData[string]) {
  return {
    ...result,
    steps: [...result.steps],
  };
}

function getClosestCondition(input: string): string {
  const text = normalizeText(input);

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
