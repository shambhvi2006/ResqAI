const LANG_MAP = {
  en: "en-IN",
  hi: "hi-IN",
  pa: "en-IN", // pa-IN rarely available on Android, fallback to en-IN
};

export function speak(text, language = "en") {
  speakInstruction(text, language);
}

export function speakInstruction(text, language = "en", options = {}) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const spokenText = options.critical ? `Listen carefully. ${text}` : text;
  const lang = LANG_MAP[language] || "en-IN";
  const utterance = new SpeechSynthesisUtterance(spokenText);
  const voices = window.speechSynthesis.getVoices?.() || [];
  const matchingVoice = voices.find((voice) => voice.lang === lang)
    || voices.find((voice) => voice.lang?.startsWith(lang.split("-")[0]))
    || null;

  utterance.lang = lang;
  utterance.voice = matchingVoice;
  utterance.rate = 0.9;
  utterance.pitch = 0.95;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeechAvailable() {
  return "speechSynthesis" in window;
}
