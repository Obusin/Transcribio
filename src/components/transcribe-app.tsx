"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { probeMedia, type MediaInfo } from "@/lib/audio/decode";
import { BrowserEngine } from "@/lib/engine/browser-engine";
import { requestPersistentStorage } from "@/lib/engine/model-cache";
import { chooseVariant, defaultProfile, PROFILES, type ResourceProfile } from "@/lib/engine/resources";
import { localDeviceId } from "@/lib/deployment";
import { track } from "@/lib/telemetry";
import { takePendingFile } from "@/lib/marketing/handoff";
import { TranscriptionCancelled, type LanguageChoice, type Segment } from "@/lib/engine/types";
import { clock } from "@/lib/transcript/format";
import { combineTranscripts, describeGap, gapBetween, orderForCombine, suggestTitle } from "@/lib/transcript/combine";
import { account, persist, syncWithAccount } from "@/lib/transcript/account-sync";
import { appendContinuation } from "@/lib/transcript/merge";
import { adoptLegacyHistory, selectAccountCache, transcripts, type StoredTranscript } from "@/lib/transcript/store";
import { AccountMenu } from "./account-menu";
import { DeviceStatus, formatMB, useDevice } from "./device-status";
import { TranscriptEditor } from "./transcript-editor";

type Phase =
  | { name: "home" }
  | { name: "setup"; file: File; info: MediaInfo | null; probeError: string | null }
  | { name: "loading"; file: File; loaded: number; total: number }
  | {
      name: "transcribing";
      file: File;
      processed: number;
      duration: number;
      rtf: number | null;
      message: string | null;
      paused: boolean;
      /** Cancel was pressed: showing the keep/discard choice. */
      confirmStop: boolean;
      /** Stop requested; waiting for the current chunk to finish. */
      stopping: boolean;
    }
  | { name: "editor"; record: StoredTranscript; file: File | null }
  | { name: "error"; message: string; file: File | null };

// One engine for the page lifetime: the model stays loaded between jobs.
let engine: BrowserEngine | null = null;
const getEngine = () => (engine ??= new BrowserEngine());

const LANGUAGES: { value: LanguageChoice; label: string; hint: string }[] = [
  { value: "auto", label: "Auto-detect", hint: "English, Filipino or Taglish" },
  { value: "tl", label: "Filipino / Taglish", hint: "Keeps English words as spoken" },
  { value: "en", label: "English only", hint: "Best for recordings with no Filipino" },
];

