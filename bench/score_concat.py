"""Score a transcript of bench/data/longform/big-2gb.mp4 (8 PHL recordings
concatenated, cut at 2700 s) against the stitched GigaSpeechBench reference.

    bench/.venv/bin/python bench/score_concat.py bench/data/longform/big-2gb.light.json [...more]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import jiwer
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from textnorm import normalize  # noqa: E402

DATA = Path(__file__).parent / "data" / "gsb"
LIMIT = 2700.0

wavs = sorted((DATA / "phl" / "audio").glob("*.wav"))[:8]  # same order as the ffmpeg concat list
meta = {a["aid"]: a for a in json.load(open(DATA / "phl.json"))["audios"]}
ref_words, offset = [], 0.0
for w in wavs:
    for s in sorted(meta[w.stem]["segments"], key=lambda s: float(s["begin_time"])):
        if offset + float(s["end_time"]) <= LIMIT:
            ref_words.append(s["text"])
    offset += sf.info(str(w)).duration
    if offset >= LIMIT:
        break
ref = normalize(" ".join(ref_words))

for path in sys.argv[1:]:
    rec = json.load(open(path))["record"]["raw"]
    hyp = normalize(" ".join(s["text"] for s in rec["segments"]))
    o = jiwer.process_words(ref, hyp)
    n = len(ref.split())
    print(f"{Path(path).name:28s} WER {100 * o.wer:5.1f}%  CER {100 * jiwer.cer(ref, hyp):5.1f}%  "
          f"del {100 * o.deletions / n:4.1f}%  ins {100 * o.insertions / n:4.1f}%  "
          f"processing {rec['stats']['processingSeconds']:.0f}s ({rec['stats']['realtimeFactor']:.1f}x)")
