# Benchmark pipeline

Everything needed to reproduce `MODEL_BENCHMARK.md`.

## Data

[GigaSpeechBench](https://huggingface.co/datasets/speechcolab/GigaSpeechBench) (CC BY 4.0) — real-world
recordings (vlogs, podcasts, interviews, broadcast), not read speech:

- `Low-Resource-Languages/data/PHL` — conversational Filipino, 21.5 h (108 recordings)
- `CH-EN-Dialects/data/PHL-EN` — labelled "code-switching", but in practice Philippine-accented
  English (only ~0.5% of its segments contain Tagalog), 10.8 h (37 recordings)

Evaluation buckets (see `textnorm.classify`):

| bucket | source | rule |
|---|---|---|
| `english` | PHL-EN | no Tagalog function words |
| `taglish` | PHL | ≥25% English words (and ≥2) — real code-switching |
| `filipino` | PHL | ≤10% English words |

150 segments per bucket, 3–28 s each, round-robin across recordings, fixed seed → ~50 min of audio.

```bash
# download (≈5.4 GB) into bench/data/gsb/{phl,phl-en}/audio + metadata json
BASE=https://huggingface.co/datasets/speechcolab/GigaSpeechBench/resolve/main
mkdir -p bench/data/gsb/{phl,phl-en}
curl -L $BASE/CH-EN-Dialects/data/PHL-EN/metadata.json -o bench/data/gsb/phl-en.json
curl -L $BASE/Low-Resource-Languages/data/PHL/metadata.json -o bench/data/gsb/phl.json
curl -L $BASE/CH-EN-Dialects/data/PHL-EN/audio.tar.gz | tar -xz -C bench/data/gsb/phl-en
curl -L $BASE/Low-Resource-Languages/data/PHL/audio.tar.gz | tar -xz -C bench/data/gsb/phl

uv venv --python 3.12 bench/.venv
uv pip install --python bench/.venv/bin/python mlx-whisper jiwer soundfile numpy onnxruntime
bench/.venv/bin/python bench/build_subset.py --per-bucket 150
ln -sfn ../bench/data/subset public/bench-data   # lets /bench fetch the clips in dev
```

## Runs

```bash
# Full-precision reference (Apple Silicon, MLX) — also the desktop-engine candidate
bench/.venv/bin/python bench/run_mlx.py --model mlx-community/whisper-large-v3-turbo --language tl

# The shipping browser engine (same worker, VAD, language logic, quantized ONNX) in headless Chromium + WebGPU
npm run dev
node bench/run_browser.mjs --url http://localhost:3000 --model whisper-large-v3-turbo --variant 0 --language auto

# End-to-end through the real UI with a long file, then long-form WER
node bench/e2e.mjs --file bench/data/longform/taglish-interview.mp4
bench/.venv/bin/python bench/score_longform.py bench/data/longform/taglish-interview.mp4.auto.json --aid 'PHL#aeb859b265e7'

bench/.venv/bin/python bench/score.py --md       # results table

# Resource use (CPU / RAM / GPU memory over a whole job), per performance level
node bench/e2e.mjs --file big.mp4 --profile light --monitor 1 --idle-check 1 --crash-check 1
node bench/diag_memory.mjs --url http://localhost:3000 --file clip.mp4 --profile light   # JS heap vs WASM (vmmap)
node bench/variant_memory.mjs --url http://localhost:3000 --variants 0,1,2              # RAM per model build
bench/.venv/bin/python bench/score_concat.py bench/data/longform/big-2gb.*.json         # accuracy per level
node bench/cancel_test.mjs --url http://localhost:3000 --file bench/data/longform/taglish-interview.mp4  # cancel/pause flows
node bench/continue_test.mjs --url http://localhost:3000 --file bench/data/longform/taglish-interview.mp4 # stop+keep → continue, again, new
node bench/combine_test.mjs --url http://localhost:3000                                              # combine two recordings into parts
node bench/accounts_test.mjs --url http://localhost:3000                                             # sign-in, per-account history, save to account
node bench/export_test.mjs --url http://localhost:3000                                               # PDF + Word downloads from the editor
node bench/reviewer_test.mjs --url http://localhost:3000                                             # reviewer view + its PDF/Word exports
node bench/convert_test.mjs --url http://localhost:3000                                              # PDF → Word conversion (no sign-in needed)

# Safari's engine: Playwright ≥1.63 has a WebKit build for macOS 26 (1.58 doesn't). Install it anywhere,
# then point the harness at it (Safari isn't cross-origin isolated — no SharedArrayBuffer — and is ~2× slower):
#   (cd /tmp/pw && npm i playwright-core@latest && npx playwright-core install webkit)
#   PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core/index.mjs node bench/e2e.mjs --browser webkit --profile-dir /tmp/wk ...
```

## Metrics

- **WER / CER** after `textnorm.normalize` on both sides (lowercase, strip punctuation and
  annotation markup, drop fillers). No number expansion or Tagalog respelling, so some
  "errors" are spelling variants (`sainyo` vs `sa inyo`, `nang` vs `ng`) — CER is the better
  signal for Filipino.
- **tl_recall / en_recall** — share of reference Tagalog / English words the alignment marks
  correct in the Taglish bucket. A model that translates Taglish keeps en_recall and loses tl_recall.
- **halluc** — share of clips whose output is >2× the reference length + 3 words.

## Still needed (in-house set)

GigaSpeechBench has no meetings, phone calls, or noisy rooms. Before launch, record ~1 h of
consented OBU Studio client calls/meetings (Zoom/Meet exports, phone recordings), transcribe by hand, drop
them in as a fourth source, and re-run. That set also tests proper names, numbers and dates (§8).
