import { localDeviceId } from "./deployment";

/**
 * Pilot telemetry.
 *
 * What this sends: how the app performed and what the user did with it.
 * What it never sends: audio, video, transcript text, reviewer output, file
 * names, or anything typed into a transcript. Those stay on the device, which
 * is the whole point of the product.
 *
 * The purpose is narrow — Mark is handing this to a chosen group and needs to
 * see where it breaks and where people stop. Everything here is about the run,
 * not the content.
 */

export type EventName =
  | "app_opened"
  | "file_selected"
  | "transcribe_started"
  | "transcribe_finished"
  | "transcribe_failed"
  | "transcribe_cancelled"
  | "transcribe_crashed"
  | "reviewer_opened"
  | "ai_reviewer_used"
  | "exported"
  | "link_imported"
  | "transcript_rated"
  | "model_loaded"
  | "model_load_failed"
  | "feedback";

export interface EventProps {
  /** Device capability, so failures can be read against hardware. */
  webgpu?: boolean;
  deviceTier?: string;
  profile?: string;
  modelId?: string;
  /** Media length in seconds — a number, never the file itself. */
  durationSeconds?: number;
  /** How far a crashed run had saved, and how long it ran before dying. */
  processedSeconds?: number;
  minutesRunning?: number;
  /** Speed: seconds of audio per second of wall clock. */
  realtimeFactor?: number;
  language?: string;
  /** Export format chosen (pdf/docx/txt/srt/vtt). */
  format?: string;
  /** How a link import went: direct / relay / failed / platform-refused. Never the URL itself. */
  source?: string;
  /** Error class, truncated — never transcript content. */
  error?: string;
  /** Comma-separated mistake kinds from the rating card (fixed ids, never free text). */
  errors?: string;
  /** Whether the user also shared this transcript. */
  shared?: boolean;
  /** Seconds to download/load the model. */
  loadSeconds?: number;
  /** Free-text feedback, only ever from the feedback form the user typed into. */
  message?: string;
  rating?: number;
  /** Where this browser first came from (facebook.com, utm_source, direct). */
  ref?: string;
  /** The code Mark hands a pilot user, so he can tell cohorts apart. */
  pilot?: string;
}

const PILOT_KEY = "transcribio.pilot";
const OPT_OUT_KEY = "transcribio.telemetry.off";

export function pilotCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PILOT_KEY);
  } catch {
    return null;
  }
}

export function setPilotCode(code: string): void {
  try {
    localStorage.setItem(PILOT_KEY, code.trim().slice(0, 40));
  } catch {
    /* storage blocked — the code just won't stick */
  }
}

export function telemetryOff(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTelemetryOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Vercel Blob's free plan allows about 2,000 writes a month and locks the store
 * for 30 days past that, so events are not written one by one. They queue in
 * memory and leave as one batch when the tab is hidden or closed. The things a
 * person deliberately sends — feedback and ratings — go immediately.
 */
type Queued = { name: EventName; props: EventProps; at: string };
const queue: Queued[] = [];
let listening = false;
const SEND_NOW: ReadonlySet<EventName> = new Set(["feedback", "transcript_rated"]);
const MAX_BATCH = 40;

function flush(): void {
  if (!queue.length) return;
  const events = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({
    device: localDeviceId(),
    ua: navigator.userAgent.slice(0, 200),
    events,
  });
  try {
    // keepalive lets a batch sent as the tab closes still leave.
    void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
      () => {},
    );
  } catch {
    /* never let telemetry surface an error */
  }
  if (queue.length) flush();
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

/** Fire-and-forget. Never throws — telemetry must not be able to break a transcription. */
export function track(name: EventName, props: EventProps = {}): void {
  if (typeof window === "undefined") return;
  // Feedback is something the user deliberately typed and pressed send on, so
  // it goes even if they turned the background stats off.
  if (telemetryOff() && name !== "feedback") return;

  listen();
  queue.push({
    name,
    props: {
      ...props,
      pilot: props.pilot ?? pilotCode() ?? undefined,
      ...(name === "app_opened" ? { ref: firstTouch() ?? undefined } : {}),
    },
    at: new Date().toISOString(),
  });
  if (SEND_NOW.has(name) || queue.length >= MAX_BATCH) flush();
}

const FIRST_TOUCH_KEY = "transcribio.firstTouch";

/**
 * Where this browser first came from — utm_source if the link had one, else the
 * referring site (facebook.com, google.com…), else "direct". Recorded once, on
 * the first page ever visited, so a later internal click doesn't overwrite it.
 * Only the source name is kept, never the full referring URL.
 */
export function recordFirstTouch(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(FIRST_TOUCH_KEY)) return;
    const utm = new URLSearchParams(location.search).get("utm_source");
    let ref = "direct";
    if (utm) ref = utm.toLowerCase().slice(0, 40);
    else if (document.referrer) {
      const host = new URL(document.referrer).hostname.replace(/^(www|m|l|lm)\./, "");
      if (host && host !== location.hostname) ref = host.slice(0, 60);
    }
    localStorage.setItem(FIRST_TOUCH_KEY, ref);
  } catch {
    /* storage blocked */
  }
}

function firstTouch(): string | null {
  try {
    return localStorage.getItem(FIRST_TOUCH_KEY);
  } catch {
    return null;
  }
}
