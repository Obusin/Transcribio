# Transcribio — Architecture

Local-first transcription SaaS for English, Filipino and Taglish. The user's
device does the ASR; the (future) SaaS layer authorizes jobs and meters usage.

**Status (2026-09-12):** Phase 0 (benchmark) and Phase 1 (local proof of
concept) are done; **accounts plus history** are built (section 3b): local
email-code sign-in, per-account browser history, and opt-in *Save to my account*;
a finished transcript can organise itself into a **Reviewer** (section 3c); and a
separate **PDF → Word** converter runs on the same device-only principle (section 3d).
Quotas and billing are not built yet. The engine and model abstractions (§30–31)
are already the production shape, so later phases add layers around them rather
than rewriting.

---

## 1. What runs where

```
Browser main thread                         ASR Web Worker (off-main-thread)
───────────────────                         ─────────────────────────────────
TranscribeApp (state machine)                decodeToPcm16k   Mediabunny demux + WebCodecs decode,
  │                                            │              reads File slices on demand
  │  BrowserEngine (TranscriptionEngine)       ▼
  │    postMessage(File by reference) ───▶  StreamingResampler  any rate → 16 kHz mono
  │                                            ▼
  │                                         SpeechChunker     Silero VAD (ORT WASM), cut ≤28 s
  │                                            ▼
  │                                         language probe    first ~45 s → en | tl
  │    ◀─── progress / live segments          ▼
  │                                         Whisper (Transformers.js, WebGPU | WASM)
  ▼
TranscriptEditor ── IndexedDB (raw transcript + edits layer; media never stored)
```

The media file is passed to the worker **by reference** and streamed from disk;
it never leaves the device and is never fully loaded into memory. Retained PCM
is bounded to roughly one chunk (~30 s) regardless of file length.

## 2. Key decisions and the evidence behind them

| Decision | Why | Evidence |
|---|---|---|
| **Whisper large-v3-turbo** as the default model | Best accuracy/speed on EN/FIL/Taglish that runs in a browser. Qwen3-ASR is ~20 WER points worse on real Filipino and has no browser runtime. | `MODEL_BENCHMARK.md`; GigaSpeechBench paper (Qwen3-ASR-1.7B 51.6% vs Whisper-v3 30.9% on PHL) |
| **Decode with the `tl` language token for Filipino/Taglish** | In `en` mode Whisper *translates* Tagalog ("Ako? Nagseselos?" → "I'm a sinner"). `tl` keeps English words as spoken. | Forced-tl vs auto: Filipino CER 18.8% → 9.9%, Taglish Tagalog-word recall 76% → 84%, English WER unchanged/better |
| **We implement language detection ourselves** | Transformers.js ignores `language: null` and silently decodes as English (see `dist/transformers.web.js`, `_retrieve_init_tokens`). We score the `<|en|>`/`<|tl|>` logits over the first ~45 s of speech. | Code-verified in v4.2.0 |
| **VAD decides where to cut, not what to skip** | Silero misses speech over background music (p≈0.05 on audible dialogue in a vlog). Audio is skipped only if non-speech *and* quiet; loud non-speech is transcribed and flagged for hallucination filtering. | Long-form test: deletions 9.0% → 4.3%, missed reference segments 4 → 0 |
| Silero input includes 64-sample context | Speech recall 0.53 → 0.70 on Taglish clips | measured |
| Chunks cut at pauses, no padding across forced cuts | Avoids split words and duplicated words at seams | unit tests (`audio.test.ts`) |
| Streaming windowed-sinc resampler | Correct anti-aliasing (12 kHz tone fully rejected from 48 kHz), ~8 s per hour of audio | unit tests |
| Mediabunny + WebCodecs for demux/decode | Streams Blob slices — no `file.arrayBuffer()` on multi-GB videos. AudioContext fallback (≤512 MB) for codecs WebCodecs can't handle. | e2e test on MP4/AAC 48 kHz stereo |
| COOP/COEP `credentialless` | Cross-origin isolation → multi-threaded WASM, while still allowing CORS model downloads from Hugging Face | `next.config.ts` |
| Transcripts stored locally (IndexedDB), media never stored | Privacy positioning; "local-only mode" is the default today | — |

## 2b. Resource limits (Performance: Light / Balanced / Maximum)

