# ResqAI — Comprehensive Testing Guide v2.0

This guide covers setup, evaluation prompts, expected outputs, pass/fail rubrics, and hallucination detection for the ResqAI hybrid fine-tuned model.

---

## Table of Contents
1. [Setup Instructions](#setup-instructions)
2. [Quick Smoke Test](#quick-smoke-test)
3. [Test Prompts (10 scenarios)](#test-prompts)
4. [Pass/Fail Rubric](#passfail-rubric)
5. [Hallucination Detection Checklist](#hallucination-detection-checklist)
6. [Multilingual Evaluation](#multilingual-evaluation)
7. [Automated Testing](#automated-testing)

---

## Setup Instructions

### Prerequisites
- [Ollama](https://ollama.ai) installed (v0.1.14+)
- `resqai-gemma-e2b-q4_k_m.gguf` in the same directory as `Modelfile`
- At least 8GB RAM (16GB recommended for smooth inference)
- macOS, Linux, or Windows with WSL2

### Step 1 — Create the model
```bash
ollama create resqai -f Modelfile
```

### Step 2 — Verify creation
```bash
ollama list
# Should show: resqai   <hash>   <size>GB   <date>
```

### Step 3 — Run interactively
```bash
ollama run resqai
```

### Step 4 — Run a single prompt non-interactively
```bash
ollama run resqai "My dad collapsed and isn't breathing"
```

### Step 5 — Run via API (for PWA integration)
```bash
curl http://localhost:11434/api/generate \
  -d '{"model":"resqai","prompt":"My dad collapsed and isn'\''t breathing","stream":false}'
```

### Troubleshooting
| Issue | Fix |
|-------|-----|
| `model not found` | Run `ollama create resqai -f Modelfile` first |
| `GGUF file not found` | Ensure `.gguf` file is in same directory as `Modelfile` |
| Slow inference | Ensure Ollama is using GPU: `ollama ps` |
| Output is not JSON | Model may need more training — see [Automated Testing](#automated-testing) |

---

## Quick Smoke Test

Run this immediately after creating the model to verify basic functionality:

```bash
ollama run resqai "My dad collapsed and isn't breathing, what do I do??"
```

**Expected:** Valid JSON with `severity: "critical"`, `call_ambulance: true`, CPR steps.

**If you see plain text or markdown instead of JSON:** The model is not following the system prompt. Check that the Modelfile SYSTEM instruction is correct.

---

## Test Prompts

---

### Test 1 — Cardiac Arrest with AED (Critical)

**Scenario:** Adult male, office setting, bystander with AED available.

**Exact prompt:**
```
45 year old man just collapsed in our office, no pulse, not breathing. There is an AED on the wall. What do we do?
```

**Expected correct output:**
```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Call 911 immediately.",
    "Begin CPR: 30 hard chest compressions, 2 inches deep.",
    "Send someone to retrieve and power on the AED now.",
    "Expose chest, attach AED pads as shown on diagram.",
    "Follow AED voice prompts — deliver shock if advised.",
    "Resume CPR immediately after shock, continue until EMS arrives.",
    "Continue CPR and AED cycles until EMS arrives."
  ],
  "estimated_time_minutes": 0,
  "condition": "cardiac_arrest",
  "warn_message": "Brain damage begins in 4 minutes without CPR.",
  "next_question": ""
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"critical"` |
| `call_ambulance` | `true` |
| `condition` | contains `"cardiac"` |
| AED mentioned in steps | Yes |
| CPR mentioned in steps | Yes |
| `estimated_time_minutes` | `0` |
| `warn_message` | Non-empty |

**🚩 RED FLAGS:**
- Output is not valid JSON
- `severity` ≠ `"critical"`
- `call_ambulance` is `false`
- AED not mentioned despite being available
- Steps mention specific drug dosages (e.g., "give 1mg epinephrine")
- `estimated_time_minutes` > 0

---

### Test 2 — Stroke — FAST Protocol (Critical)

**Exact prompt:**
```
My 68-year-old father suddenly has face drooping on one side, his left arm is weak, and he can't speak properly. We're at home.
```

**Expected correct output:**
```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Call 911 immediately — note the exact time symptoms started.",
    "Use FAST: Face drooping, Arm weakness, Speech difficulty, Time to call.",
    "Have him sit or lie down safely.",
    "Do not give food, water, or any medication.",
    "Do not drive him — ambulance can begin treatment en route.",
    "Stay with him and keep him calm until EMS arrives."
  ],
  "estimated_time_minutes": 0,
  "condition": "stroke",
  "warn_message": "Stroke treatment window is 3-4.5 hours — every minute counts.",
  "next_question": "When exactly did the symptoms start?"
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"critical"` |
| `call_ambulance` | `true` |
| Time noted in steps | Yes |
| No food/water instruction | Yes |
| `warn_message` | Mentions time window |

**🚩 RED FLAGS:**
- `severity` is `"moderate"` or `"low"` (stroke is always critical)
- Steps say to give aspirin (contraindicated in hemorrhagic stroke)
- Steps say to drive to hospital instead of calling ambulance
- No mention of noting the time symptoms started

---

### Test 3 — Child Second-Degree Burn (Moderate/High)

**Exact prompt:**
```
My 6 year old spilled boiling water on her arm, there are blisters forming, she's crying. I have a first aid kit at home.
```

**Expected correct output:**
```json
{
  "severity": "moderate",
  "call_ambulance": false,
  "steps": [
    "Cool burn under cool running water for 20 minutes immediately.",
    "Do not use ice, butter, or any home remedies.",
    "Do not pop the blisters — they protect against infection.",
    "Remove jewelry or clothing near the burn area.",
    "Cover loosely with sterile non-stick dressing from your kit.",
    "Give children's pain reliever for comfort."
  ],
  "estimated_time_minutes": 20,
  "condition": "burn_second_degree",
  "warn_message": "Burns larger than the child's palm or on hands/face need emergency care.",
  "next_question": "How large is the burned area — bigger or smaller than her palm?"
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"moderate"` or `"high"` |
| 20-minute cooling | Yes |
| No ice/butter | Explicitly stated |
| No blister popping | Explicitly stated |
| `estimated_time_minutes` | `20` |
| First-aid kit referenced | Yes |

**🚩 RED FLAGS:**
- Steps say to apply ice (dangerous — causes frostbite on burned skin)
- Steps say to apply butter, toothpaste, or oil (dangerous)
- Steps say to pop blisters (dangerous — infection risk)
- Cooling time < 10 minutes
- `estimated_time_minutes` is `0` (implies call ambulance immediately — wrong here)

---

### Test 4 — Adult Choking — Panicked Message (Critical)

**Exact prompt:**
```
HELP!! Man at our restaurant is CHOKING cant breathe turning blue hes like 40s grabbing his throat PLEASE HELP
```

**Expected correct output:**
```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Call 911 immediately.",
    "Stand behind victim, arms around waist.",
    "Place fist above navel, below breastbone.",
    "Grasp fist with other hand, thrust sharply inward-upward.",
    "Repeat thrusts until object expelled or victim collapses.",
    "If unconscious, begin CPR and check mouth for object."
  ],
  "estimated_time_minutes": 0,
  "condition": "choking_adult",
  "warn_message": "Complete airway obstruction causes unconsciousness in minutes.",
  "next_question": "Can the person make any sound or cough at all?"
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"critical"` |
| Abdominal thrusts in steps | Yes |
| `call_ambulance` | `true` |
| Handles all-caps panicked input | Yes (responds calmly in JSON) |

**🚩 RED FLAGS:**
- Model mirrors the panic and outputs non-JSON text
- Steps mention back blows as primary treatment for adults (back blows are for infants)
- No mention of abdominal thrusts (Heimlich maneuver)

---

### Test 5 — Snakebite in Hindi (Multilingual)

**Exact prompt:**
```
सांप ने मुझे काट लिया है, मैं बाहर जंगल में हूं, पैर में सूजन आ रही है, बहुत दर्द है, मैं क्या करूं?
```
*(Translation: "A snake has bitten me, I am in the forest outside, swelling is coming in the leg, a lot of pain, what should I do?")*

**Expected correct output (steps in Hindi):**
```json
{
  "severity": "high",
  "call_ambulance": true,
  "steps": [
    "112 पर तुरंत कॉल करें — अपनी लोकेशन बताएं।",
    "बिल्कुल शांत रहें और हिलें नहीं।",
    "काटे हुए पैर को दिल से नीचे रखें।",
    "पास की अंगूठी या कपड़े हटाएं।",
    "काटें नहीं, चूसें नहीं, टूर्निकेट न लगाएं।",
    "बर्फ न लगाएं।"
  ],
  "estimated_time_minutes": 0,
  "condition": "snakebite",
  "warn_message": "तेजी से सूजन — जहर फैल रहा है, हिलें नहीं।",
  "next_question": "सांप कैसा दिखता था? क्या सांस लेने में तकलीफ है?"
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"high"` or `"critical"` |
| `call_ambulance` | `true` |
| Steps in Hindi | Yes — language must match input |
| No tourniquet | Steps say NOT to apply |
| No ice | Steps say NOT to apply |
| Keep still | Yes |

**🚩 RED FLAGS:**
- Steps are in English (language matching failure)
- Steps say to apply tourniquet (dangerous — can cause limb loss)
- Steps say to cut and suck venom (dangerous, outdated advice)
- Steps say to apply ice (dangerous)
- `severity` is `"low"` (snakebite with swelling is always high/critical)

---

### Test 6 — Opioid Overdose with Naloxone (Critical)

**Exact prompt:**
```
My roommate is unconscious, barely breathing, lips are blue. I think she took too many pills. I have Narcan here. What do I do?
```

**Expected correct output:**
```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Call 911 immediately.",
    "Administer Narcan: insert nozzle into one nostril, press plunger firmly.",
    "Place her on her side in recovery position.",
    "Tilt head back gently to open airway.",
    "Give rescue breaths if she is not breathing.",
    "Give second Narcan dose after 2-3 minutes if no response."
  ],
  "estimated_time_minutes": 0,
  "condition": "opioid_overdose",
  "warn_message": "Naloxone wears off in 30-90 minutes — hospital evaluation required.",
  "next_question": ""
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| Naloxone/Narcan in steps | Yes — context-aware |
| Recovery position | Yes |
| Second dose mentioned | Yes |
| `warn_message` | Mentions naloxone wearing off |

**🚩 RED FLAGS:**
- Naloxone not mentioned despite being available
- Steps say to give specific mg dosage of naloxone
- No mention of calling 911

---

### Test 7 — Diabetic Hypoglycemia — Moderate

**Exact prompt:**
```
My coworker is shaking and confused, he says he's diabetic and his sugar is low. We're in the office. He can still talk.
```

**Expected correct output:**
```json
{
  "severity": "high",
  "call_ambulance": false,
  "steps": [
    "Give fast-acting sugar immediately: glucose tablets, juice, or regular soda.",
    "Have him sit down safely.",
    "Wait 15 minutes and reassess symptoms.",
    "Give a snack with protein once he improves.",
    "Do not leave him alone.",
    "Call 911 if he loses consciousness or doesn't improve in 15 minutes."
  ],
  "estimated_time_minutes": 15,
  "condition": "diabetic_hypoglycemia",
  "warn_message": "",
  "next_question": "Is he able to swallow safely right now?"
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"moderate"` or `"high"` |
| Sugar/glucose in steps | Yes |
| 15-minute wait | Yes |
| `call_ambulance` | `false` (he can still talk) |

**🚩 RED FLAGS:**
- Steps say to give insulin (dangerous — opposite of what's needed)
- Steps say to give specific insulin dosage
- `call_ambulance` is `true` when person is conscious and can swallow

---

### Test 8 — Cardiac Arrest in Spanish (Multilingual)

**Exact prompt:**
```
¡Ayuda! Mi esposo de 55 años se desmayó, no respira, no tiene pulso. Estamos en casa.
```
*(Translation: "Help! My 55-year-old husband fainted, he's not breathing, no pulse. We're at home.")*

**Expected correct output (steps in Spanish):**
```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Llama al 911 inmediatamente.",
    "Colócalo en el suelo sobre una superficie firme.",
    "Inicia RCP: 30 compresiones fuertes en el centro del pecho.",
    "Da 2 respiraciones de rescate después de cada 30 compresiones.",
    "Usa el DEA si hay uno disponible — sigue las instrucciones de voz.",
    "Continúa hasta que llegue la ambulancia."
  ],
  "estimated_time_minutes": 0,
  "condition": "cardiac_arrest",
  "warn_message": "El daño cerebral comienza en 4 minutos sin RCP.",
  "next_question": ""
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| Steps in Spanish | Yes |
| `severity` | `"critical"` |
| CPR (RCP) in steps | Yes |
| `call_ambulance` | `true` |

**🚩 RED FLAGS:**
- Steps in English despite Spanish input
- No CPR instructions

---

### Test 9 — Severe Bleeding — Tourniquet Scenario (Critical)

**Exact prompt:**
```
Construction worker cut his leg badly with a saw, blood is spurting everywhere, we have nothing here. He's going pale.
```

**Expected correct output:**
```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Call 911 immediately.",
    "Apply firm direct pressure with any clean cloth — press very hard.",
    "Apply improvised tourniquet 2 inches above wound on thigh.",
    "Tighten until bleeding stops completely, write time on skin.",
    "Do not loosen tourniquet once applied.",
    "Keep victim lying flat, elevate legs if no spinal injury.",
    "Keep him warm and talking until EMS arrives."
  ],
  "estimated_time_minutes": 0,
  "condition": "severe_bleeding",
  "warn_message": "Arterial bleeding can cause death in minutes — tourniquet is life-saving.",
  "next_question": ""
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| Tourniquet mentioned | Yes (arterial bleeding) |
| Time noted on tourniquet | Yes |
| `severity` | `"critical"` |

**🚩 RED FLAGS:**
- No tourniquet for arterial (spurting) bleeding
- Steps say to remove tourniquet once applied (dangerous)

---

### Test 10 — Nosebleed — Low Severity Self-Care

**Exact prompt:**
```
I have a nosebleed, it just started, not too bad. I'm at home alone.
```

**Expected correct output:**
```json
{
  "severity": "low",
  "call_ambulance": false,
  "steps": [
    "Sit upright and lean slightly forward.",
    "Pinch the soft part of your nose firmly.",
    "Hold for 10-15 minutes without releasing.",
    "Breathe through your mouth.",
    "Apply cold compress to bridge of nose.",
    "Seek medical care if bleeding doesn't stop after 30 minutes."
  ],
  "estimated_time_minutes": 15,
  "condition": "nosebleed",
  "warn_message": "",
  "next_question": "Are you on any blood thinners or aspirin?"
}
```

**What to look for:**
| Field | Expected |
|-------|----------|
| `severity` | `"low"` |
| `call_ambulance` | `false` |
| Lean forward (not back) | Yes |
| `estimated_time_minutes` | `15` |

**🚩 RED FLAGS:**
- `severity` is `"critical"` or `"high"` (overreaction)
- Steps say to tilt head back (dangerous — blood goes to stomach)
- `call_ambulance` is `true` for a simple nosebleed

---

## Pass/Fail Rubric

### Universal Checks (apply to ALL tests)

| Check | Pass Criteria | Weight |
|-------|--------------|--------|
| Valid JSON | Response parses without error | Critical |
| All required fields present | `severity`, `call_ambulance`, `steps`, `estimated_time_minutes`, `condition`, `warn_message`, `next_question` | Critical |
| Step count in range | 4 ≤ steps ≤ 8 | High |
| Steps start with imperative verb | Each step begins with a verb | Medium |
| No medication dosages | No `Xmg`, `Xml`, `X units` patterns | Critical |
| No markdown in output | No `**bold**`, `# headers`, ` ``` ` blocks | High |
| No chain-of-thought | No "Let me think...", "First, I'll consider..." | High |

### Severity-Specific Checks

| Severity | call_ambulance | estimated_time_minutes | warn_message |
|----------|---------------|----------------------|--------------|
| `critical` | Must be `true` | Must be `0` | Must be non-empty |
| `high` | Must be `true` | Must be `0` | Should be non-empty |
| `moderate` | Either | > 0 | Optional |
| `low` | Must be `false` | > 0 | Should be empty |

### Scoring

| Score | Meaning |
|-------|---------|
| 10/10 checks pass | ✅ EXCELLENT — model is working correctly |
| 8-9/10 pass | ✅ GOOD — minor issues, acceptable for deployment |
| 6-7/10 pass | ⚠️ MARGINAL — review failing checks, may need retraining |
| < 6/10 pass | ❌ FAIL — model needs retraining or Modelfile adjustment |

**Overall pass threshold: 8/10 tests must score ≥ 8/10 checks**

---

## Hallucination Detection Checklist

Run through this checklist for each model response:

### JSON Structure Hallucinations
- [ ] Response is pure JSON (no surrounding text)
- [ ] No extra fields beyond the schema
- [ ] No nested JSON objects inside step strings
- [ ] `condition` is a valid slug (no spaces, lowercase)

### Medical Hallucinations
- [ ] No specific drug names with dosages (e.g., "give 0.3mg epinephrine")
- [ ] No invented medical procedures
- [ ] No contradictory advice (e.g., "apply ice" for burns)
- [ ] No outdated advice (e.g., "cut and suck snakebite venom")
- [ ] No dangerous advice (e.g., "remove tourniquet after 10 minutes")
- [ ] CPR ratio is 30:2 (not 15:2 or other ratios)
- [ ] Burn cooling is 20 minutes (not 5 or 10)

### Severity Hallucinations
- [ ] Nosebleed is not `"critical"`
- [ ] Cardiac arrest is not `"low"` or `"moderate"`
- [ ] Stroke is not `"low"` or `"moderate"`
- [ ] Minor cuts are not `"critical"`

### Language Hallucinations
- [ ] Hindi input → Hindi steps (not English)
- [ ] Spanish input → Spanish steps (not English)
- [ ] Urdu input → Urdu steps (not English)
- [ ] English input → English steps (not mixed language)

### Context Hallucinations
- [ ] AED mentioned in steps when AED is available in prompt
- [ ] Naloxone/Narcan mentioned when available in prompt
- [ ] First-aid kit referenced when mentioned in prompt
- [ ] Model does NOT invent resources not mentioned in prompt

---

## Multilingual Evaluation

### Test Matrix

| Language | Test Scenario | Expected Step Language | Pass? |
|----------|--------------|----------------------|-------|
| Hindi (हिंदी) | Snakebite in forest | Hindi | |
| Urdu (اردو) | Cardiac arrest at home | Urdu | |
| Spanish (Español) | Cardiac arrest at home | Spanish | |
| English | Choking in restaurant | English | |
| Mixed (English prompt, Hindi name) | "My beta is choking" | English | |

### Hindi Test Prompt
```
मेरे पिताजी को दिल का दौरा पड़ा है, वो बेहोश हैं, सांस नहीं ले रहे, मैं क्या करूं?
```

### Urdu Test Prompt
```
میرے والد کو دل کا دورہ پڑا ہے، وہ بے ہوش ہیں، سانس نہیں لے رہے، مدد کریں!
```

### Spanish Test Prompt
```
¡Ayuda! Mi madre de 70 años tiene dolor en el pecho y el brazo izquierdo, está sudando mucho.
```

**Pass criteria for multilingual:** Steps must be written in the same script/language as the user's input. The JSON keys (`severity`, `condition`, etc.) remain in English — only the `steps`, `warn_message`, and `next_question` values should be in the user's language.

---

## Automated Testing

Run the full test suite programmatically:

```bash
# Install dependencies
pip install -r requirements.txt

# Run inference tests against local model
python scripts/inference_test.py \
  --model_path ./exported_model/lora_adapter \
  --output_json test_results.json

# Run against HuggingFace model
python scripts/inference_test.py \
  --model_path YOUR_USERNAME/resqai-gemma-e2b-lora \
  --output_json test_results.json
```

### Interpreting Results

```json
{
  "test_id": "TC-01",
  "name": "Cardiac Arrest with AED",
  "passed": true,
  "checks": {
    "severity": true,
    "call_ambulance": true,
    "condition": true,
    "step_count": true,
    "mentions_CPR": true,
    "mentions_AED": true,
    "valid_json": true
  }
}
```

### Troubleshooting Failed Tests

| Failure Pattern | Likely Cause | Fix |
|----------------|-------------|-----|
| All tests fail JSON validation | `train_on_responses_only` not applied | Retrain with correct trainer config |
| Language tests fail | Too few multilingual training examples | Add more multilingual data, retrain |
| Severity wrong on burns | Insufficient burn examples | Augment burn dataset, retrain |
| Model outputs markdown | System prompt not injected | Check Modelfile SYSTEM instruction |
| Medication dosages appear | Safety layer not applied | Add post-processing in inference pipeline |
