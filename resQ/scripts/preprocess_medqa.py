#!/usr/bin/env python3
"""
preprocess_medqa.py
-------------------
Transforms MedQA-style multiple-choice questions (phrases_no_exclude_*.jsonl)
into ResqAI conversational triage format.

Pipeline:
  1. Read raw JSONL entries
  2. Classify each question into an emergency category (or non-emergency)
  3. Convert the clinical scenario into a realistic patient/bystander message
  4. Generate a medically appropriate structured JSON triage response
  5. Write output as JSONL with the ResqAI message schema

Output schema per entry:
{
  "messages": [
    {"role": "system",  "content": "<SYSTEM_PROMPT>"},
    {"role": "user",    "content": "<realistic symptom description>"},
    {"role": "assistant","content": "<JSON triage string>"}
  ]
}
"""

import json
import re
import random
import hashlib
import argparse
import logging
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are ResqAI, an emergency first-aid assistant. "
    "Always respond ONLY with structured JSON emergency triage output. "
    "Prioritize immediate stabilization and medically safe first-aid guidance. "
    "Be concise, calm, and decisive. "
    "Respond in the same language as the user."
)

# Keyword → (condition_slug, severity, call_ambulance)
EMERGENCY_KEYWORD_MAP = {
    # Cardiac
    "cardiac arrest":           ("cardiac_arrest",        "critical", True),
    "ventricular fibrillation": ("cardiac_arrest",        "critical", True),
    "ventricular tachycardia":  ("cardiac_arrest",        "critical", True),
    "myocardial infarction":    ("chest_pain",            "critical", True),
    "heart attack":             ("chest_pain",            "critical", True),
    "unstable angina":          ("chest_pain",            "high",     True),
    "chest pain":               ("chest_pain",            "high",     True),
    "aortic dissection":        ("chest_pain",            "critical", True),
    # Respiratory
    "respiratory failure":      ("breathing_difficulty",  "critical", True),
    "respiratory arrest":       ("breathing_difficulty",  "critical", True),
    "pulmonary embolism":       ("breathing_difficulty",  "critical", True),
    "shortness of breath":      ("breathing_difficulty",  "high",     True),
    "choking":                  ("choking_adult",         "critical", True),
    "airway obstruction":       ("choking_adult",         "critical", True),
    "anaphylaxis":              ("anaphylaxis",           "critical", True),
    "anaphylactic":             ("anaphylaxis",           "critical", True),
    # Neurological
    "stroke":                   ("stroke",                "critical", True),
    "cerebrovascular":          ("stroke",                "critical", True),
    "seizure":                  ("seizure",               "high",     True),
    "status epilepticus":       ("seizure",               "critical", True),
    "loss of consciousness":    ("head_injury",           "high",     True),
    "unconscious":              ("head_injury",           "high",     True),
    "head injury":              ("head_injury",           "high",     True),
    "traumatic brain":          ("head_injury",           "critical", True),
    "spinal":                   ("spinal_injury",         "high",     True),
    # Bleeding / Trauma
    "hemorrhage":               ("severe_bleeding",       "critical", True),
    "bleeding":                 ("severe_bleeding",       "high",     True),
    "thromboembolism":          ("severe_bleeding",       "high",     True),
    "disseminated intravascular": ("severe_bleeding",     "critical", True),
    "fracture":                 ("fracture",              "moderate", False),
    "femur fracture":           ("fracture",              "high",     True),
    # Burns / Toxic
    "burn":                     ("burn_second_degree",    "moderate", False),
    "overdose":                 ("opioid_overdose",       "critical", True),
    "poisoning":                ("opioid_overdose",       "high",     True),
    "toxic":                    ("opioid_overdose",       "high",     True),
    "electric shock":           ("electric_shock",        "high",     True),
    # Metabolic
    "hypoglycemia":             ("diabetic_hypoglycemia", "high",     True),
    "diabetic":                 ("diabetic_hypoglycemia", "moderate", False),
    "hyperglycemia":            ("diabetic_hypoglycemia", "moderate", False),
    # Drowning / Heat
    "drowning":                 ("drowning",              "critical", True),
    "heat stroke":              ("heat_stroke",           "critical", True),
    "hyperthermia":             ("heat_stroke",           "high",     True),
    "hypothermia":              ("heat_stroke",           "high",     True),
    # Sepsis / Infection
    "sepsis":                   ("sepsis",                "critical", True),
    "septic shock":             ("sepsis",                "critical", True),
    # Eye / Nose / Other
    "eye injury":               ("eye_injury",            "moderate", False),
    "nosebleed":                ("nosebleed",             "low",      False),
    "snakebite":                ("snakebite",             "high",     True),
    "snake bite":               ("snakebite",             "high",     True),
}

