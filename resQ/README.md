# ResqAI — Emergency First-Aid AI Assistant

> A fine-tuned `google/gemma-4-e2b-it` model for real-time emergency triage.  
> Takes a panicked text message. Returns structured JSON first-aid instructions.  
> Runs locally via Ollama. Trained on Kaggle T4 (free tier).

---

## What It Does

A user types something like:

```
HELP!! Man at our restaurant is CHOKING cant breathe turning blue
```

The model responds with only:

```json
{
  "severity": "critical",
  "call_ambulance": true,
  "steps": [
    "Call 911 immediately.",
    "Stand behind victim, arms around waist.",
    "Place fist above navel, grasp with other hand.",
    "Give sharp inward-upward abdominal thrusts.",
    "Repeat until object expelled or victim collapses.",
    "Begin CPR if victim becomes unconscious."
  ],
  "estimated_time_minutes": 0,
  "condition": "choking_adult",
  "warn_message": "Complete airway obstruction causes unconsciousness in minutes.",
  "next_question": "Can the person make any sound or cough at all?"
}
```

No prose. No markdown. Pure structured JSON — ready for a PWA to parse and display.

---

## Architecture

```
RAW DATA
├── resqai_dataset.json              200 synthetic triage examples
├── phrases_no_exclude_train.jsonl   MedQA clinical vignettes (train)
└── phrases_no_exclude_test.jsonl    MedQA clinical vignettes (test)
         │
         ▼
PREPROCESSING
├── scripts/preprocess_medqa.py      MCQ → conversational triage format
└── scripts/combine_datasets.py      Merge + augment → hybrid_train.jsonl
         │
         ▼
TRAINING  (Kaggle T4, 16GB VRAM)
└── notebooks/hybrid_resqai_training.ipynb
    ├── Unsloth FastLanguageModel (4-bit QLoRA)
    ├── LoRA: r=16, all attention + MLP projections
    ├── SFTTrainer + train_on_responses_only
    └── 3 epochs, lr=2e-4, cosine schedule
         │
         ▼
EXPORT
├── LoRA adapter   → HuggingFace Hub
├── Merged model   → HuggingFace Hub
└── GGUF Q4_K_M    → HuggingFace Hub + local
         │
         ▼
DEPLOYMENT
└── Modelfile → ollama create resqai → ollama run resqai
```

---

## Project Structure

```
resQ/
│
├── resqai_dataset.json                 Training data — synthetic triage
├── phrases_no_exclude_train.jsonl      Training data — MedQA clinical vignettes
├── phrases_no_exclude_test.jsonl       Training data — MedQA clinical vignettes (test)
│
├── notebooks/
│   └── hybrid_resqai_training.ipynb    Main Kaggle training notebook (34 cells)
│
├── scripts/
│   ├── preprocess_medqa.py             Step 1: Convert MedQA → ResqAI format
│   ├── combine_datasets.py             Step 2: Build hybrid dataset
│   ├── inference_test.py               Step 3: Evaluate trained model (8 tests)
│   └── export_gguf.py                  Step 4: Export GGUF + push to HuggingFace
│
├── datasets/                           Output dir for processed datasets
├── exported_model/                     Output dir for local model files
│
├── Modelfile                           Ollama model configuration
├── TESTING.md                          10 test prompts + pass/fail rubrics
├── train_config.yaml                   All hyperparameters in one file
├── requirements.txt                    Python dependencies
└── README.md                           This file
```

---

## Every File Explained

### Data Files

**`resqai_dataset.json`**  
200 hand-crafted synthetic training examples covering 20 emergency conditions (choking, cardiac arrest, stroke, burns, bleeding, seizure, overdose, snakebite, etc.) × 10 variations each. Each entry is a user message + structured JSON triage response. Covers varied ages, settings, severity levels, and includes 18 multilingual entries (Hindi, Urdu, Spanish). Follows WHO/AHA/Red Cross 2020+ guidelines throughout.

**`phrases_no_exclude_train.jsonl`**  
Raw MedQA dataset — USMLE-style multiple-choice clinical vignettes (train split). Each entry has a clinical question, answer options, correct answer, and `metamap_phrases` (extracted medical concepts). Used as input to `preprocess_medqa.py`. Not used directly for training.

**`phrases_no_exclude_test.jsonl`**  
Same as above, test split. Also fed through `preprocess_medqa.py` to extract additional training examples.