Local ASR is heavy, and an unbounded run can take a laptop down. `src/lib/engine/resources.ts`
bounds each job:

| | Light (default for everyone) | Balanced | Maximum |
|---|---|---|---|
| GPU duty-cycle ceiling (worker rests between chunks) | 50% | 70% | 85% |
| ONNX Runtime WASM threads (CPU engine) | 25% of cores | 50% of cores | 75% of cores |
| Model build | q4f16 (0.56 GB) | fp16/q4 (1.6 GB) | fp16/q4 |

No profile uses the whole machine:
- **GPU:** every profile's duty is below 1, so the worker always rests between chunks.
- **CPU:** thread counts are a share of the cores with a reserve always kept free (a quarter of the cores,
  at least one), capped at 8. On WebGPU the WASM side only runs the VAD, so it's 1 thread regardless.
- **Adaptive:** the worker times each transcription chunk (ms of work per second of audio). If the recent
  pace is a sustained 1.5× slower than this run's typical good stretch — heat-throttling, or a heavy app
  opened — the duty is cut in proportion (floor 30%) and restored when the pace recovers. Language-detection
  chunks are excluded because they're far cheaper per second. `adaptiveDuty` in resources.ts.

Also:
- Everyone starts on Light (changed 2026-09-14). A user's own choice is remembered.
- Constrained devices (no WebGPU, ≤4 GB RAM, small GPU buffers, Intel integrated graphics) get the compact build on any profile.
- The worker is terminated 60 s after a job ends. That's the only way to return ONNX Runtime's WASM heap.
- If a job never finished (tab or machine crashed), the next visit switches to Light and says why.
- The level can be changed mid-job.

Measured on an M4 (16 GB) with a 2.09 GB, 45-min 1080p file (`bench/e2e.mjs --monitor`):

| while transcribing | before limits | Balanced | Light |
|---|---|---|---|
| CPU median / p95 | 77% / 206% | 40% / 103% | 16% / 96% |
| Browser RAM (steady) | ~0.55 GB | ~0.53 GB | ~0.67 GB |
| Speed | 7.6× realtime | 5.7× | 3.5× |
| WER vs reference | 39.3% | 39.3% (identical output) | 40.0% |

Where memory actually goes (`bench/diag_memory.mjs`, `bench/variant_memory.mjs`):

- **Media decoding is flat** (~0.5 GB for any file size). Mediabunny caps both its read cache (8 MiB) and its decode queue, and the chunker keeps about 30 s of PCM.
- **The model is the cost.** ONNX Runtime copies the model into its WASM heap to build the session. That heap never shrinks, so the pages stay committed until the OS compresses them or the worker is terminated.
- **Peak RAM while loading Turbo:** fp16/q4 2.6 GB, q4f16 1.95 GB, q4 3.5 GB. Download size is not memory.
- **The worker's JS heap is only ~30 MB.** Forcing GC does nothing, so this is not a leak.
- A real leak was fixed: calling the model directly for language detection returned KV-cache GPU buffers that were never disposed.

Not yet measured: Windows/NVIDIA, Intel/AMD iGPUs, 8 GB machines. That's the top Phase 2 item.

## 3. Code map

```
src/lib/engine/
  types.ts            TranscriptionEngine interface, Transcript/Segment, progress events
  models.ts           model registry (ASRModel + quantized variants, verified download sizes)
  capabilities.ts     WebGPU / shader-f16 / storage detection → recommendation (client-only)
  browser-engine.ts   TranscriptionEngine over a Web Worker (WebGPU or WASM)
  model-cache.ts      model manager: downloaded?, bytes used, delete, persistent storage
  worker/asr.worker.ts  decode → VAD → language probe → Whisper → segments
  worker/protocol.ts  typed worker messages
src/lib/audio/        decode.ts (Mediabunny), resample.ts, chunker.ts (+ tests)
src/lib/transcript/   format.ts (TXT/SRT/VTT), store.ts (IndexedDB), cleanup.ts,
                      document.ts + render-pdf.ts / render-docx.ts (+ tests)
src/lib/reviewer/     build.ts (topics, terms, lists, facts, questions),
                      document.ts (reviewer → export model), fixture.ts (+ tests)
src/lib/convert/      pdf-text.ts (PDF → headings/paragraphs), document.ts (→ export model) (+ tests)
src/components/       transcribe-app.tsx, transcript-editor.tsx, reviewer-panel.tsx,
                      pdf-to-word.tsx, device-status.tsx
src/app/              / (landing), /transcribe (app), /convert (PDF → Word), /bench (dev-only harness)
public/pdfjs/         vendored pdf.js worker, standard fonts and cmaps (3.6 MB, served same-origin)
bench/                benchmark pipeline (see bench/README.md)
```

