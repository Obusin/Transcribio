@AGENTS.md

# Transcribio — project notes

Local-first transcription SaaS (EN / Filipino / Taglish). Read `docs/ARCHITECTURE.md` first.

Non-obvious rules learned the hard way:

- **Never let Whisper decode Tagalog with the `en` token** — it translates. Transformers.js
  treats `language: undefined` as English, so language is always resolved explicitly
  (`resolveLanguage` in `src/lib/engine/worker/asr.worker.ts`). Default for Filipino/Taglish is `tl`.
- **The VAD decides where to cut, not what to skip.** Silero misses speech over music. Don't
  reintroduce "skip non-speech" without re-running the long-form test (`bench/e2e.mjs`).
- Silero v5 needs the 64-sample context prefix; don't remove it.
- Never `file.arrayBuffer()` a user's media except in the capped AudioContext fallback.
- The raw transcript is immutable; edits and AI output are separate layers.
- Resource limits live in `src/lib/engine/resources.ts`. Download size ≠ RAM (ORT copies the model
  into a WASM heap that never shrinks); measure with `bench/e2e.mjs --monitor` / `bench/variant_memory.mjs`.
- Any model/quantization change must be benchmarked: `bench/run_browser.mjs` + `bench/score.py`.
- Accounts are local: email codes plus a SQLite file (`data/`) via `src/server/`. History lives in per-account IndexedDB;
  only *Save to my account* transcripts go to the server. Harnesses sign in with `bench/signin.mjs` (local-mode codes).
- Tests: `npm test` (bun). Typecheck: `npm run typecheck`.
- `export const runtime = 'edge'` is deprecated in Next 16.3 — pages here are static; don't add it.