# Non-emergency default
DEFAULT_NON_EMERGENCY = ("medical_condition", "moderate", False)

# Age group patterns extracted from question text
AGE_PATTERNS = [
    (r"(\d+)[- ]year[- ]old (man|woman|male|female|patient|infant|child|boy|girl|baby)", "adult"),
    (r"(\d+)[- ]month[- ]old", "infant"),
    (r"(\d+)[- ]week[- ]old", "infant"),
    (r"\b(infant|newborn|neonate)\b", "infant"),
    (r"\b(toddler|child|pediatric)\b", "child"),
    (r"\b(adolescent|teenager|teen)\b", "teen"),
    (r"\b(elderly|geriatric|older adult)\b", "elderly"),
]

# Panic-level message templates for user turn
PANIC_TEMPLATES = [
    "{scenario} What do I do??",
    "HELP! {scenario}",
    "{scenario} Please help me!",
    "{scenario} I don't know what to do.",
    "Emergency! {scenario}",
    "{scenario}",
    "Someone help — {scenario}",
    "{scenario} We're at {location}.",
]

LOCATIONS = [
    "home", "the office", "a restaurant", "outdoors", "the gym",
    "a park", "the car", "school", "a shopping mall", "the street",
]

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _seed_from_text(text: str) -> int:
    """Deterministic seed from text so output is reproducible."""
    return int(hashlib.md5(text.encode()).hexdigest(), 16) % (2**31)


def classify_entry(question: str, answer: str, metamap_phrases: list) -> tuple:
    """
    Return (condition_slug, severity, call_ambulance) by scanning
    question + answer + metamap_phrases for emergency keywords.
    Falls back to DEFAULT_NON_EMERGENCY.
    """
    combined = " ".join([question.lower(), answer.lower()] + [p.lower() for p in metamap_phrases])
    for keyword, mapping in EMERGENCY_KEYWORD_MAP.items():
        if keyword in combined:
            return mapping
    return DEFAULT_NON_EMERGENCY


def extract_age_gender(question: str) -> tuple:
    """Return (age_str, gender_str) from question text, or (None, None)."""
    for pattern, _ in AGE_PATTERNS:
        m = re.search(pattern, question, re.IGNORECASE)
        if m:
            groups = m.groups()
            age = groups[0] if groups else None
            gender = groups[1] if len(groups) > 1 else None
            return age, gender
    return None, None


def extract_key_symptoms(question: str, metamap_phrases: list) -> list:
    """
    Pull the most clinically relevant phrases from metamap_phrases.
    Filters out exam-style noise like 'following', 'most likely', etc.
    """
    noise = {
        "following", "most likely", "best treatment", "patient", "physician",
        "presents", "history", "examination", "laboratory", "studies show",
        "which of", "correct next", "action", "following actions", "cause",
        "pathogenesis", "precautions", "prevented", "death", "baby",
        "account", "presentation", "symptoms", "diagnosis",
    }
    symptoms = []
    for phrase in metamap_phrases:
        phrase_lower = phrase.lower().strip()
        if len(phrase_lower) < 4:
            continue
        if any(n in phrase_lower for n in noise):
            continue
        # Keep phrases that look like symptoms or clinical findings
        if any(c.isalpha() for c in phrase_lower):
            symptoms.append(phrase.strip())
    return symptoms[:8]  # cap at 8 phrases