Adding an engine = implement `TranscriptionEngine` (e.g. `DesktopLocalEngine`
talking to a localhost helper, `CloudEngine` posting to a worker queue).
Adding a model = add an `ASRModel` entry; nothing else refers to model names.

## 3a. Exports

TXT, SRT and VTT come from `format.ts`. **PDF** and **Word (.docx, also opens in Google Docs)** come from a single
document model, `document.ts`, so both always contain the same content: title, facts, partial/damaged/edited notes,
part headings for combined transcripts, and timestamped lines with edits applied.

- **Rendering:** entirely in the browser. `render-pdf.ts` uses pdf-lib with embedded, subset Noto Sans
  (`public/fonts`, OFL), so ñ, curly quotes and dashes render exactly. `render-docx.ts` uses docx.
- **Loading:** both libraries load only when their button is clicked.
- **Tests:** `export.test.ts` (files read back with macOS textutil and pdf-lib) and `bench/export_test.mjs`.

## 3b. Accounts and history (built, local — no cloud services)

- **Accounts:** passwordless email codes, handled by the app's own server. Data lives in a SQLite file, `data/transcribio.db` (Node's built-in `node:sqlite`). The server code is in `src/server/` (`db.ts`, `auth.ts`, `mail.ts`, `saved-transcripts.ts`, `http.ts`).
- **What's stored where:**

| Where | What |
|---|---|
| Browser cache (IndexedDB) | All history. One database per account per device (`transcribio-<userId>`). |
| App database (SQLite) | Users, sessions, and **only** transcripts where the user turned on *Save to my account*. |
| Nowhere | Media. It never leaves the device. |

- **Security:**
  - Codes are 6 digits and valid for 10 minutes. Each allows 5 guesses; a new code needs a 30 s wait, with at most 5 per hour per email.
  - Codes and session tokens are stored only as hashes.
  - The session cookie is httpOnly and SameSite=Lax (Secure in production), and every write checks the Origin header.
  - Every query is scoped by `user_id`. Verified by `bench/accounts_test.mjs` and a curl suite.
- **Email:** with `RESEND_API_KEY` set, codes are emailed. Without it, in development, the code is printed in the terminal and shown on the sign-in screen. In production without a key, sending fails loudly.
- **Migration:** history cached before accounts existed moves into the first account that signs in on that browser.
- **Sync:** last write wins by `updatedAt`. Signing in on a new device downloads saved transcripts; local edits to saved transcripts are pushed.
- **Deploy note:** serverless hosts (e.g. Vercel) don't keep a local file. Run on a host with a persistent disk, or replace `src/server/*.ts` with Postgres/Supabase; nothing else depends on SQLite.

## 3c. Reviewer — a finished transcript organises itself

A transcript can be switched to a **Reviewer** view: the same recording organised into topics, key
terms, lists, dates/laws and review questions. It is built by `src/lib/reviewer/build.ts` on the
device, with **no AI model and no network**. Every line is quoted verbatim from the transcript, so
nothing can be invented or silently "corrected", and each line keeps the time it was said (click a
timestamp to play from there).

Structure comes from what the speaker actually says:

| Part | Found by |
|---|---|
| Topics | The speaker's own cue phrases — "So next we have Elton Mayo", "Now let's go to human resources", "Pag unstructured naman…" — in English and Filipino. Lead-ins and asides ("Okay, how? …") are stripped before matching, and a new topic needs ≥30 s since the last one. Guarding on elapsed time rather than sentence count matters: sentence count reflects how the audio was segmented, not how long a topic ran. |
| Topic title | The words after the cue; for a stretch with no cue, the words that are frequent there but rare across the rest of the lecture. |
| Key terms | Spoken definition patterns: "When we say X…", "ang X ay…", "X refers to…", "tinatawag na X". The definition is the whole sentence, unedited. |
| Lists | A counting cue ("may dalawa klase ng interview", "types of…") followed by item cues ("Pag structured…", "first…", "una…"). |
| Dates, laws, figures | Years, Republic Act / Executive Order numbers, acronyms. |
| Questions | Generated only from the above — "What is X?", answered by the sentence that defined it. No question bank is invented. |