---

### Notebooks

**`notebooks/hybrid_resqai_training.ipynb`**  
The complete, copy-paste-ready Kaggle training notebook. 34 cells across 13 sections:

| Section | What it does |
|---------|-------------|
| 1 — Install | `pip install unsloth[kaggle-new] xformers trl peft accelerate bitsandbytes datasets` |
| 2 — Imports | All imports + HuggingFace login via Kaggle secrets (`HF_TOKEN`) |
| 3 — Preprocess MedQA | Converts raw MCQ entries into conversational triage format inline |
| 4 — Build Hybrid Dataset | Merges synthetic + MedQA + augmented; deduplicates; computes statistics |
| 5 — Load Model | `FastLanguageModel.from_pretrained("google/gemma-4-e2b-it", load_in_4bit=True)` |
| 6 — Apply LoRA | `r=16, lora_alpha=16, target all 7 projection modules, gradient_checkpointing="unsloth"` |
| 7 — Format Dataset | `tokenizer.apply_chat_template()` with system prompt injected into every example |
| 8 — Configure Trainer | `SFTTrainer` + `train_on_responses_only` (loss only on assistant turns) |
| 9 — Train | `trainer.train()` — prints loss, runtime, peak VRAM |
| 10 — Save Model | Saves LoRA adapter + merged 16-bit model to `/kaggle/working/` |
| 11 — Export GGUF | `model.save_pretrained_gguf(..., quantization_method="q4_k_m")` |
| 12 — Push to Hub | Pushes GGUF + LoRA adapter + tokenizer to HuggingFace |
| 13 — Inference Tests | Runs 5 test prompts (cardiac, stroke, burn, choking, Hindi snakebite) with JSON validation |

---

### Scripts

**`scripts/preprocess_medqa.py`**  
Standalone script that converts `phrases_no_exclude_*.jsonl` into ResqAI conversational format.

- Scans each entry for 40+ emergency keywords to classify condition + severity
- Strips all MCQ/exam phrasing ("which of the following", "most likely", etc.)
- Extracts age, gender, and symptom phrases from `metamap_phrases`
- Builds a realistic patient/bystander message using panic-style templates
- Generates a medically appropriate JSON triage response using the step library
- Validates every output entry before writing
- Run: `python scripts/preprocess_medqa.py --train phrases_no_exclude_train.jsonl --output_dir datasets/`

**`scripts/combine_datasets.py`**  
Merges all data sources into the final hybrid training set.

- Loads synthetic triage data (50%), converted MedQA (35%), generates augmented examples (15%)
- Augmentation strategies: typo injection, all-caps panic style, multilingual user messages (Hindi/Urdu/Spanish)
- Deduplicates by user message hash
- Validates every entry (required fields, severity, step count, no medication dosages)
- Splits into `hybrid_train.jsonl` (90%) and `hybrid_eval.jsonl` (10%)
- Writes `dataset_statistics.json` with severity/condition/source/token-length distributions
- Run: `python scripts/combine_datasets.py --output_dir datasets/`

**`scripts/inference_test.py`**  
Evaluation suite for the trained model. 8 test cases covering:
- TC-01: Cardiac arrest with AED (critical, English)
- TC-02: Stroke — FAST protocol (critical, English)
- TC-03: Child second-degree burn (moderate, English)
- TC-04: Adult choking — panicked all-caps input (critical, English)
- TC-05: Snakebite in Hindi (high, multilingual)
- TC-06: Opioid overdose with Narcan available (critical, English)
- TC-07: Diabetic hypoglycemia — conscious patient (moderate, English)
- TC-08: Cardiac arrest in Spanish (critical, multilingual)

Each test checks: valid JSON, correct severity, correct `call_ambulance`, required keywords in steps, forbidden keywords absent, step count in range. Includes a safety validator that rejects medication dosages and returns a safe fallback response.
- Run: `python scripts/inference_test.py --model_path ./exported_model/lora_adapter`

**`scripts/export_gguf.py`**  
Loads the fine-tuned LoRA adapter, exports as GGUF Q4_K_M, and optionally pushes to HuggingFace Hub.
- Run: `python scripts/export_gguf.py --adapter_path ./exported_model/lora_adapter --hf_repo USERNAME/resqai-gemma-e2b`

---

### Config & Deployment Files

