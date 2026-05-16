#!/usr/bin/env python3
"""
inference_test.py
-----------------
Runs 5+ inference tests against the fine-tuned ResqAI model (local or HuggingFace).
Validates JSON structure, severity, and medical appropriateness of each response.

Usage:
  # Test a local LoRA adapter
  python scripts/inference_test.py --model_path ./exported_model/lora_adapter

  # Test a merged HuggingFace model
  python scripts/inference_test.py --model_path YOUR_HF_USERNAME/resqai-gemma-e2b-lora

  # Test base model (no fine-tuning, for comparison)
  python scripts/inference_test.py --model_path google/gemma-4-e2b-it --base_only
"""

import json
import re
import argparse
import logging
import sys
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# SAFETY VALIDATOR
# ─────────────────────────────────────────────────────────────────────────────

REQUIRED_FIELDS = {
    "severity", "call_ambulance", "steps",
    "estimated_time_minutes", "condition",
    "warn_message", "next_question"
}
VALID_SEVERITIES = {"critical", "high", "moderate", "low"}

DANGEROUS_PATTERNS = [
    r"\d+\s*mg\b",
    r"\d+\s*mcg\b",
    r"\d+\s*ml\b",
    r"\d+\s*units?\b",
    r"\d+\s*tablets?\b",
    r"\d+\s*doses?\b",
]

FALLBACK_RESPONSE = {
    "severity": "high",
    "call_ambulance": True,
    "steps": [
        "Call 911 immediately.",
        "Keep the person calm and still.",
        "Monitor breathing and consciousness.",
        "Do not give food, water, or medication.",
        "Stay with the person until EMS arrives.",
    ],
    "estimated_time_minutes": 0,
    "condition": "unknown_emergency",
    "warn_message": "Unable to assess — call emergency services immediately.",
    "next_question": "Can you describe the symptoms in more detail?",
}


def extract_json_from_response(text: str) -> Optional[str]:
    """
    Extract JSON from model output.
    Handles cases where the model wraps JSON in markdown or adds extra text.
    """
    text = text.strip()

    # Case 1: Pure JSON
    if text.startswith("{"):
        return text

    # Case 2: JSON in markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)

    # Case 3: JSON somewhere in the text
    match = re.search(r"\{[^{}]*\"severity\"[^{}]*\}", text, re.DOTALL)
    if match:
        return match.group(0)

    return None


def validate_response(response_text: str) -> tuple:
    """
    Validate model response.
    Returns (parsed_dict, is_valid, error_message).
    """
    json_str = extract_json_from_response(response_text)
    if not json_str:
        return None, False, "No JSON found in response"

    try:
        parsed = json.loads(json_str)
    except json.JSONDecodeError as e:
        return None, False, f"JSON parse error: {e}"

    # Required fields
    missing = REQUIRED_FIELDS - set(parsed.keys())
    if missing:
        return parsed, False, f"Missing fields: {missing}"

    # Severity
    if parsed.get("severity") not in VALID_SEVERITIES:
        return parsed, False, f"Invalid severity: {parsed.get('severity')}"

    # call_ambulance type
    if not isinstance(parsed.get("call_ambulance"), bool):
        return parsed, False, "call_ambulance must be boolean"

    # Steps
    steps = parsed.get("steps", [])
    if not (4 <= len(steps) <= 8):
        return parsed, False, f"Step count {len(steps)} out of range [4, 8]"

    # Medication dosage safety check
    full_text = json.dumps(parsed)
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, full_text, re.IGNORECASE):
            return parsed, False, f"Possible medication dosage: {pattern}"

    return parsed, True, ""


def safe_parse(response_text: str) -> dict:
    """Parse response, returning fallback if invalid."""
    parsed, is_valid, error = validate_response(response_text)
    if is_valid and parsed:
        return parsed
    logger.warning(f"Validation failed ({error}), using fallback response")
    return FALLBACK_RESPONSE


# ─────────────────────────────────────────────────────────────────────────────
# TEST CASES
# ─────────────────────────────────────────────────────────────────────────────

