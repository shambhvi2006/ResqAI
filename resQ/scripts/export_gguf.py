#!/usr/bin/env python3
"""
export_gguf.py
--------------
Exports the fine-tuned ResqAI model to GGUF Q4_K_M format for Ollama deployment.

Steps:
  1. Load the fine-tuned LoRA adapter
  2. Merge LoRA weights into the base model
  3. Export as GGUF Q4_K_M
  4. Optionally push to HuggingFace Hub

Usage:
  python scripts/export_gguf.py \
    --adapter_path ./exported_model/lora_adapter \
    --output_dir ./exported_model \
    --hf_repo YOUR_USERNAME/resqai-gemma-e2b \
    --hf_token YOUR_HF_TOKEN
"""

import os
import sys
import argparse
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def export_gguf(
    adapter_path: str,
    output_dir: str,
    quantization_method: str = "q4_k_m",
    hf_repo: str = None,
    hf_token: str = None,
):
    """
    Load LoRA adapter, merge with base model, and export as GGUF.
    """
    try:
        from unsloth import FastLanguageModel
    except ImportError:
        logger.error("Unsloth not installed. Run: pip install unsloth")
        sys.exit(1)

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # ── Load fine-tuned model ─────────────────────────────────────────────────
    logger.info(f"Loading fine-tuned model from: {adapter_path}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=adapter_path,
        max_seq_length=2048,
        dtype=None,
        load_in_4bit=True,
    )

    # ── Export GGUF ───────────────────────────────────────────────────────────
    gguf_output_name = str(output_path / "resqai-gemma-e2b")
    logger.info(f"Exporting GGUF ({quantization_method}) to: {gguf_output_name}")

    model.save_pretrained_gguf(
        gguf_output_name,
        tokenizer,
        quantization_method=quantization_method,
    )

    # List exported files
    logger.info("Exported files:")
    for f in output_path.iterdir():
        if f.suffix in (".gguf", ".bin", ".json", ".model"):
            size_mb = f.stat().st_size / (1024 ** 2)
            logger.info(f"  {f.name}: {size_mb:.1f} MB")

    # ── Push to HuggingFace ───────────────────────────────────────────────────
    if hf_repo and hf_token:
        logger.info(f"Pushing GGUF to HuggingFace: {hf_repo}")
        model.push_to_hub_gguf(
            hf_repo,
            tokenizer,
            quantization_method=quantization_method,
            token=hf_token,
        )
        logger.info(f"GGUF pushed to: https://huggingface.co/{hf_repo}")

        # Also push LoRA adapter
        lora_repo = f"{hf_repo}-lora"
        logger.info(f"Pushing LoRA adapter to: {lora_repo}")
        model.push_to_hub(lora_repo, token=hf_token)
        tokenizer.push_to_hub(lora_repo, token=hf_token)
        logger.info(f"LoRA adapter pushed to: https://huggingface.co/{lora_repo}")
    else:
        logger.info("Skipping HuggingFace push (no --hf_repo or --hf_token provided)")

    logger.info("Export complete.")
    return gguf_output_name


def main():
    parser = argparse.ArgumentParser(description="Export ResqAI model to GGUF")
    parser.add_argument(
        "--adapter_path", type=str,
        default="./exported_model/lora_adapter",
        help="Path to fine-tuned LoRA adapter"
    )
    parser.add_argument(
        "--output_dir", type=str,
        default="./exported_model",
        help="Directory to save GGUF output"
    )
    parser.add_argument(
        "--quantization", type=str,
        default="q4_k_m",
        choices=["q4_k_m", "q8_0", "f16", "q5_k_m"],
        help="GGUF quantization method"
    )
    parser.add_argument(
        "--hf_repo", type=str, default=None,
        help="HuggingFace repo to push to (e.g. username/resqai-gemma-e2b)"
    )
    parser.add_argument(
        "--hf_token", type=str,
        default=os.environ.get("HF_TOKEN"),
        help="HuggingFace API token (or set HF_TOKEN env var)"
    )
    args = parser.parse_args()

    export_gguf(
        adapter_path=args.adapter_path,
        output_dir=args.output_dir,
        quantization_method=args.quantization,
        hf_repo=args.hf_repo,
        hf_token=args.hf_token,
    )


if __name__ == "__main__":
    main()