A recording with nothing to extract (a song, a short clip) is marked `thin` and says so instead of
padding itself out. A topic the speaker announced by name is kept even if short; one merely inferred
from its content needs at least two sentences to earn a heading.

**Exports:** the reviewer maps onto the same `ExportDoc` model as the transcript
(`src/lib/reviewer/document.ts`), so PDF and Word render it through the same renderers — while the
Reviewer view is open, the PDF and Word buttons export the reviewer. `ExportLine` gained an optional
bold `lead` and a `bullet`/`quiet` style for this; transcript exports are unchanged.

**Tests:** `build.test.ts` and `document.test.ts` run against verbatim excerpts of two real Taglish
lectures (`fixture.ts`) — ASR slips, fillers and all — plus `bench/reviewer_test.mjs` end-to-end in
the browser.

## 3d. PDF → Word (a separate tool at `/convert`)

Drop in a PDF, get an editable `.docx`. Like everything else here it runs **on the device**: the file
is read in the browser and never uploaded. It needs no account, since nothing is stored.

**Why it needs real work:** a PDF has no paragraphs. It is glyphs at coordinates, so structure has to
be inferred from geometry (`src/lib/convert/pdf-text.ts`):

| Step | Rule |
|---|---|
| Lines | Items sharing a baseline, tolerating the small shifts that superscripts and mixed fonts cause. Spaces are restored from horizontal gaps (>0.25 × font size), because a PDF often stores none. |
| Paragraphs | Lines flow together until the vertical gap exceeds 1.75 × the line height. A word broken across lines by a hyphen is put back together. |
| Headings | A line set ≥1.18 × the body size, and short enough to be a title. **Body size is character-weighted**, not a median over lines: a page has many body lines and few heading lines, but on a short document a plain median picks the heading and every heading then disappears. |
| Scans | A PDF with no text layer is **refused with an explanation** rather than producing an empty document. This tool does not do OCR. |

**Assets:** pdf.js (`pdfjs-dist`) plus its worker, standard fonts and cmaps are vendored into
`public/pdfjs/` and served same-origin — no CDN, which keeps conversion working offline and inside
the app's COEP `credentialless` headers. The ~1 MB library is imported only when a file is actually
converted. Tests use the package's `legacy/` build (the one meant for Node).

**Output:** the converted document maps onto the same `ExportDoc` model and Word renderer as the
transcript and reviewer exports. `render-docx.ts` and `render-pdf.ts` now collapse the timestamp
gutter when no line has a stamp, so a converted document isn't indented for a column it never uses.

**Known limits (stated in the UI too):** text, headings and paragraphs carry over; exact page layout,
columns, tables and images do not. A paragraph split across a page break stays two paragraphs.

**Tests:** `src/lib/convert/pdf-text.test.ts` covers the geometry rules directly and then round-trips
real PDFs (built with pdf-lib, read back with macOS `textutil`); `bench/convert_test.mjs` drives the
page in a browser, including the scanned-PDF refusal.

## 4. Phase 3 design — server-authorized jobs and quotas (not built yet)

The client is untrusted (§15). Usage is metered by **media duration**, not
processing time (§14). Recommended stack: Supabase (Postgres + Auth + RLS) with
Next.js route handlers, matching OBU Studio's default stack.

### Flow

```
client                                   server
──────                                   ──────
probe file → durationSeconds
POST /api/transcription/authorize  ───▶  auth user; load plan + subscription (server-side)
  { durationSeconds, modelId, mode }     remaining = plan.daily_seconds − used_today − reserved
                                         if duration > remaining → 402 QUOTA_EXCEEDED
                                         insert job (AUTHORIZED), reserve ceil(duration)
                              ◀───────   { jobId, token: HMAC(jobId, userId, maxSeconds, exp) }
local transcription (engine)
POST /jobs/:id/complete            ───▶  verify token + job ownership + status
  { processedSeconds, idempotencyKey }   charged = min(processedSeconds, authorized max)
                                         upsert usage_daily += charged (idempotent on key)
                                         release reservation; job → COMPLETED
POST /jobs/:id/cancel              ───▶  charge processed-so-far, release the rest
```