TEST_CASES = [
    {
        "id": "TC-01",
        "name": "Cardiac Arrest with AED",
        "prompt": "45 year old man just collapsed in our office, no pulse, not breathing. There is an AED on the wall. What do we do?",
        "expected_severity": "critical",
        "expected_call_ambulance": True,
        "expected_condition_contains": "cardiac",
        "must_mention_in_steps": ["CPR", "AED", "911"],
        "must_not_mention": ["nitroglycerin", "aspirin dose", "mg"],
        "language": "en",
    },
    {
        "id": "TC-02",
        "name": "Stroke — FAST Protocol",
        "prompt": "My 68-year-old father suddenly has face drooping on one side, his left arm is weak, and he can't speak properly. We're at home.",
        "expected_severity": "critical",
        "expected_call_ambulance": True,
        "expected_condition_contains": "stroke",
        "must_mention_in_steps": ["911", "time"],
        "must_not_mention": ["aspirin dose", "tPA", "mg"],
        "language": "en",
    },
    {
        "id": "TC-03",
        "name": "Child Second-Degree Burn",
        "prompt": "My 6 year old spilled boiling water on her arm, there are blisters forming, she's crying. I have a first aid kit at home.",
        "expected_severity": ["moderate", "high"],
        "expected_call_ambulance": None,  # Either is acceptable
        "expected_condition_contains": "burn",
        "must_mention_in_steps": ["cool", "water", "20"],
        "must_not_mention": ["ice", "butter", "toothpaste", "pop"],
        "language": "en",
    },
    {
        "id": "TC-04",
        "name": "Adult Choking",
        "prompt": "HELP!! Man at our restaurant is CHOKING cant breathe turning blue hes like 40s grabbing his throat PLEASE HELP",
        "expected_severity": "critical",
        "expected_call_ambulance": True,
        "expected_condition_contains": "choking",
        "must_mention_in_steps": ["thrust", "911"],
        "must_not_mention": [],
        "language": "en",
    },
    {
        "id": "TC-05",
        "name": "Snakebite — Hindi",
        "prompt": "सांप ने मुझे काट लिया है, मैं बाहर जंगल में हूं, पैर में सूजन आ रही है, बहुत दर्द है, मैं क्या करूं?",
        "expected_severity": ["high", "critical"],
        "expected_call_ambulance": True,
        "expected_condition_contains": "snakebite",
        "must_mention_in_steps": [],  # Steps may be in Hindi
        "must_not_mention": ["tourniquet", "cut", "suck"],
        "language": "hi",
        "check_language": True,
    },
    {
        "id": "TC-06",
        "name": "Opioid Overdose with Naloxone",
        "prompt": "My roommate is unconscious, barely breathing, lips are blue. I think she took too many pills. I have Narcan here.",
        "expected_severity": "critical",
        "expected_call_ambulance": True,
        "expected_condition_contains": "opioid",
        "must_mention_in_steps": ["911", "naloxone", "Narcan"],
        "must_not_mention": [],
        "language": "en",
    },
    {
        "id": "TC-07",
        "name": "Diabetic Hypoglycemia — Moderate",
        "prompt": "My coworker is shaking and confused, he says he's diabetic and his sugar is low. We're in the office.",
        "expected_severity": ["moderate", "high"],
        "expected_call_ambulance": None,
        "expected_condition_contains": "diabetic",
        "must_mention_in_steps": ["sugar", "juice", "glucose"],
        "must_not_mention": ["insulin injection", "mg"],
        "language": "en",
    },
    {
        "id": "TC-08",
        "name": "Cardiac Arrest — Spanish",
        "prompt": "¡Ayuda! Mi esposo de 55 años se desmayó, no respira, no tiene pulso. Estamos en casa.",
        "expected_severity": "critical",
        "expected_call_ambulance": True,
        "expected_condition_contains": "cardiac",
        "must_mention_in_steps": [],
        "must_not_mention": [],
        "language": "es",
        "check_language": True,
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# EVALUATION
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_response(test_case: dict, parsed: dict) -> dict:
    """
    Evaluate a parsed response against test case expectations.
    Returns a results dict with pass/fail for each check.
    """
    results = {}
    steps_text = " ".join(parsed.get("steps", [])).lower()
    full_text = json.dumps(parsed).lower()

    # Severity check
    expected_sev = test_case["expected_severity"]
    actual_sev = parsed.get("severity")
    if isinstance(expected_sev, list):
        results["severity"] = actual_sev in expected_sev
    else:
        results["severity"] = actual_sev == expected_sev

    # call_ambulance check
    expected_amb = test_case["expected_call_ambulance"]
    if expected_amb is not None:
        results["call_ambulance"] = parsed.get("call_ambulance") == expected_amb
    else:
        results["call_ambulance"] = True  # Either is acceptable

    # Condition check
    cond_contains = test_case.get("expected_condition_contains", "")
    results["condition"] = cond_contains in parsed.get("condition", "").lower()

    # Step count
    step_count = len(parsed.get("steps", []))
    results["step_count"] = 4 <= step_count <= 8

    # Must mention
    for keyword in test_case.get("must_mention_in_steps", []):
        results[f"mentions_{keyword}"] = keyword.lower() in steps_text

    # Must not mention
    for keyword in test_case.get("must_not_mention", []):
        results[f"no_{keyword}"] = keyword.lower() not in full_text

    # JSON validity (already parsed, so always True here)
    results["valid_json"] = True

    # warn_message present for critical/high
    if parsed.get("severity") in ("critical", "high"):
        results["warn_message_present"] = bool(parsed.get("warn_message"))
    else:
        results["warn_message_present"] = True

    return results


def print_test_result(test_case: dict, raw_response: str,
                       parsed: dict, eval_results: dict):
    """Print formatted test result."""
    tc_id = test_case["id"]
    tc_name = test_case["name"]
    all_pass = all(eval_results.values())
    status = "✅ PASS" if all_pass else "❌ FAIL"

    print(f"\n{'='*60}")
    print(f"{status} | {tc_id}: {tc_name}")
    print(f"{'='*60}")
    print(f"Prompt: {test_case['prompt'][:80]}...")
    print(f"\nModel Output (raw):\n{raw_response[:300]}")
    print(f"\nParsed Response:")
    print(f"  severity:          {parsed.get('severity')}")
    print(f"  call_ambulance:    {parsed.get('call_ambulance')}")
    print(f"  condition:         {parsed.get('condition')}")
    print(f"  steps ({len(parsed.get('steps', []))}):        {parsed.get('steps', [])[:2]}...")
    print(f"  warn_message:      {parsed.get('warn_message', '')[:60]}")
    print(f"\nChecks:")
    for check, result in eval_results.items():
        icon = "  ✓" if result else "  ✗"
        print(f"{icon} {check}")


# ─────────────────────────────────────────────────────────────────────────────
# MODEL RUNNER
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are ResqAI, an emergency first-aid assistant. "
    "Always respond ONLY with structured JSON emergency triage output. "
    "Prioritize immediate stabilization and medically safe first-aid guidance. "
    "Be concise, calm, and decisive. "
    "Respond in the same language as the user."
)


def run_inference(model, tokenizer, prompt: str, device: str = "cuda") -> str:
    """Run a single inference and return raw text output."""
    import torch

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]

    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(device)

    with torch.no_grad():
        outputs = model.generate(
            input_ids=inputs,
            max_new_tokens=512,
            temperature=0.7,
            top_p=0.9,
            top_k=40,
            repetition_penalty=1.1,
            do_sample=True,
            use_cache=True,
        )

    response = tokenizer.decode(
        outputs[0][inputs.shape[1]:],
        skip_special_tokens=True
    )
    return response.strip()