/** `userId` is null on the hosted, account-less deployment. */
export function TranscribeApp({ userId }: { userId: string | null }) {
  const { caps, rec } = useDevice();
  const [phase, setPhase] = useState<Phase>({ name: "home" });
  const [language, setLanguage] = useState<LanguageChoice>("auto");
  const [live, setLive] = useState<Segment[]>([]);
  const [history, setHistory] = useState<StoredTranscript[]>([]);
  const [cacheKey, setCacheKey] = useState(0);
  const hydrated = useHydrated();
  // If the previous transcription never finished (tab or machine crashed),
  // start this session in Light mode and say why.
  const [crashedWith] = useState(readActiveJob);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [chosenProfile, setChosenProfile] = useState<ResourceProfile | null>(() =>
    readActiveJob() ? "light" : readStoredProfile(),
  );
  useEffect(() => {
    if (!crashedWith) return;
    try {
      localStorage.setItem(PROFILE_KEY, "light");
      localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      /* ignore */
    }
  }, [crashedWith]);
  // Until the user picks one, constrained devices default to Light.
  const profile = chosenProfile ?? defaultProfile(caps);
  const setProfile = (p: ResourceProfile) => {
    setChosenProfile(p);
    try {
      localStorage.setItem(PROFILE_KEY, p);
    } catch {
      /* storage unavailable — keep it for this session only */
    }
    getEngine().setProfile(p); // applies immediately to a running job
  };

  const [notice, setNotice] = useState<string | null>(null);
  const refreshHistory = () => transcripts.list().then(setHistory).catch(() => setHistory([]));
  // Open this account's browser cache, adopt pre-account history, then pull
  // down anything saved to the account from another device.
  useEffect(() => {
    // Without accounts the cache is namespaced by a random per-browser id, so
    // history still survives reloads without anyone signing in.
    selectAccountCache(userId ?? localDeviceId());
    let alive = true;
    (async () => {
      const adopted = await adoptLegacyHistory().catch(() => 0);
      await refreshHistory();
      const downloaded = await syncWithAccount().catch(() => 0);
      if (downloaded) await refreshHistory();
      if (!alive) return;
      const bits = [
        adopted ? `${adopted} transcript${adopted > 1 ? "s" : ""} from this browser moved into your account's history` : "",
        downloaded ? `${downloaded} saved transcript${downloaded > 1 ? "s" : ""} downloaded from your account` : "",
      ].filter(Boolean);
      if (bits.length) setNotice(`${bits.join(" · ")}.`);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  // Warn before closing the tab mid-transcription.
  const busy = phase.name === "loading" || phase.name === "transcribing";
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    // A deliberate close isn't a crash: pagehide fires on close/navigation,
    // never when the tab or machine dies, so only real crashes leave the marker.
    const left = () => clearActiveJob();
    window.addEventListener("beforeunload", h);
    window.addEventListener("pagehide", left);
    return () => {
      window.removeEventListener("beforeunload", h);
      window.removeEventListener("pagehide", left);
    };
  }, [busy]);

  const chooseFile = async (file: File) => {
    setPhase({ name: "setup", file, info: null, probeError: null });
    try {
      const info = await probeMedia(file);
      track("file_selected", { durationSeconds: info?.durationSeconds, deviceTier: rec?.tier });
      setPhase({ name: "setup", file, info, probeError: null });
    } catch (err) {
      setPhase({ name: "setup", file, info: null, probeError: err instanceof Error ? err.message : String(err) });
    }
  };

  // A file dropped on a funnel landing page survives the client-side navigation
  // into this route (see src/lib/marketing/handoff.ts), so pick it up once on
  // mount and go straight to setup rather than making the visitor choose twice.
  // Read once, but hold the file in a ref until it is actually used: in dev,
  // StrictMode mounts and discards a first pass, and taking the file there
  // would drop it on the floor before the surviving mount ever sees it.
  const handoffRead = useRef(false);
  const handoffFile = useRef<File | null>(null);
  useEffect(() => {
    if (!handoffRead.current) {
      handoffRead.current = true;
      handoffFile.current = takePendingFile();
    }
    const handed = handoffFile.current;
    if (!handed) return;
    // Deferred so the hand-off lands as its own update rather than cascading
    // out of this effect's body.
    const t = setTimeout(() => {
      handoffFile.current = null;
      void chooseFile(handed);
    }, 0);
    return () => clearTimeout(t);
    // Mount-only by design; chooseFile only drives local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reported once per session, and only after device detection resolves — the
  // whole point is to see failures against the hardware they happened on.
  const openedSent = useRef(false);
  useEffect(() => {
    if (openedSent.current || !rec) return;
    openedSent.current = true;
    track("app_opened", { webgpu: caps?.webgpu, deviceTier: rec.tier });
  }, [rec, caps]);

  /** `continueFrom`: resume a partial transcript where it stopped and append to it. */
  const start = async (file: File, info: MediaInfo | null, continueFrom?: StoredTranscript) => {
    if (!rec?.modelId) return;
    const modelId = rec.modelId;
    track("transcribe_started", {
      durationSeconds: info?.durationSeconds,
      profile,
      modelId,
      language,
      webgpu: caps?.webgpu,
      deviceTier: rec.tier,
    });
    const startAt = continueFrom?.raw.partial?.stoppedAtSeconds ?? 0;
    // Keep decoding in the language already detected for this recording.
    const jobLanguage = (continueFrom?.raw.detectedLanguages[0] as LanguageChoice | undefined) ?? language;
    const eng = getEngine();
    setLive([]);
    markActiveJob(profile);
    try {
      void requestPersistentStorage();
      setPhase({ name: "loading", file, loaded: 0, total: 0 });
      await eng.loadModel(
        modelId,
        (e) => {
          if (e.stage === "loading-model") setPhase({ name: "loading", file, loaded: e.loadedBytes, total: e.totalBytes });
        },
        undefined,
        profile,
      );
      setCacheKey((k) => k + 1);
      const duration = info?.durationSeconds ?? continueFrom?.raw.durationSeconds ?? 0;
      setPhase({
        name: "transcribing",
        file,
        processed: startAt,
        duration,
        rtf: null,
        message: "Reading audio",
        paused: false,
        confirmStop: false,
        stopping: false,
      });

      const onProgress = (e: Parameters<Parameters<typeof eng.transcribe>[2]>[0]) => {
        // The preview only shows the tail; don't grow state for multi-hour files.
        if (e.stage === "segment") setLive((l) => [...l.slice(-(LIVE_LINES - 1)), e.segment]);
        else if (e.stage === "transcribing")
          setPhase((p) =>
            p.name === "transcribing"
              ? { ...p, processed: e.processedSeconds, duration: e.durationSeconds || p.duration, rtf: e.realtimeFactor, message: null }
              : p,
          );
        else if (e.stage === "preparing")
          setPhase((p) => (p.name === "transcribing" && p.processed <= startAt ? { ...p, message: e.message } : p));
      };
      const transcript = await eng.transcribe(
        file,
        { modelId, language: jobLanguage, profile },
        onProgress,
        info?.durationSeconds ?? continueFrom?.raw.durationSeconds,
        startAt,
      );

      const now = new Date().toISOString();
      const record: StoredTranscript = continueFrom
        ? { ...continueFrom, raw: appendContinuation(continueFrom.raw, transcript), updatedAt: now }
        : {
            id: crypto.randomUUID(),
            title: file.name.replace(/\.[^.]+$/, ""),
            fileName: file.name,
            fileSize: file.size,
            hasVideo: info?.hasVideo ?? file.type.startsWith("video/"),
            createdAt: now,
            updatedAt: now,
            raw: transcript,
            edits: {},
          };
      await persist(record);
      void refreshHistory();
      track("transcribe_finished", {
        durationSeconds: transcript.durationSeconds,
        realtimeFactor: transcript.stats?.realtimeFactor,
        profile,
        modelId,
        language,
        webgpu: caps?.webgpu,
        deviceTier: rec?.tier,
      });
      setPhase({ name: "editor", record, file });
    } catch (err) {
      if (err instanceof TranscriptionCancelled) {
        track("transcribe_cancelled", { profile, modelId, deviceTier: rec?.tier });
        // Discarding a continuation leaves the transcript as it was.
        setPhase(continueFrom ? { name: "editor", record: continueFrom, file } : { name: "setup", file, info, probeError: null });
        return;
      }
      console.error(err);
      track("transcribe_failed", {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        profile,
        modelId,
        webgpu: caps?.webgpu,
        deviceTier: rec?.tier,
      });
      setPhase({ name: "error", message: friendlyError(err), file });
      // A GPU reset can leave the worker unusable; start clean next time.
      void eng.dispose();
    } finally {
      clearActiveJob();
      // Give the GPU memory back if the user doesn't start another job soon.
      eng.releaseWhenIdle();
    }
  };

  if (phase.name === "editor") {
    return (
      <TranscriptEditor
        key={phase.record.id}
        record={phase.record}
        file={phase.file}
        onAttachFile={(f) => setPhase({ ...phase, file: f })}
        onNewFile={chooseFile}
        onTranscribeAgain={chooseFile}
        onContinue={(record, f) => void start(f, null, record)}
        onBack={() => {
          void refreshHistory();
          setPhase({ name: "home" });
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-20 pt-4">
      {phase.name === "home" && (
        <>
          {/* Time of day is only known in the browser (the page is prerendered). */}
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">{hydrated ? greeting() : "\u00a0"}</h1>
          {hydrated && crashedWith && !noticeDismissed && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl bg-warn-soft p-4 text-sm text-warn">
              <p>
                Your last transcription stopped before it finished — your computer may have run low on memory.
                We&apos;ve switched to <strong>Light</strong> performance, which uses a smaller model and gives your
                graphics card rest breaks.
              </p>
              <button onClick={() => setNoticeDismissed(true)} className="shrink-0 font-medium hover:underline">
                OK
              </button>
            </div>
          )}
          {notice && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl bg-accent-soft p-4 text-sm text-accent">
              <p>{notice}</p>
              <button onClick={() => setNotice(null)} className="shrink-0 font-medium hover:underline">
                OK
              </button>
            </div>
          )}
          <DropZone onFile={chooseFile} disabled={rec?.tier === "unsupported"} />
          <div className="mt-4">
            <DeviceStatus caps={caps} rec={rec} profile={profile} refreshKey={cacheKey} />
          </div>
          <History
            items={history}
            onOpen={(record) => setPhase({ name: "editor", record, file: null })}
            onDelete={async (t) => {
              if (t.savedToAccount) await account.remove(t.id).catch(() => {});
              await transcripts.delete(t.id);
              void refreshHistory();
            }}
            onCombine={async (combined) => {
              await persist(combined);
              void refreshHistory();
              setPhase({ name: "editor", record: combined, file: null });
            }}
          />
        </>
      )}

      {phase.name === "setup" && (
        <SetupCard
          file={phase.file}
          info={phase.info}
          probeError={phase.probeError}
          language={language}
          onLanguage={setLanguage}
          profile={profile}
          onProfile={setProfile}
          downloadMB={rec?.modelId && caps ? chooseVariant(rec.modelId, caps, profile)?.downloadMB ?? null : null}
          onStart={() => start(phase.file, phase.info)}
          onCancel={() => setPhase({ name: "home" })}
          // Other probe failures may still decode via the AudioContext fallback.
          disabled={!rec?.modelId || /no audio track/i.test(phase.probeError ?? "")}
        />
      )}

      {phase.name === "loading" && (
        <Panel title="Getting the model ready" file={phase.file}>
          <Bar value={phase.total ? phase.loaded / phase.total : 0} />
          <div className="mt-3 flex items-center justify-between gap-4 text-sm text-muted">
            <p>
              {phase.total
                ? `${formatMB(phase.loaded)} of ${formatMB(phase.total)} · one-time download, cached for next time`
                : "Loading…"}
            </p>
            <button
              onClick={() => getEngine().cancelLoading()}
              className="h-8 shrink-0 rounded-full border border-line px-3.5 text-xs font-medium text-ink hover:border-danger hover:text-danger"
            >
              Cancel
            </button>
          </div>
        </Panel>
      )}

      {phase.name === "transcribing" && (
        <Panel title={phase.paused ? "Paused" : "Transcribing…"} file={phase.file}>
          <div className="flex items-baseline justify-between">
            <span className="text-4xl font-semibold tabular-nums tracking-tight">
              {phase.duration ? Math.floor((100 * phase.processed) / phase.duration) : 0}%
            </span>
            <span className="font-mono text-sm tabular-nums text-muted">
              {clock(phase.processed)} / {phase.duration ? clock(phase.duration) : "—"}
            </span>
          </div>
          <div className="mt-3">
            <Bar value={phase.duration ? phase.processed / phase.duration : 0} />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>
              {phase.message ?? "Local processing"}
              {phase.rtf ? ` · ${phase.rtf.toFixed(1)}× realtime` : ""}
            </span>
            {!phase.confirmStop && !phase.stopping && (
              <span className="flex gap-2">
                <button
                  onClick={() => {
                    if (phase.paused) getEngine().resume();
                    else getEngine().pause();
                    setPhase((p) => (p.name === "transcribing" ? { ...p, paused: !p.paused } : p));
                  }}
                  className="h-8 rounded-full border border-line px-3.5 text-xs font-medium text-ink hover:border-ink"
                >
                  {phase.paused ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={() => setPhase((p) => (p.name === "transcribing" ? { ...p, confirmStop: true } : p))}
                  className="h-8 rounded-full border border-line px-3.5 text-xs font-medium text-ink hover:border-danger hover:text-danger"
                >
                  Cancel
                </button>
              </span>
            )}
            {phase.stopping && <span className="text-xs">Stopping after the current section…</span>}
          </div>
          {phase.confirmStop && !phase.stopping && (
            <div className="mt-4 rounded-2xl bg-paper p-4 text-sm">
              <p className="font-medium">Stop transcribing?</p>
              <p className="mt-1 text-muted">
                {live.length
                  ? `You can keep the ${clock(phase.processed)} already transcribed, or discard it.`
                  : "Nothing has been transcribed yet."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {live.length > 0 && (
                  <button
                    onClick={() => {
                      setPhase((p) => (p.name === "transcribing" ? { ...p, stopping: true } : p));
                      void getEngine().cancel(true);
                    }}
                    className="h-9 rounded-full bg-accent px-4 text-xs font-medium text-accent-ink hover:opacity-90"
                  >
                    Keep what&apos;s done ({clock(phase.processed)})
                  </button>
                )}
                <button
                  onClick={() => {
                    setPhase((p) => (p.name === "transcribing" ? { ...p, stopping: true } : p));
                    void getEngine().cancel(false);
                  }}
                  className="h-9 rounded-full border border-line px-4 text-xs font-medium hover:border-danger hover:text-danger"
                >
                  Discard
                </button>
                <button
                  onClick={() => setPhase((p) => (p.name === "transcribing" ? { ...p, confirmStop: false } : p))}
                  className="h-9 rounded-full px-4 text-xs font-medium text-muted hover:text-ink"
                >
                  Keep going
                </button>
              </div>
            </div>
          )}
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
            <span className="text-muted">Performance</span>
            <ProfilePicker value={profile} onChange={setProfile} compact />
          </div>
          <LivePreview segments={live} />
        </Panel>
      )}

      {phase.name === "error" && (
        <Panel title="Something went wrong" file={phase.file}>
          <p className="text-sm leading-relaxed text-danger">{phase.message}</p>
          <div className="mt-5 flex gap-2">
            {phase.file && (
              <button
                onClick={() => chooseFile(phase.file!)}
                className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink"
              >
                Try again
              </button>
            )}
            <button onClick={() => setPhase({ name: "home" })} className="h-10 rounded-full border border-line px-5 text-sm">
              Back
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

const PROFILE_KEY = "transcribio.profile";
const ACTIVE_JOB_KEY = "transcribio.activeJob";

/** false on the server and during hydration, true afterwards. */
function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function readActiveJob(): ResourceProfile | null {
  try {
    const v = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_JOB_KEY) : null;
    return v ? ((JSON.parse(v).profile as ResourceProfile) ?? "balanced") : null;
  } catch {
    return null;
  }
}

function markActiveJob(profile: ResourceProfile) {
  try {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ profile, startedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearActiveJob() {
  try {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    /* ignore */
  }
}
const LIVE_LINES = 40;

function readStoredProfile(): ResourceProfile | null {
  try {
    const v = typeof window !== "undefined" ? localStorage.getItem(PROFILE_KEY) : null;
    return v && v in PROFILES ? (v as ResourceProfile) : null;
  } catch {
    return null;
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/out of memory|allocation|GPUBuffer|device lost|Device was lost|WorkerError|crashed/i.test(msg)) {
    return "Your graphics card ran out of memory or was reset. Switch Performance to Light (it uses a smaller model and gives the GPU rest breaks), close other heavy apps, and try again.";
  }
  if (/Unsupported configuration|isConfigSupported|can't decode|Unable to decode|EncodingError|decodeAudioData/i.test(msg)) {
    return "This browser couldn't read the audio in this file. Try Chrome or Edge — or, if the recording came from OBS, make sure it had finished recording before you opened it.";
  }
  if (/fetch|network|Failed to download|Load failed/i.test(msg)) {
    return "The model download was interrupted. Check your connection and try again — progress already downloaded is kept.";
  }
  return msg;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

function DropZone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
      className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
        over ? "border-accent bg-accent-soft" : "border-line bg-surface"
      }`}
    >
      <p className="text-lg font-medium">Drop your video or audio here</p>
      <p className="mt-1 text-sm text-muted">MP4, MOV, MKV, WebM, MP3, M4A, WAV — any length</p>
      <button
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="mt-6 h-11 rounded-full bg-accent px-6 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40"
      >
        Choose file
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*,.mkv,.mov"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted">
        <LockIcon /> Your file stays on your device. Nothing is uploaded.
      </p>
    </div>
  );
}

function SetupCard(props: {
  file: File;
  info: MediaInfo | null;
  probeError: string | null;
  language: LanguageChoice;
  onLanguage: (l: LanguageChoice) => void;
  profile: ResourceProfile;
  onProfile: (p: ResourceProfile) => void;
  downloadMB: number | null;
  onStart: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const { file, info } = props;
  return (
    <Panel title="Ready to transcribe" file={file}>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted">Duration</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{info ? clock(info.durationSeconds) : props.probeError ? "—" : "Reading…"}</dd>
        </div>
        <div>
          <dt className="text-muted">Size</dt>
          <dd className="mt-0.5 font-medium">{formatMB(file.size)}</dd>
        </div>
      </dl>
      {props.probeError && <p className="mt-4 rounded-xl bg-warn-soft p-3 text-sm text-warn">{props.probeError}</p>}

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm text-muted">Language</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {LANGUAGES.map((l) => (
            <label
              key={l.value}
              className={`cursor-pointer rounded-xl border p-3 text-sm transition-colors ${
                props.language === l.value ? "border-accent bg-accent-soft" : "border-line hover:border-ink"
              }`}
            >
              <input
                type="radio"
                name="language"
                value={l.value}
                checked={props.language === l.value}
                onChange={() => props.onLanguage(l.value)}
                className="sr-only"
              />
              <div className="font-medium">{l.label}</div>
              <div className="mt-0.5 text-xs text-muted">{l.hint}</div>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm text-muted">Performance</legend>
        <ProfilePicker value={props.profile} onChange={props.onProfile} />
        <p className="mt-2 text-xs text-muted">{PROFILES[props.profile].hint}</p>
      </fieldset>

      <div className="mt-6 flex items-center justify-between rounded-xl bg-paper px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <LockIcon /> Local processing
        </span>
        <span className="text-muted">
          {props.downloadMB ? `Model ${formatMB(props.downloadMB * 1e6)}` : "Recommended model"}
        </span>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={props.onStart}
          disabled={props.disabled}
          className="h-11 flex-1 rounded-full bg-accent text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40"
        >
          Start transcription
        </button>
        <button onClick={props.onCancel} className="h-11 rounded-full border border-line px-5 text-sm hover:border-ink">
          Cancel
        </button>
      </div>
    </Panel>
  );
}

function ProfilePicker({
  value,
  onChange,
  compact,
}: {
  value: ResourceProfile;
  onChange: (p: ResourceProfile) => void;
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Performance" className="inline-flex rounded-full border border-line bg-paper p-0.5">
      {(Object.keys(PROFILES) as ResourceProfile[]).map((p) => (
        <button
          key={p}
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={`rounded-full font-medium transition-colors ${compact ? "h-7 px-3 text-xs" : "h-8 px-4 text-sm"} ${
            value === p ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
          }`}
        >
          {PROFILES[p].label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, file, children }: { title: string; file: File | null; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
      {file && <p className="truncate text-sm text-muted">{file.name}</p>}
      <h2 className="mb-6 mt-1 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

function LivePreview({ segments }: { segments: Segment[] }) {
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chromium returns a Promise from scrollIntoView, and an
  // effect that returns a non-function crashes React ("destroy is not a function").
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [segments.length]);
  if (!segments.length) return null;
  return (
    <div className="mt-6 max-h-64 overflow-y-auto rounded-xl bg-paper p-4 text-sm leading-relaxed">
      {segments.slice(-40).map((s) => (
        <p key={s.id} className="mb-2">
          <span className="mr-2 font-mono text-xs text-muted">{clock(s.start)}</span>
          {s.text}
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}

function History({
  items,
  onOpen,
  onDelete,
  onCombine,
}: {
  items: StoredTranscript[];
  onOpen: (t: StoredTranscript) => void;
  onDelete: (t: StoredTranscript) => void;
  onCombine: (combined: StoredTranscript) => void;
}) {
  const [combining, setCombining] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  if (!items.length) return null;

  const picked = items.filter((t) => selected.includes(t.id));
  // Recording order from the file names unless the user rearranged it.
  const ordered = manualOrder
    ? manualOrder.map((id) => picked.find((t) => t.id === id)!).filter(Boolean)
    : orderForCombine(picked);
  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setManualOrder(null);
    setTitle(null);
  };
  const move = (i: number, by: -1 | 1) => {
    const ids = ordered.map((t) => t.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    setManualOrder(ids);
  };
  const reset = () => {
    setCombining(false);
    setSelected([]);
    setManualOrder(null);
    setTitle(null);
  };

  return (
    <section className="mt-10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">{combining ? "Select the recordings to combine" : "Recent transcripts"}</h2>
        {items.length >= 2 &&
          (combining ? (
            <button onClick={reset} className="text-xs font-medium text-muted hover:text-ink">
              Cancel
            </button>
          ) : (
            <button onClick={() => setCombining(true)} className="text-xs font-medium text-accent hover:underline">
              Combine recordings…
            </button>
          ))}
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((t) => (
          <li key={t.id} className="group flex items-center justify-between gap-4 py-3">
            {combining && (
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                onChange={() => toggle(t.id)}
                aria-label={`Include ${t.title}`}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
            )}
            <button onClick={() => (combining ? toggle(t.id) : onOpen(t))} className="min-w-0 flex-1 text-left">
              <div className="truncate font-medium group-hover:text-accent">{t.title}</div>
              <div className="text-xs text-muted">
                {t.raw.partial ? `${clock(t.raw.partial.stoppedAtSeconds)} of ${clock(t.raw.durationSeconds)} (partial)` : clock(t.raw.durationSeconds)}
                {t.parts ? ` · ${t.parts.length} parts` : ""} · {relativeDay(t.createdAt)}
                {t.savedToAccount ? " · saved to account" : ""}
              </div>
            </button>
            {!combining && (
              <button
                onClick={() =>
                  confirm(
                    t.savedToAccount
                      ? `Delete “${t.title}” from this browser and from your account? This can't be undone.`
                      : `Delete “${t.title}” from this browser? This can't be undone.`,
                  ) && onDelete(t)
                }
                className="text-xs text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {combining && ordered.length >= 2 && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm font-medium">Combine {ordered.length} recordings, in this order</p>
          <p className="mt-0.5 text-xs text-muted">Ordered by the recording time in each file name. The originals stay as they are.</p>
          <ol className="mt-4 space-y-2">
            {ordered.map((t, i) => {
              const gap = i > 0 ? gapBetween(ordered[i - 1], t) : null;
              const warn = gap && (!gap.sameDay || gap.seconds < 0);
              return (
                <li key={t.id}>
                  {gap && (
                    <p className={`mb-2 ml-9 text-xs ${warn ? "font-medium text-warn" : "text-muted"}`}>
                      {warn ? "⚠ " : "↓ "}
                      {describeGap(gap)}
                      {warn ? " — are these really the same session?" : ""}
                    </p>
                  )}
                  <div className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2">
                    <span className="w-6 shrink-0 text-center font-mono text-xs text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-muted">
                        {clock(t.raw.durationSeconds)}
                        {t.raw.partial ? " · partial" : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${t.title} earlier`}
                      className="h-7 w-7 rounded-full border border-line text-xs hover:border-ink disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === ordered.length - 1}
                      aria-label={`Move ${t.title} later`}
                      className="h-7 w-7 rounded-full border border-line text-xs hover:border-ink disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <label className="mt-4 block text-xs text-muted">
            Name
            <input
              value={title ?? suggestTitle(ordered)}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-ink"
            />
          </label>
          <button
            onClick={() => {
              onCombine(combineTranscripts(ordered, (title ?? suggestTitle(ordered)).trim() || "Combined transcript"));
              reset();
            }}
            className="mt-4 h-10 w-full rounded-full bg-accent text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Create combined transcript
          </button>
        </div>
      )}
      {combining && ordered.length < 2 && <p className="mt-3 text-xs text-muted">Tick at least two recordings.</p>}
      {!combining && (
        <p className="mt-3 text-xs text-muted">
          History is kept in this browser. Open a transcript and turn on <b className="font-medium">Save to my account</b> to keep it
          if this browser is cleared, and to see it when you sign in elsewhere.
        </p>
      )}
    </section>
  );
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function AppHeader({ email }: { email: string | null }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-5">
      <Link href="/" className="text-[15px] font-semibold tracking-tight">
        Transcribio
      </Link>
      <div className="flex items-center gap-3">
        <Link href="/convert" className="text-sm text-muted hover:text-ink">
          PDF to Word
        </Link>
        <span className="hidden rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent sm:inline">Private · on-device</span>
        {email && <AccountMenu email={email} />}
      </div>
    </header>
  );
}