def build_user_message(question: str, answer: str, metamap_phrases: list,
                       condition_slug: str, rng: random.Random) -> str:
    """
    Convert a clinical MCQ into a realistic patient/bystander message.
    Strips all exam-style language.
    """
    age, gender = extract_age_gender(question)
    symptoms = extract_key_symptoms(question, metamap_phrases)

    # Build age/gender prefix
    if age and gender:
        gender_word = "man" if gender.lower() in ("man", "male") else "woman"
        age_prefix = f"My {age}-year-old {gender_word}"
    elif age:
        age_prefix = f"A {age}-year-old person"
    else:
        age_prefix = "Someone"

    # Build symptom description
    if symptoms:
        symptom_str = ", ".join(symptoms[:4]).lower()
        scenario = f"{age_prefix} has {symptom_str}"
    else:
        # Fall back to extracting first sentence of question
        first_sentence = question.split(".")[0].strip()
        # Remove exam phrasing
        first_sentence = re.sub(
            r"(which of the following|what is the|most likely|best treatment|"
            r"correct next action|most appropriate)\??",
            "", first_sentence, flags=re.IGNORECASE
        ).strip().rstrip(",")
        scenario = first_sentence

    # Add location randomly
    location = rng.choice(LOCATIONS)
    template = rng.choice(PANIC_TEMPLATES)
    message = template.format(scenario=scenario, location=location)

    # Clean up double spaces
    message = re.sub(r"\s+", " ", message).strip()
    return message


