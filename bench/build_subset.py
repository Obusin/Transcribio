"""Cut a reproducible evaluation subset out of GigaSpeechBench PHL / PHL-EN.

    python bench/build_subset.py --per-bucket 120

Writes bench/data/subset/{clips/*.wav, manifest.json}. Clips are 16 kHz mono
WAV, one per reference segment, sampled across all recordings with a fixed
seed so every engine is scored on identical audio.
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from textnorm import classify, normalize  # noqa: E402

ROOT = Path(__file__).parent / "data"
SETS = {"PHL-EN": ROOT / "gsb" / "phl-en.json", "PHL": ROOT / "gsb" / "phl.json"}
AUDIO = {"PHL-EN": ROOT / "gsb" / "phl-en" / "audio", "PHL": ROOT / "gsb" / "phl" / "audio"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-bucket", type=int, default=120)
    ap.add_argument("--min-sec", type=float, default=3.0)
    ap.add_argument("--max-sec", type=float, default=28.0)  # < Whisper's 30 s window
    ap.add_argument("--min-words", type=int, default=5)
    ap.add_argument("--seed", type=int, default=20260911)
    ap.add_argument("--out", default=str(ROOT / "subset"))
    args = ap.parse_args()

    out = Path(args.out)
    (out / "clips").mkdir(parents=True, exist_ok=True)
    buckets: dict[str, list[dict]] = defaultdict(list)

    for set_name, meta_path in SETS.items():
        if not AUDIO[set_name].exists():
            print(f"skip {set_name}: audio not downloaded", file=sys.stderr)
            continue
        for audio in json.load(open(meta_path))["audios"]:
            wav = AUDIO[set_name] / f"{audio['aid']}.wav"
            if not wav.exists():
                continue
            for seg in audio["segments"]:
                begin, end = float(seg["begin_time"]), float(seg["end_time"])
                dur = end - begin
                ref = normalize(seg["text"])
                if not (args.min_sec <= dur <= args.max_sec):
                    continue
                if len(ref.split()) < args.min_words:
                    continue
                if "(~)" in seg["text"]:  # annotator marked unintelligible speech
                    continue
                buckets[classify(seg["text"], set_name)].append({
                    "set": set_name, "aid": audio["aid"], "wav": str(wav),
                    "begin": begin, "end": end, "speaker": seg.get("speaker"),
                    "text": seg["text"],
                })

    rng = random.Random(args.seed)
    manifest = []
    for bucket, segs in sorted(buckets.items()):
        if bucket == "mixed-light":
            continue
        # Round-robin across recordings so one long podcast can't dominate.
        by_aid: dict[str, list[dict]] = defaultdict(list)
        for s in segs:
            by_aid[s["aid"]].append(s)
        for lst in by_aid.values():
            rng.shuffle(lst)
        aids = sorted(by_aid)
        rng.shuffle(aids)
        picked: list[dict] = []
        while len(picked) < args.per_bucket and any(by_aid[a] for a in aids):
            for a in aids:
                if by_aid[a] and len(picked) < args.per_bucket:
                    picked.append(by_aid[a].pop())
        for i, s in enumerate(picked):
            cid = f"{bucket}-{i:04d}"
            clip = out / "clips" / f"{cid}.wav"
            if not clip.exists():
                subprocess.run([
                    "ffmpeg", "-v", "error", "-y", "-ss", f"{s['begin']:.3f}", "-to", f"{s['end']:.3f}",
                    "-i", s["wav"], "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(clip),
                ], check=True)
            manifest.append({
                "id": cid, "bucket": bucket, "set": s["set"], "source": s["aid"],
                "duration": round(s["end"] - s["begin"], 3), "clip": f"clips/{cid}.wav",
                "reference": s["text"],
            })
        mins = sum(m["duration"] for m in manifest if m["bucket"] == bucket) / 60
        print(f"{bucket:9s} available={len(segs):5d} picked={len(picked):4d} "
              f"recordings={len(aids):3d} audio={mins:.1f} min")

    json.dump(manifest, open(out / "manifest.json", "w"), ensure_ascii=False, indent=1)
    print(f"wrote {len(manifest)} clips -> {out}")


if __name__ == "__main__":
    main()
