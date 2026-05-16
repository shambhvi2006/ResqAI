#!/usr/bin/env python3
"""
combine_datasets.py
-------------------
Merges and augments all data sources into a single hybrid training dataset.

Final composition target:
  - 50% synthetic emergency triage data  (resqai_dataset.json)
  - 35% converted MedQA reasoning data   (medqa_*_converted.jsonl)
  - 15% augmented protocol-based examples (generated here)

Augmentation strategies applied:
  1. Multilingual paraphrase (Hindi, Urdu, Spanish user messages)
  2. Noisy/typo text augmentation (simulates panicked texting)
  3. Emotional panic variation (all-caps, fragmented sentences)
  4. Severity-balanced oversampling for underrepresented classes

Output:
  datasets/hybrid_train.jsonl
  datasets/hybrid_eval.jsonl
  datasets/dataset_statistics.json
"""

import json
import random
import re
import hashlib
import argparse
import logging
from pathlib import Path
from collections import Counter
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are ResqAI, an emergency first-aid assistant. "
    "Always respond ONLY with structured JSON emergency triage output. "
    "Prioritize immediate stabilization and medically safe first-aid guidance. "
    "Be concise, calm, and decisive. "
    "Respond in the same language as the user."
)

REQUIRED_FIELDS = {
    "severity", "call_ambulance", "steps",
    "estimated_time_minutes", "condition",
    "warn_message", "next_question"
}
VALID_SEVERITIES = {"critical", "high", "moderate", "low"}

# ─────────────────────────────────────────────────────────────────────────────
# AUGMENTATION HELPERS
# ─────────────────────────────────────────────────────────────────────────────

TYPO_SUBSTITUTIONS = {
    "help": ["hlep", "helo", "hepl"],
    "breathing": ["breathng", "brething", "breating"],
    "please": ["plese", "pls", "plz"],
    "emergency": ["emergeny", "emergancy", "emrgency"],
    "hospital": ["hosptal", "hospitl"],
    "ambulance": ["ambulnce", "amblance"],
    "unconscious": ["unconcious", "unconcius"],
    "bleeding": ["bleeing", "bleding"],
    "collapsed": ["colapsed", "collpased"],
    "breathing": ["breathng", "brething"],
}

PANIC_PREFIXES = [
    "HELP!! ", "PLEASE HELP ", "EMERGENCY!! ", "HELP ME ",
    "SOS!! ", "URGENT!! ", "HELP PLEASE ",
]

CALM_PREFIXES = [
    "I need assistance. ", "Quick question — ", "Seeking advice: ",
    "Not sure what to do — ", "Can you help? ",
]

# Multilingual templates: (language_code, template)
# These wrap an English symptom description in a multilingual context
MULTILINGUAL_TEMPLATES = [
    # Hindi
    ("hi", "मेरे {relation} को {symptom} हो रहा है, मैं क्या करूं?"),
    ("hi", "HELP! {relation} {symptom} से पीड़ित है, तुरंत बताएं!"),
    # Urdu
    ("ur", "میرے {relation} کو {symptom} ہو رہا ہے، مدد کریں!"),
    ("ur", "فوری مدد چاہیے! {relation} کو {symptom} ہے۔"),
    # Spanish
    ("es", "¡Ayuda! Mi {relation} tiene {symptom}. ¿Qué hago?"),
    ("es", "Emergencia! {relation} con {symptom}, necesito ayuda ahora."),
]

RELATION_WORDS = {
    "hi": ["पिताजी", "माँ", "बच्चा", "दोस्त", "पति", "पत्नी", "दादाजी"],
    "ur": ["والد", "والدہ", "بچہ", "دوست", "شوہر", "بیوی", "دادا"],
    "es": ["padre", "madre", "hijo", "amigo", "esposo", "esposa", "abuelo"],
}

