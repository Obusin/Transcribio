# Transcribio

Private transcription for **English, Filipino and Taglish** — the user's own device does the
speech recognition; recordings never leave it.

Status: **Phase 1 — local proof of concept**, plus local accounts and history. Drop a video → local
ASR (Whisper Turbo on WebGPU, WASM fallback) → timestamped transcript → edit → **Reviewer** (topics,
key terms, lists and review questions, organised on-device with no AI and quoted verbatim) → export
PDF, Word, TXT, SRT or VTT. No billing yet.

Separately, **`/convert` turns a PDF into an editable Word document** — also entirely on the device,
no account needed. It reads text-based PDFs; scans are refused rather than silently producing an
empty file (there's no OCR).

- Architecture, decisions and the Phase 3 quota design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Model benchmark (EN / FIL / Taglish, measured): [`MODEL_BENCHMARK.md`](MODEL_BENCHMARK.md)
- Reproducing the benchmark: [`bench/README.md`](bench/README.md)

## Develop

```bash
npm install
npm run dev          # http://localhost:3000 → /transcribe (sign in with any email; the code shows on screen locally)
npm test             # bun test: resampler, chunker, exporters, reviewer, cleanup guards
npm run typecheck && npm run lint
```

Needs a browser with WebGPU for good speed (Chrome/Edge 113+, Safari 26+). The first
transcription downloads the model (~1.6 GB, cached in the browser afterwards).

`/bench` is a dev-only page used by `bench/run_browser.mjs`; it returns 404 in production.