**`Modelfile`**  
Ollama model configuration. Specifies:
- `FROM ./resqai-gemma-e2b-q4_k_m.gguf` — the quantized model file
- `SYSTEM` prompt — instructs model to always output JSON, respond in user's language
- `PARAMETER temperature 0.7` — slightly below default for consistent medical advice
- `PARAMETER top_p 0.9` — nucleus sampling to reduce hallucinations
- `PARAMETER top_k 40` — vocabulary limit per step
- `PARAMETER repeat_penalty 1.1` — discourages repetitive steps
- `PARAMETER num_ctx 2048` — context window
- `PARAMETER stop` — Gemma's `<end_of_turn>` and `<start_of_turn>` stop tokens
- 4 few-shot `MESSAGE` examples (choking, cardiac arrest, burn, stroke) to reinforce JSON format

**`TESTING.md`**  
Complete testing guide with 10 evaluation prompts, expected JSON outputs, field-level lookup tables, red flag lists, and 11-point pass/fail checklists. Covers: cardiac arrest, stroke, burn, choking, snakebite (Hindi), opioid overdose, diabetic hypoglycemia, cardiac arrest (Spanish), severe bleeding, nosebleed. Also includes a hallucination detection checklist and multilingual evaluation matrix.

**`train_config.yaml`**  
Single source of truth for all training hyperparameters. Covers model settings, LoRA config, dataset paths and composition ratios, training arguments, export settings, HuggingFace repo names, inference parameters, and safety patterns. Useful for reproducing or tweaking the training run without editing the notebook.

**`requirements.txt`**  
Pinned Python dependencies for the Kaggle T4 environment: `unsloth[kaggle-new]`, `xformers`, `trl`, `peft`, `accelerate`, `bitsandbytes`, `transformers`, `datasets`, `huggingface_hub`, `numpy`, `pandas`, `tqdm`, `pyyaml`.

---

## Why Hybrid Training?

| Approach | Problem |
|----------|---------|
| Synthetic-only (200 examples) | Model learns JSON format but lacks clinical reasoning depth. Fails on complex or ambiguous symptom descriptions. |
| MedQA-only (raw MCQ) | Model learns medical knowledge but in exam format — useless for real-world triage. |
| **Hybrid (this project)** | Synthetic data teaches JSON format + emergency protocols. Converted MedQA teaches clinical reasoning from realistic patient presentations. Augmentation teaches robustness to panic text, typos, and multilingual input. |

---

## Quick Start

### Train on Kaggle

1. Upload `resqai_dataset.json`, `phrases_no_exclude_train.jsonl`, `phrases_no_exclude_test.jsonl` as a Kaggle dataset named `resqai-dataset`
2. Add `HF_TOKEN` to Kaggle secrets
3. Open `notebooks/hybrid_resqai_training.ipynb` on Kaggle with T4 GPU + internet enabled
4. Run all cells (~60–90 min)
5. Download `resqai-gemma-e2b-q4_k_m.gguf` from `/kaggle/working/resqai-gguf/`

### Deploy with Ollama

```bash
# Place GGUF in same directory as Modelfile, then:
ollama create resqai -f Modelfile
ollama run resqai
```

### Test

```bash
python scripts/inference_test.py --model_path YOUR_HF_USERNAME/resqai-gemma-e2b-lora
```

---

## Output JSON Schema

```json
{
  "severity":               "critical | high | moderate | low",
  "call_ambulance":         true | false,
  "steps":                  ["Step 1 (imperative verb, <15 words)", "..."],
  "estimated_time_minutes": 0,
  "condition":              "condition_slug",
  "warn_message":           "Short urgent warning, or empty string",
  "next_question":          "One clarifying follow-up, or empty string"
}
```

**Severity rules:**
- `critical` → life-threatening right now → `call_ambulance: true`, `estimated_time_minutes: 0`
- `high` → urgent within minutes → `call_ambulance: true`, `estimated_time_minutes: 0`
- `moderate` → needs care within an hour → `call_ambulance: false` (usually)
- `low` → can self-manage → `call_ambulance: false`

---

## Safety Notice

This is a hackathon prototype. It is **not** a certified medical device and must not replace professional emergency services. Always call 911 / 112 for life-threatening situations.

Medical steps follow AHA 2020, WHO 2016, and Red Cross 2021 guidelines. The model deliberately omits specific drug dosages to prevent dangerous self-medication.