SYMPTOM_TRANSLATIONS = {
    "cardiac_arrest":        {"hi": "दिल का दौरा", "ur": "دل کا دورہ", "es": "paro cardíaco"},
    "chest_pain":            {"hi": "सीने में दर्द", "ur": "سینے میں درد", "es": "dolor en el pecho"},
    "stroke":                {"hi": "लकवा", "ur": "فالج", "es": "derrame cerebral"},
    "choking_adult":         {"hi": "गला रुकना", "ur": "گلا رکنا", "es": "atragantamiento"},
    "choking_child":         {"hi": "बच्चे का गला रुकना", "ur": "بچے کا گلا رکنا", "es": "niño atragantado"},
    "severe_bleeding":       {"hi": "बहुत खून बह रहा है", "ur": "بہت خون بہہ رہا ہے", "es": "hemorragia severa"},
    "burn_second_degree":    {"hi": "जलन", "ur": "جلن", "es": "quemadura"},
    "anaphylaxis":           {"hi": "एलर्जी का दौरा", "ur": "الرجی کا دورہ", "es": "reacción alérgica grave"},
    "seizure":               {"hi": "दौरा", "ur": "دورہ", "es": "convulsión"},
    "diabetic_hypoglycemia": {"hi": "शुगर कम होना", "ur": "شوگر کم ہونا", "es": "azúcar baja"},
    "opioid_overdose":       {"hi": "ओवरडोज़", "ur": "اوور ڈوز", "es": "sobredosis"},
    "snakebite":             {"hi": "सांप का काटना", "ur": "سانپ کا کاٹنا", "es": "mordedura de serpiente"},
    "drowning":              {"hi": "डूबना", "ur": "ڈوبنا", "es": "ahogamiento"},
    "heat_stroke":           {"hi": "लू लगना", "ur": "لو لگنا", "es": "golpe de calor"},
    "fracture":              {"hi": "हड्डी टूटना", "ur": "ہڈی ٹوٹنا", "es": "fractura"},
    "head_injury":           {"hi": "सिर में चोट", "ur": "سر میں چوٹ", "es": "lesión en la cabeza"},
    "electric_shock":        {"hi": "बिजली का झटका", "ur": "بجلی کا جھٹکا", "es": "descarga eléctrica"},
    "nosebleed":             {"hi": "नाक से खून", "ur": "ناک سے خون", "es": "hemorragia nasal"},
    "spinal_injury":         {"hi": "रीढ़ की हड्डी में चोट", "ur": "ریڑھ کی ہڈی میں چوٹ", "es": "lesión espinal"},
    "medical_condition":     {"hi": "तबीयत खराब", "ur": "طبیعت خراب", "es": "malestar"},
}


def _seed(text: str) -> int:
    return int(hashlib.md5(text.encode()).hexdigest(), 16) % (2**31)


def apply_typos(text: str, rng: random.Random, rate: float = 0.15) -> str:
    """Randomly introduce typos into a text string."""
    words = text.split()
    result = []
    for word in words:
        word_lower = word.lower()
        if word_lower in TYPO_SUBSTITUTIONS and rng.random() < rate:
            result.append(rng.choice(TYPO_SUBSTITUTIONS[word_lower]))
        else:
            result.append(word)
    return " ".join(result)


def apply_panic_style(text: str, rng: random.Random) -> str:
    """Convert text to panicked all-caps style."""
    style = rng.choice(["caps", "prefix", "both"])
    if style == "caps":
        return text.upper()
    elif style == "prefix":
        return rng.choice(PANIC_PREFIXES) + text
    else:
        return rng.choice(PANIC_PREFIXES) + text.upper()


def apply_calm_style(text: str, rng: random.Random) -> str:
    """Add a calm prefix."""
    return rng.choice(CALM_PREFIXES) + text


def build_multilingual_user_message(condition_slug: str, rng: random.Random) -> Optional[str]:
    """Build a multilingual user message for a given condition."""
    translations = SYMPTOM_TRANSLATIONS.get(condition_slug)
    if not translations:
        return None

    lang_code, template = rng.choice(MULTILINGUAL_TEMPLATES)
    symptom = translations.get(lang_code)
    if not symptom:
        return None

    relations = RELATION_WORDS.get(lang_code, ["person"])
    relation = rng.choice(relations)

    return template.format(relation=relation, symptom=symptom)


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

def validate_entry(entry: dict) -> tuple:
    """
    Validate a single dataset entry.
    Returns (is_valid: bool, error_message: str).
    """
    if "messages" not in entry:
        return False, "Missing 'messages' key"

    messages = entry["messages"]
    if len(messages) < 3:
        return False, f"Expected 3 messages, got {len(messages)}"

    roles = [m.get("role") for m in messages]
    if roles != ["system", "user", "assistant"]:
        return False, f"Unexpected roles: {roles}"

    assistant_content = messages[2].get("content", "")
    if not assistant_content:
        return False, "Empty assistant content"

    try:
        parsed = json.loads(assistant_content)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in assistant content: {e}"

    # Check required fields
    missing = REQUIRED_FIELDS - set(parsed.keys())
    if missing:
        return False, f"Missing fields: {missing}"

    # Check severity
    if parsed.get("severity") not in VALID_SEVERITIES:
        return False, f"Invalid severity: {parsed.get('severity')}"

    # Check call_ambulance is boolean
    if not isinstance(parsed.get("call_ambulance"), bool):
        return False, "call_ambulance must be boolean"

    # Check steps
    steps = parsed.get("steps", [])
    if not (4 <= len(steps) <= 8):
        return False, f"Step count {len(steps)} out of range [4, 8]"

    for step in steps:
        if len(step.split()) > 15:
            return False, f"Step too long (>15 words): {step[:50]}"

    # Check for medication dosages (safety check)
    dangerous_patterns = [
        r"\d+\s*mg\b", r"\d+\s*mcg\b", r"\d+\s*ml\b",
        r"\d+\s*units?\b", r"\d+\s*tablets?\b",
    ]
    full_text = json.dumps(parsed)
    for pattern in dangerous_patterns:
        if re.search(pattern, full_text, re.IGNORECASE):
            return False, f"Possible medication dosage found: {pattern}"

    return True, ""