- **Reservation, not just a check:** authorizing reserves the duration so two
  tabs can't both pass the check. Unreleased reservations expire with the token (e.g. 6 h).
- **The authorized duration is the ceiling.** The client can report less (cancelled
  job) but never more. A client that lies about a file's duration only hurts itself
  within its own daily allowance — acceptable for v1 (§15: casual-abuse prevention,
  not DRM). Pro-tier hardening option: the engine reports periodic signed progress
  heartbeats, and the server rejects completions faster than any plausible RTF.
- **Idempotency keys** on usage events make retried requests safe.
- **Rate limiting** on `/authorize` per user and per IP.
- Transcript text is **not** sent to the server unless the user turns on sync.

### Schema sketch (Postgres)

```sql
create table plans (
  id text primary key,                          -- 'free' | 'pro'
  daily_transcription_seconds int not null,     -- free: 1800 (30 min)
  max_file_bytes bigint,
  max_projects int,
  ai_cleanup_daily_limit int,
  cloud_processing boolean not null default false,
  speaker_diarization boolean not null default false
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null,                       -- 'paymongo' | 'stripe'
  provider_customer_id text, provider_subscription_id text unique,
  plan text not null references plans,
  status text not null check (status in ('trialing','active','past_due','cancelled','expired')),
  current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  project_id uuid,
  status text not null,        -- CREATED AUTHORIZED LOADING PROCESSING POST_PROCESSING COMPLETED
                                -- CANCELLED FAILED QUOTA_EXCEEDED UNSUPPORTED_DEVICE
  duration_seconds int not null,               -- authorized (ceiling)
  processed_seconds int not null default 0,    -- charged
  processing_mode text not null,               -- local | cloud
  engine text, model text, language text,
  token_expires_at timestamptz not null,
  created_at timestamptz default now(), completed_at timestamptz
);

create table usage_daily (
  user_id uuid not null references auth.users on delete cascade,
  date date not null,                          -- in the user's billing timezone (Asia/Manila default)
  transcription_seconds int not null default 0,
  reserved_seconds int not null default 0,
  primary key (user_id, date)
);

create table usage_events (
  idempotency_key text primary key,
  job_id uuid not null references transcription_jobs,
  seconds int not null,
  created_at timestamptz default now()
);
-- RLS: users can SELECT their own rows; all writes go through server routes
-- (service role) so quota math is never client-controlled.
```

"Daily" should reset at midnight **Asia/Manila** for the PH market (store the
timezone on the profile; don't use UTC midnight, which is 8 AM in Manila).

## 5. Roadmap from here

| Phase | Next concrete steps |
|---|---|
| 2 Browser engine hardening | Test on Windows/NVIDIA, Intel/AMD iGPU, 8 GB Macs; WASM fallback speed; model-download resume; OOM handling; Safari/Firefox codec matrix |
| 3 SaaS layer | Supabase auth, `plans`/`jobs`/`usage_daily` as above, `/authorize` + `/complete`, dashboard with "x / 30 free minutes used today" |
| 4 Editor | Word-level timestamps (`_timestamped` ONNX variant), speaker labels, keyboard navigation, undo |
| 5 Billing | PayMongo (PH: GCash/Maya/cards) behind a provider interface; webhook verification; instant limit upgrade |
| 6 LLM | Clean / remove fillers / summary / action items as *separate* layers; prompt forbids translation and invented content |
| 7 Desktop engine | Tauri helper on localhost; MLX on Apple Silicon (measured below), faster-whisper/CUDA on NVIDIA |
| 8 Cloud fallback | Same `TranscriptionEngine` interface; cloud-specific quota; media deleted after retention |
| 9 Hardening | See spec §40 Phase 9 |

## 6. Known limitations (honest list)

- Measured only on an Apple M4 (16 GB). No Windows/NVIDIA/iGPU/low-RAM data yet.
- Accuracy numbers come from GigaSpeechBench (vlogs/podcasts/broadcast). Meetings,
  phone calls and noisy rooms still need a small in-house test set (see bench/README.md).
- No speaker diarization yet (§24); segments have no speaker labels.
- Segment timestamps only (no word-level), which is sufficient for SRT/VTT.
- Model download is ~1.6 GB on first use; it is cached, but interrupted
  downloads restart the file in progress.