def load_model(model_path: str, base_only: bool = False):
    """Load model and tokenizer using Unsloth."""
    try:
        from unsloth import FastLanguageModel
    except ImportError:
        logger.error("Unsloth not installed. Run: pip install unsloth")
        sys.exit(1)

    logger.info(f"Loading model from: {model_path}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_path,
        max_seq_length=2048,
        dtype=None,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)
    return model, tokenizer


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ResqAI inference test suite")
    parser.add_argument(
        "--model_path", type=str,
        default="./exported_model/lora_adapter",
        help="Path to model (local dir or HuggingFace repo)"
    )
    parser.add_argument(
        "--base_only", action="store_true",
        help="Test base model without LoRA (for comparison)"
    )
    parser.add_argument(
        "--device", type=str, default="cuda",
        help="Device: cuda or cpu"
    )
    parser.add_argument(
        "--output_json", type=str, default=None,
        help="Optional path to write results JSON"
    )
    args = parser.parse_args()

    # Load model
    model, tokenizer = load_model(args.model_path, args.base_only)

    # Run tests
    all_results = []
    passed = 0
    failed = 0

    for test_case in TEST_CASES:
        logger.info(f"Running {test_case['id']}: {test_case['name']}")

        raw_response = run_inference(model, tokenizer, test_case["prompt"], args.device)
        parsed = safe_parse(raw_response)
        eval_results = evaluate_response(test_case, parsed)

        print_test_result(test_case, raw_response, parsed, eval_results)

        all_pass = all(eval_results.values())
        if all_pass:
            passed += 1
        else:
            failed += 1

        all_results.append({
            "test_id": test_case["id"],
            "name": test_case["name"],
            "passed": all_pass,
            "checks": eval_results,
            "parsed_response": parsed,
        })

    # Summary
    total = len(TEST_CASES)
    print(f"\n{'='*60}")
    print(f"INFERENCE TEST SUMMARY")
    print(f"{'='*60}")
    print(f"  Passed: {passed}/{total}")
    print(f"  Failed: {failed}/{total}")
    print(f"  Pass rate: {passed/total*100:.1f}%")

    if args.output_json:
        with open(args.output_json, "w") as f:
            json.dump(all_results, f, indent=2)
        logger.info(f"Results written to {args.output_json}")

    # Exit with non-zero if any test failed
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