def build_steps_for_condition(condition_slug: str, severity: str,
                               answer: str, rng: random.Random) -> list:
    """
    Generate 4–6 medically appropriate first-aid steps for the given condition.
    Steps are WHO/AHA/Red Cross aligned and do NOT include drug dosages.
    """
    step_library = {
        "cardiac_arrest": [
            "Call 911 immediately.",
            "Begin CPR: 30 hard chest compressions, 2 inches deep.",
            "Give 2 rescue breaths after every 30 compressions.",
            "Use AED as soon as available — follow voice prompts.",
            "Deliver shock if advised, resume CPR immediately.",
            "Continue CPR until EMS arrives.",
            "Do not stop compressions for more than 10 seconds.",
        ],
        "chest_pain": [
            "Call 911 immediately.",
            "Have the person sit or lie down comfortably.",
            "Loosen tight clothing around chest and neck.",
            "Give aspirin to chew if not allergic and available.",
            "Do not let them walk or exert themselves.",
            "Monitor breathing and consciousness until EMS arrives.",
        ],
        "breathing_difficulty": [
            "Call 911 immediately.",
            "Help the person sit upright to ease breathing.",
            "Loosen any tight clothing around neck and chest.",
            "Keep them calm — anxiety worsens breathlessness.",
            "If prescribed inhaler is available, assist with use.",
            "Monitor breathing rate and consciousness.",
            "Begin CPR if breathing stops completely.",
        ],
        "choking_adult": [
            "Call 911 immediately.",
            "Ask: 'Are you choking?' — if no sound, act now.",
            "Stand behind victim, arms around waist.",
            "Place fist above navel, grasp with other hand.",
            "Give sharp inward-upward abdominal thrusts.",
            "Repeat until object expelled or victim collapses.",
            "Begin CPR if victim becomes unconscious.",
        ],
        "anaphylaxis": [
            "Call 911 immediately.",
            "Administer epinephrine auto-injector to outer thigh if available.",
            "Have person sit upright or lie with legs elevated.",
            "Loosen tight clothing around neck.",
            "A second epinephrine dose may be given after 5–15 minutes.",
            "Go to ER even if symptoms improve — biphasic reaction risk.",
        ],
        "stroke": [
            "Call 911 immediately — note the exact time symptoms started.",
            "Use FAST: Face drooping, Arm weakness, Speech difficulty.",
            "Have person sit or lie down safely.",
            "Do not give food, water, or medication.",
            "Do not drive — ambulance can begin treatment en route.",
            "Stay with them until EMS arrives.",
        ],
        "seizure": [
            "Call 911 if seizure lasts over 5 minutes.",
            "Clear area of hard or sharp objects.",
            "Do NOT restrain movements or put anything in mouth.",
            "Cushion head gently with something soft.",
            "Time the seizure from start.",
            "Turn person on side after shaking stops.",
        ],
        "head_injury": [
            "Call 911 if unconscious, confused, or vomiting.",
            "Keep person still — assume possible spinal injury.",
            "Do not give aspirin or ibuprofen.",
            "Apply ice pack wrapped in cloth to reduce swelling.",
            "Watch for: worsening headache, unequal pupils, confusion.",
            "Do not let them fall asleep without monitoring.",
        ],
        "spinal_injury": [
            "Call 911 immediately.",
            "Do NOT move the person — keep completely still.",
            "Support head and neck in neutral position.",
            "Do not remove helmet if wearing one.",
            "Keep person warm and calm.",
            "Stay with them until EMS arrives with spinal board.",
        ],
        "severe_bleeding": [
            "Call 911 immediately.",
            "Apply firm direct pressure with clean cloth.",
            "Do not remove cloth — add more on top if soaked.",
            "Elevate the injured limb above heart level.",
            "Apply tourniquet 2 inches above wound if limb is bleeding severely.",
            "Keep person lying down and warm.",
        ],
        "burn_second_degree": [
            "Cool burn under cool running water for 20 minutes.",
            "Do not use ice, butter, or any home remedies.",
            "Do not pop blisters.",
            "Cover loosely with sterile non-stick dressing.",
            "Give over-the-counter pain reliever if available.",
            "Seek medical care if burn is larger than palm size.",
        ],
        "opioid_overdose": [
            "Call 911 immediately.",
            "Administer naloxone nasal spray if available.",
            "Place person on their side in recovery position.",
            "Tilt head back to open airway.",
            "Give rescue breaths if not breathing.",
            "Give second naloxone dose after 2–3 minutes if no response.",
        ],
        "diabetic_hypoglycemia": [
            "Give fast-acting sugar: glucose tablets, juice, or regular soda.",
            "Have person sit down safely.",
            "Wait 15 minutes and reassess symptoms.",
            "Give a snack with protein once improved.",
            "Call 911 if person loses consciousness.",
            "Do not give food or drink if unconscious.",
        ],
        "drowning": [
            "Call 911 immediately.",
            "Remove person from water carefully.",
            "Lay on back on firm surface.",
            "Tilt head back, lift chin to open airway.",
            "Give 2 rescue breaths, then begin CPR.",
            "Continue CPR until EMS arrives.",
        ],
        "heat_stroke": [
            "Call 911 immediately.",
            "Move person to shade or air conditioning.",
            "Remove excess clothing.",
            "Apply cool wet cloths to neck, armpits, and groin.",
            "Fan vigorously to accelerate cooling.",
            "Give cool water only if person is conscious and can swallow.",
        ],
        "fracture": [
            "Keep person still and calm.",
            "Do not try to straighten the injured limb.",
            "Immobilize limb in position found with padding.",
            "Apply ice pack wrapped in cloth to reduce swelling.",
            "Elevate limb if possible.",
            "Seek medical care for X-ray evaluation.",
        ],
        "eye_injury": [
            "Do not rub the eye.",
            "Flush eye with clean water for 15–20 minutes if chemical exposure.",
            "Cover eye loosely with clean cloth — do not press.",
            "Do not try to remove embedded objects.",
            "Seek emergency ophthalmology care.",
        ],
        "nosebleed": [
            "Sit upright and lean slightly forward.",
            "Pinch soft part of nose firmly for 10–15 minutes.",
            "Do not tilt head back.",
            "Apply cold compress to bridge of nose.",
            "Seek medical care if bleeding does not stop after 30 minutes.",
        ],
        "electric_shock": [
            "Do NOT touch victim until power source is confirmed off.",
            "Turn off power at main breaker immediately.",
            "Call 911 immediately.",
            "Check breathing and pulse once power is off.",
            "Begin CPR if not breathing.",
            "All electric shock victims need hospital evaluation.",
        ],
        "snakebite": [
            "Call 911 immediately.",
            "Keep calm and still — movement spreads venom faster.",
            "Immobilize bitten limb below heart level.",
            "Remove rings, watches, and tight clothing near bite.",
            "Do NOT cut, suck, or apply tourniquet to bite.",
            "Do NOT apply ice.",
        ],
        "sepsis": [
            "Call 911 immediately.",
            "Keep person lying down and warm.",
            "Monitor breathing and consciousness.",
            "Do not give food or water.",
            "Note time symptoms started for EMS.",
            "Stay with person until ambulance arrives.",
        ],
        "medical_condition": [
            "Keep person calm and comfortable.",
            "Monitor vital signs: breathing, pulse, consciousness.",
            "Do not give food, water, or medication without medical advice.",
            "Call a healthcare provider or urgent care line.",
            "Seek medical evaluation if symptoms worsen.",
        ],
    }

    steps = step_library.get(condition_slug, step_library["medical_condition"])

    # For critical/high, always include "Call 911" as first step
    if severity in ("critical", "high") and not steps[0].startswith("Call 911"):
        steps = ["Call 911 immediately."] + steps

    # Shuffle non-critical steps slightly for variety (keep first 2 fixed)
    if len(steps) > 4:
        fixed = steps[:2]
        variable = steps[2:]
        rng.shuffle(variable)
        steps = fixed + variable

    # Return 4–6 steps
    n = rng.randint(4, min(6, len(steps)))
    return steps[:n]


