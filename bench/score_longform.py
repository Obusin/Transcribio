"""Score an end-to-end (long-form) transcript from bench/e2e.mjs against the
GigaSpeechBench reference for the same recording.

    bench/.venv/bin/python bench/score_longform.py bench/data/longform/taglish-interview.mp4.auto.json \
        --aid 'PHL#aeb859b265e7' --set PHL --until 600

Segment clips can't reveal pipeline losses (VAD dropping speech, words lost or
duplicated at chunk seams). Long-form WER + the deletion/insertion split can.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import jiwer

sys.path.insert(0, str(Path(__file__).parent))
from textnorm import normalize  # noqa: E402

META = {"PHL": "phl.json", "PHL-EN": "phl-en.json"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("result")
    ap.add_argument("--aid", required=True)
    ap.add_argument("--set", default="PHL")
    ap.add_argument("--until", type=float, default=600)
    args = ap.parse_args()

    meta = json.load(open(Path(__file__).parent / "data" / "gsb" / META[args.set]))
    audio = next(a for a in meta["audios"] if a["aid"] == args.aid)
    ref_segs = sorted(
        (s for s in audio["segments"] if float(s["end_time"]) <= args.until), key=lambda s: float(s["begin_time"])
    )
    ref = normalize(" ".join(s["text"] for s in ref_segs))

    data = json.load(open(args.result))
    rec = data["record"]["raw"]
    hyp_segs = [s for s in rec["segments"] if s["start"] < args.until]
    hyp = normalize(" ".join(s["text"] for s in hyp_segs))

    out = jiwer.process_words(ref, hyp)
    n = len(ref.split())
    print(f"reference words {n}, hypothesis words {len(hyp.split())}")
    print(f"WER {100 * out.wer:.1f}%  (sub {100 * out.substitutions / n:.1f}%, "
          f"del {100 * out.deletions / n:.1f}%, ins {100 * out.insertions / n:.1f}%)")
    print(f"CER {100 * jiwer.cer(ref, hyp):.1f}%")
    print(f"processing: {rec['stats']['realtimeFactor']:.2f}x realtime, languages {rec['detectedLanguages']}")

    # Where are the deletions? Find reference stretches with no hypothesis segment overlapping.
    gaps = []
    for s in ref_segs:
        b, e = float(s["begin_time"]), float(s["end_time"])
        if not any(h["start"] < e and h["end"] > b for h in hyp_segs):
            gaps.append((b, e, s["text"][:80]))
    print(f"reference segments with no overlapping output: {len(gaps)} of {len(ref_segs)}")
    for b, e, t in gaps[:12]:
        print(f"   {b:7.1f}-{e:7.1f}  {t}")


if __name__ == "__main__":
    main()
