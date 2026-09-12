"""Full-precision reference runs on Apple Silicon via mlx-whisper.

    bench/.venv/bin/python bench/run_mlx.py --model mlx-community/whisper-large-v3-turbo

Writes bench/results/<run>.json in the common hypothesis format consumed by
score.py. This is also the candidate runtime for the future desktop engine.
"""

from __future__ import annotations

import argparse
import json
import resource
import time
from pathlib import Path

import mlx_whisper
import soundfile as sf

SUBSET = Path(__file__).parent / "data" / "subset"
RESULTS = Path(__file__).parent / "results"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--language", default=None, help="force a language code (default: auto-detect)")
    ap.add_argument("--run", default=None)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    manifest = json.load(open(SUBSET / "manifest.json"))
    if args.limit:
        manifest = manifest[: args.limit]
    run = args.run or f"mlx__{args.model.split('/')[-1]}__{args.language or 'auto'}"
    RESULTS.mkdir(exist_ok=True)

    # Warm-up so model load isn't counted as inference time.
    mlx_whisper.transcribe(str(SUBSET / manifest[0]["clip"]), path_or_hf_repo=args.model, language="en")

    hyps, audio_s, infer_s = [], 0.0, 0.0
    for i, item in enumerate(manifest):
        wav = SUBSET / item["clip"]
        audio_s += sf.info(str(wav)).duration
        t0 = time.perf_counter()
        out = mlx_whisper.transcribe(
            str(wav), path_or_hf_repo=args.model, language=args.language,
            task="transcribe",  # never translate
            condition_on_previous_text=False, temperature=0.0,
        )
        infer_s += time.perf_counter() - t0
        hyps.append({"id": item["id"], "hypothesis": out["text"].strip(), "language": out.get("language")})
        if i % 25 == 0:
            print(f"[{run}] {i}/{len(manifest)}  {item['bucket']}: {out['text'].strip()[:90]}")

    peak_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6  # bytes on macOS
    json.dump({
        "run": run, "engine": "mlx-whisper", "model": args.model, "precision": "fp16",
        "language": args.language or "auto", "device": "Apple M4 (Metal)",
        "audio_seconds": round(audio_s, 1), "inference_seconds": round(infer_s, 1),
        "realtime_factor": round(audio_s / infer_s, 2), "peak_rss_mb": round(peak_rss_mb),
        "hypotheses": hyps,
    }, open(RESULTS / f"{run}.json", "w"), ensure_ascii=False, indent=1)
    print(f"[{run}] done: {audio_s:.0f}s audio in {infer_s:.0f}s = {audio_s / infer_s:.1f}x realtime, peak RSS {peak_rss_mb:.0f} MB")


if __name__ == "__main__":
    main()