def build_warn_message(condition_slug: str, severity: str) -> str:
    """Return a concise warning for critical/high conditions."""
    warnings = {
        "cardiac_arrest":        "Brain damage begins in 4 minutes without CPR.",
        "chest_pain":            "Possible heart attack — every minute of delay causes more damage.",
        "breathing_difficulty":  "Airway compromise can be fatal within minutes.",
        "choking_adult":         "Complete airway obstruction causes unconsciousness in minutes.",
        "anaphylaxis":           "Anaphylaxis without epinephrine can be fatal within minutes.",
        "stroke":                "Stroke treatment window is 3–4.5 hours — every minute counts.",
        "seizure":               "Seizure lasting over 5 minutes requires emergency intervention.",
        "head_injury":           "Brain bleed risk — do not give blood thinners or aspirin.",
        "spinal_injury":         "Moving a spinal injury victim can cause permanent paralysis.",
        "severe_bleeding":       "Severe arterial bleeding can cause death in minutes.",
        "opioid_overdose":       "Naloxone wears off before opioids — hospital evaluation required.",
        "drowning":              "Secondary drowning can occur hours later — ER evaluation required.",
        "heat_stroke":           "Core temperature must be reduced immediately.",
        "electric_shock":        "Do not approach until power is confirmed off.",
        "snakebite":             "Treat all snakebites as potentially venomous.",
        "sepsis":                "Septic shock can progress to organ failure rapidly.",
        "diabetic_hypoglycemia": "Severe hypoglycemia with altered consciousness needs IV glucose.",
    }
    if severity in ("critical", "high"):
        return warnings.get(condition_slug, "Seek emergency medical care immediately.")
    return ""


def build_next_question(condition_slug: str, severity: str) -> str:
    """Return a clarifying follow-up question if it would change triage."""
    questions = {
        "cardiac_arrest":        "",
        "chest_pain":            "Is the person allergic to aspirin?",
        "breathing_difficulty":  "Is the person still breathing on their own?",
        "choking_adult":         "Can the person make any sound or cough at all?",
        "anaphylaxis":           "Do they have an epinephrine auto-injector available?",
        "stroke":                "When exactly did the symptoms start?",
        "seizure":               "Does the person have a known seizure disorder?",
        "head_injury":           "Did they lose consciousness, even briefly?",
        "spinal_injury":         "Can they feel and move their hands and feet?",
        "severe_bleeding":       "Is the blood spurting rhythmically or flowing steadily?",
        "burn_second_degree":    "How large is the burned area — bigger or smaller than the palm?",
        "opioid_overdose":       "Is naloxone (Narcan) available?",
        "diabetic_hypoglycemia": "Is the person conscious and able to swallow safely?",
        "fracture":              "Is the skin broken or is there any bone visible?",
        "snakebite":             "Can you describe the snake? Is swelling spreading?",
        "sepsis":                "How long have the symptoms been present?",
        "medical_condition":     "Are symptoms getting worse or staying the same?",
    }
    if severity == "critical":
        return ""  # No time for questions in critical cases
    return questions.get(condition_slug, "")


