"""Score every bench/results/*.json against the subset references.

    bench/.venv/bin/python bench/score.py            # table to stdout
    bench/.venv/bin/python bench/score.py --md       # markdown table

Metrics per bucket (english / taglish / filipino):
  WER, CER               corpus-level, after textnorm.normalize on both sides
  tl_recall / en_recall  fraction of reference Tagalog / English words that the
                         alignment marks as correct. A model that *translates*
                         Taglish into English keeps en_recall and loses tl_recall
                         — the failure mode the product must not have.
  hallucination rate     share of clips whose hypothesis is >2x the reference
                         length (repetition loops, invented text)
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import jiwer

sys.path.insert(0, str(Path(__file__).parent))
from textnorm import TAGALOG_MARKERS, english_vocab, normalize  # noqa: E402

SUBSET = Path(__file__).parent / "data" / "subset"
RESULTS = Path(__file__).parent / "results"
BUCKETS = ["english", "taglish", "filipino"]


def word_hits(ref: str, hyp: str) -> list[bool]:
    """For each reference word, whether the alignment matched it exactly."""
    if not ref:
        return []
    if not hyp:
        return [False] * len(ref.split())
    out = jiwer.process_words(ref, hyp)
    hits = [False] * len(ref.split())
    for chunk in out.alignments[0]:
        if chunk.type == "equal":
            for k in range(chunk.ref_start_idx, chunk.ref_end_idx):
                hits[k] = True
    return hits


def score_run(path: Path, manifest: dict[str, dict]) -> dict:
    data = json.load(open(path))
    by_bucket: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    en_vocab = english_vocab()
    for h in data["hypotheses"]:
        item = manifest.get(h["id"])
        if not item:
            continue
        ref, hyp = normalize(item["reference"]), normalize(h["hypothesis"])
        b = by_bucket[item["bucket"]]
        b["refs"].append(ref)
        b["hyps"].append(hyp)
        b["halluc"].append(len(hyp.split()) > 2 * max(len(ref.split()), 1) + 3)
        for w, hit in zip(ref.split(), word_hits(ref, hyp)):
            if w in TAGALOG_MARKERS:
                b["tl"].append(hit)
            elif w in en_vocab:
                b["en"].append(hit)

    rows = {}
    for bucket, b in by_bucket.items():
        # jiwer rejects empty hypotheses in some versions; use a placeholder token.
        hyps = [h if h else "∅" for h in b["hyps"]]
        rows[bucket] = {
            "n": len(b["refs"]),
            "wer": jiwer.wer(b["refs"], hyps),
            "cer": jiwer.cer(b["refs"], hyps),
            "tl_recall": sum(b["tl"]) / len(b["tl"]) if b["tl"] else None,
            "en_recall": sum(b["en"]) / len(b["en"]) if b["en"] else None,
            "halluc": sum(b["halluc"]) / len(b["halluc"]),
        }
    meta = {k: v for k, v in data.items() if k != "hypotheses"}
    return {"meta": meta, "buckets": rows}


def pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.1f}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    manifest = {m["id"]: m for m in json.load(open(SUBSET / "manifest.json"))}
    scored = [score_run(p, manifest) for p in sorted(RESULTS.glob("*.json"))]
    if args.json:
        print(json.dumps(scored, indent=1))
        return

    header = ["run", "RTF×"] + [f"{b} WER" for b in BUCKETS] + ["taglish tl_rec", "taglish en_rec", "fil CER", "halluc"]
    lines = []
    for s in scored:
        m, bk = s["meta"], s["buckets"]
        hall = sum(bk[b]["halluc"] * bk[b]["n"] for b in bk) / max(sum(bk[b]["n"] for b in bk), 1)
        lines.append([
            m["run"], str(m.get("realtime_factor", "—")),
            *[pct(bk[b]["wer"]) if b in bk else "—" for b in BUCKETS],
            pct(bk.get("taglish", {}).get("tl_recall")), pct(bk.get("taglish", {}).get("en_recall")),
            pct(bk.get("filipino", {}).get("cer")), pct(hall),
        ])
    if args.md:
        print("| " + " | ".join(header) + " |")
        print("|" + "---|" * len(header))
        for l in lines:
            print("| " + " | ".join(l) + " |")
    else:
        w = [max(len(r[i]) for r in [header] + lines) for i in range(len(header))]
        for r in [header] + lines:
            print("  ".join(c.ljust(w[i]) for i, c in enumerate(r)))


if __name__ == "__main__":
    main()