def deduplicate(entries: list) -> list:
    """Remove duplicate entries based on user message hash."""
    seen = set()
    unique = []
    for entry in entries:
        user_msg = entry["messages"][1]["content"]
        h = hashlib.md5(user_msg.encode()).hexdigest()
        if h not in seen:
            seen.add(h)
            unique.append(entry)
    return unique


# ─────────────────────────────────────────────────────────────────────────────
# LOADERS
# ─────────────────────────────────────────────────────────────────────────────

def load_resqai_dataset(path: Path) -> list:
    """Load resqai_dataset.json and convert to messages format."""
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    entries = []
    for item in raw:
        convs = item.get("conversations", [])
        if len(convs) < 2:
            continue
        entry = {
            "messages": [
                {"role": "system",    "content": SYSTEM_PROMPT},
                {"role": "user",      "content": convs[0]["content"]},
                {"role": "assistant", "content": convs[1]["content"]},
            ]
        }
        is_valid, err = validate_entry(entry)
        if is_valid:
            entries.append(entry)
        else:
            logger.debug(f"Skipping resqai entry: {err}")

    logger.info(f"Loaded {len(entries)} valid entries from {path.name}")
    return entries


def load_jsonl(path: Path) -> list:
    """Load a JSONL file and validate each entry."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                is_valid, err = validate_entry(entry)
                if is_valid:
                    entries.append(entry)
                else:
                    logger.debug(f"Line {line_num}: {err}")
            except json.JSONDecodeError:
                logger.debug(f"Line {line_num}: JSON decode error")
    logger.info(f"Loaded {len(entries)} valid entries from {path.name}")
    return entries


# ─────────────────────────────────────────────────────────────────────────────
# AUGMENTATION
# ─────────────────────────────────────────────────────────────────────────────

def augment_entry(entry: dict, rng: random.Random, strategy: str) -> Optional[dict]:
    """
    Apply an augmentation strategy to an entry.
    Returns a new entry or None if augmentation is not applicable.
    """
    messages = entry["messages"]
    user_msg = messages[1]["content"]
    assistant_content = messages[2]["content"]

    try:
        parsed = json.loads(assistant_content)
    except json.JSONDecodeError:
        return None

    condition_slug = parsed.get("condition", "medical_condition")

    if strategy == "typo":
        new_user = apply_typos(user_msg, rng)
        if new_user == user_msg:
            return None
    elif strategy == "panic":
        new_user = apply_panic_style(user_msg, rng)
    elif strategy == "calm":
        new_user = apply_calm_style(user_msg, rng)
    elif strategy == "multilingual":
        new_user = build_multilingual_user_message(condition_slug, rng)
        if not new_user:
            return None
    else:
        return None

    return {
        "messages": [
            messages[0],
            {"role": "user", "content": new_user},
            messages[2],
        ]
    }


def generate_augmented_entries(base_entries: list, target_count: int,
                                rng: random.Random) -> list:
    """Generate augmented entries to reach target_count."""
    strategies = ["typo", "panic", "calm", "multilingual"]
    augmented = []
    attempts = 0
    max_attempts = target_count * 10

    while len(augmented) < target_count and attempts < max_attempts:
        entry = rng.choice(base_entries)
        strategy = rng.choice(strategies)
        new_entry = augment_entry(entry, rng, strategy)
        if new_entry:
            is_valid, _ = validate_entry(new_entry)
            if is_valid:
                augmented.append(new_entry)
        attempts += 1

    logger.info(f"Generated {len(augmented)} augmented entries")
    return augmented


# ─────────────────────────────────────────────────────────────────────────────
# STATISTICS
# ─────────────────────────────────────────────────────────────────────────────

def compute_statistics(entries: list) -> dict:
    """Compute dataset statistics for dataset_statistics.json."""
    severity_counts = Counter()
    condition_counts = Counter()
    call_ambulance_counts = Counter()
    token_lengths = []
    sources = Counter()

    for entry in entries:
        messages = entry["messages"]
        try:
            parsed = json.loads(messages[2]["content"])
            severity_counts[parsed.get("severity", "unknown")] += 1
            condition_counts[parsed.get("condition", "unknown")] += 1
            call_ambulance_counts[str(parsed.get("call_ambulance", "unknown"))] += 1
        except json.JSONDecodeError:
            pass

        # Approximate token length (words / 0.75)
        total_words = sum(len(m["content"].split()) for m in messages)
        token_lengths.append(int(total_words / 0.75))

        source = entry.get("_source", "unknown")
        sources[source] += 1

    avg_tokens = sum(token_lengths) / len(token_lengths) if token_lengths else 0
    max_tokens = max(token_lengths) if token_lengths else 0
    min_tokens = min(token_lengths) if token_lengths else 0

    return {
        "total_entries": len(entries),
        "severity_distribution": dict(severity_counts),
        "condition_distribution": dict(condition_counts),
        "call_ambulance_distribution": dict(call_ambulance_counts),
        "token_length_stats": {
            "average": round(avg_tokens, 1),
            "max": max_tokens,
            "min": min_tokens,
        },
        "source_distribution": dict(sources),
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Combine and augment datasets for ResqAI hybrid training"
    )
    parser.add_argument("--resqai",      default="resqai_dataset.json")
    parser.add_argument("--medqa_train", default="datasets/medqa_train_converted.jsonl")
    parser.add_argument("--medqa_test",  default="datasets/medqa_test_converted.jsonl")
    parser.add_argument("--output_dir",  default="datasets")
    parser.add_argument("--eval_ratio",  type=float, default=0.1)
    parser.add_argument("--seed",        type=int,   default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Load all sources ──────────────────────────────────────────────────────
    resqai_entries = []
    if Path(args.resqai).exists():
        resqai_entries = load_resqai_dataset(Path(args.resqai))
        for e in resqai_entries:
            e["_source"] = "synthetic_triage"

    medqa_entries = []
    for path in [args.medqa_train, args.medqa_test]:
        if Path(path).exists():
            batch = load_jsonl(Path(path))
            for e in batch:
                e["_source"] = "medqa_converted"
            medqa_entries.extend(batch)

    if not resqai_entries and not medqa_entries:
        logger.error("No data found. Run preprocess_medqa.py first.")
        return

    # ── Compute target sizes ──────────────────────────────────────────────────
    # Target: 50% synthetic, 35% medqa, 15% augmented
    total_base = len(resqai_entries) + len(medqa_entries)
    # Augmented = 15/85 * base_total
    augmented_target = max(int(total_base * 0.15 / 0.85), 50)

    logger.info(f"Base entries: {total_base} "
                f"(synthetic={len(resqai_entries)}, medqa={len(medqa_entries)})")
    logger.info(f"Augmentation target: {augmented_target}")

    # ── Generate augmented entries ────────────────────────────────────────────
    all_base = resqai_entries + medqa_entries
    augmented_entries = generate_augmented_entries(all_base, augmented_target, rng)
    for e in augmented_entries:
        e["_source"] = "augmented"

    # ── Combine and deduplicate ───────────────────────────────────────────────
    all_entries = resqai_entries + medqa_entries + augmented_entries
    all_entries = deduplicate(all_entries)
    logger.info(f"After deduplication: {len(all_entries)} entries")

    # ── Shuffle ───────────────────────────────────────────────────────────────
    rng.shuffle(all_entries)

    # ── Train / eval split ────────────────────────────────────────────────────
    eval_size = max(int(len(all_entries) * args.eval_ratio), 20)
    eval_entries = all_entries[:eval_size]
    train_entries = all_entries[eval_size:]

    logger.info(f"Train: {len(train_entries)}, Eval: {len(eval_entries)}")

    # ── Write outputs ─────────────────────────────────────────────────────────
    def write_jsonl(entries, path):
        with open(path, "w", encoding="utf-8") as f:
            for entry in entries:
                # Remove internal _source key before writing
                clean = {k: v for k, v in entry.items() if not k.startswith("_")}
                f.write(json.dumps(clean, ensure_ascii=False) + "\n")

    train_path = output_dir / "hybrid_train.jsonl"
    eval_path  = output_dir / "hybrid_eval.jsonl"
    write_jsonl(train_entries, train_path)
    write_jsonl(eval_entries,  eval_path)
    logger.info(f"Wrote train → {train_path}")
    logger.info(f"Wrote eval  → {eval_path}")

    # ── Statistics ────────────────────────────────────────────────────────────
    stats = compute_statistics(all_entries)
    stats_path = output_dir / "dataset_statistics.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    logger.info(f"Wrote statistics → {stats_path}")

    # Print summary
    print("\n" + "="*60)
    print("HYBRID DATASET SUMMARY")
    print("="*60)
    print(f"  Total entries:    {stats['total_entries']}")
    print(f"  Train:            {len(train_entries)}")
    print(f"  Eval:             {len(eval_entries)}")
    print(f"  Severity dist:    {stats['severity_distribution']}")
    print(f"  Source dist:      {stats['source_distribution']}")
    print(f"  Avg token length: {stats['token_length_stats']['average']}")
    print("="*60)


if __name__ == "__main__":
    main()