def build_triage_response(condition_slug: str, severity: str,
                           call_ambulance: bool, steps: list,
                           estimated_time: int) -> str:
    """Serialize the triage response as a JSON string."""
    response = {
        "severity": severity,
        "call_ambulance": call_ambulance,
        "steps": steps,
        "estimated_time_minutes": estimated_time,
        "condition": condition_slug,
        "warn_message": build_warn_message(condition_slug, severity),
        "next_question": build_next_question(condition_slug, severity),
    }
    return json.dumps(response, ensure_ascii=False)


def estimate_time(severity: str, condition_slug: str) -> int:
    """Return realistic estimated_time_minutes."""
    if severity == "critical":
        return 0
    time_map = {
        "burn_second_degree":    20,
        "nosebleed":             15,
        "fracture":              15,
        "eye_injury":            15,
        "diabetic_hypoglycemia": 15,
        "heat_stroke":           20,
        "head_injury":           20,
        "medical_condition":     30,
    }
    if severity == "high":
        return 0
    return time_map.get(condition_slug, 20)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN CONVERSION FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def convert_entry(entry: dict) -> Optional[dict]:
    """
    Convert a single MedQA entry into a ResqAI conversational example.
    Returns None if the entry should be skipped.
    """
    question = entry.get("question", "")
    answer = entry.get("answer", "")
    metamap_phrases = entry.get("metamap_phrases", [])

    if not question or not answer:
        return None

    # Deterministic RNG per entry
    rng = random.Random(_seed_from_text(question))

    # Classify
    condition_slug, severity, call_ambulance = classify_entry(
        question, answer, metamap_phrases
    )

    # Build user message
    user_message = build_user_message(
        question, answer, metamap_phrases, condition_slug, rng
    )

    # Build steps
    steps = build_steps_for_condition(condition_slug, severity, answer, rng)

    # Estimated time
    estimated_time = estimate_time(severity, condition_slug)

    # Build assistant JSON response
    assistant_content = build_triage_response(
        condition_slug, severity, call_ambulance, steps, estimated_time
    )

    return {
        "messages": [
            {"role": "system",    "content": SYSTEM_PROMPT},
            {"role": "user",      "content": user_message},
            {"role": "assistant", "content": assistant_content},
        ]
    }


def process_file(input_path: Path, output_path: Path) -> int:
    """Process a single JSONL file. Returns number of converted entries."""
    converted = 0
    skipped = 0

    with open(input_path, "r", encoding="utf-8") as fin, \
         open(output_path, "w", encoding="utf-8") as fout:

        for line_num, line in enumerate(fin, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                result = convert_entry(entry)
                if result is not None:
                    fout.write(json.dumps(result, ensure_ascii=False) + "\n")
                    converted += 1
                else:
                    skipped += 1
            except json.JSONDecodeError as e:
                logger.warning(f"Line {line_num}: JSON decode error: {e}")
                skipped += 1
            except Exception as e:
                logger.warning(f"Line {line_num}: Unexpected error: {e}")
                skipped += 1

    logger.info(f"{input_path.name}: {converted} converted, {skipped} skipped")
    return converted


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Preprocess MedQA JSONL into ResqAI conversational format"
    )
    parser.add_argument(
        "--train", type=str,
        default="phrases_no_exclude_train.jsonl",
        help="Path to MedQA training JSONL"
    )
    parser.add_argument(
        "--test", type=str,
        default="phrases_no_exclude_test.jsonl",
        help="Path to MedQA test JSONL"
    )
    parser.add_argument(
        "--output_dir", type=str,
        default="datasets",
        help="Output directory for processed files"
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    for input_file, output_name in [
        (args.train, "medqa_train_converted.jsonl"),
        (args.test,  "medqa_test_converted.jsonl"),
    ]:
        input_path = Path(input_file)
        if not input_path.exists():
            logger.warning(f"File not found: {input_path}, skipping.")
            continue
        output_path = output_dir / output_name
        n = process_file(input_path, output_path)
        total += n
        logger.info(f"Wrote {n} entries to {output_path}")

    logger.info(f"Total converted: {total} entries")


if __name__ == "__main__":
    main()
