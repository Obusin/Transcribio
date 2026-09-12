import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type AudioSample } from "mediabunny";
import { StreamingResampler, TARGET_RATE, downmix } from "./resample";

/**
 * Streams a local media file as 16 kHz mono PCM.
 *
 * Mediabunny demuxes by reading Blob slices on demand and decodes with
 * WebCodecs, so a multi-GB video is never loaded into memory (no
 * `file.arrayBuffer()`). The generator is pull-based: nothing is decoded
 * until the consumer asks for more, which gives natural backpressure while the
 * (slower) ASR runs.
 */

export interface MediaInfo {
  durationSeconds: number;
  hasVideo: boolean;
  audioCodec: string | null;
  sampleRate: number;
  channels: number;
  canDecode: boolean;
}

export class NoAudioTrackError extends Error {
  constructor() {
    super("This file has no audio track.");
    this.name = "NoAudioTrackError";
  }
}

export class UnsupportedCodecError extends Error {
  constructor(codec: string | null, cause?: unknown) {
    super(`This browser can't decode the audio in this file${codec ? ` (${codec})` : ""}.`, { cause });
    this.name = "UnsupportedCodecError";
  }
}

/**
 * Decoding broke partway through — typically a recording that was cut off
 * (copied while still recording, or the recorder crashed). Everything before
 * `atSeconds` was delivered and is worth transcribing.
 */
export class DecodeInterruptedError extends Error {
  constructor(
    readonly atSeconds: number,
    cause?: unknown,
  ) {
    super(`The audio could not be read past ${Math.floor(atSeconds)} s.`, { cause });
    this.name = "DecodeInterruptedError";
  }
}

function openInput(file: Blob): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

export async function probeMedia(file: Blob): Promise<MediaInfo> {
  const input = openInput(file);
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (!audio) throw new NoAudioTrackError();
    const video = await input.getPrimaryVideoTrack();
    return {
      durationSeconds: await input.computeDuration(),
      hasVideo: video !== null,
      audioCodec: audio.codec,
      sampleRate: audio.sampleRate,
      channels: audio.numberOfChannels,
      canDecode: await audio.canDecode(),
    };
  } finally {
    input.dispose();
  }
}

/** Longest stretch we will skip in one go when resyncing past damaged audio. */
const MAX_SKIP_SECONDS = 30;
/** Give up (keep what we have) after this many damaged spots in one file. */
const MAX_RESYNCS = 25;

function isConfigRefusal(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return e?.name === "NotSupportedError" || /configur|isConfigSupported|not supported/i.test(e?.message ?? "");
}

/**
 * Yields consecutive 16 kHz mono blocks covering the whole audio track.
 *
 * Damaged audio doesn't end the job: on a decode error we restart just past the
 * bad spot (skipping further on repeated failures), pad the hole with silence so
 * timestamps stay aligned, and report it via `onUnreadable`. Only a decoder that
 * refuses the configuration outright becomes UnsupportedCodecError (→ fallback).
 *
 * `startAt` (seconds) begins decoding mid-file — used to continue a partial
 * transcript. The first yielded sample then corresponds to `startAt`.
 */
export async function* decodeToPcm16k(
  file: Blob,
  signal?: AbortSignal,
  onUnreadable?: (startSeconds: number, endSeconds: number) => void,
  startAt = 0,
): AsyncGenerator<Float32Array> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new NoAudioTrackError();
    if (!(await track.canDecode())) throw new UnsupportedCodecError(track.codec);

    const firstTimestamp = await track.getFirstTimestamp();
    const duration = await track.computeDuration();
    const sink = new AudioSampleSink(track);
    let resampler: StreamingResampler | null = null;
    let sourceRate = 0;
    let expectedFrame = 0; // timeline position in source-rate frames
    let producedFrames = 0; // frames actually decoded in this call
    let resumeAt: number | null = startAt > 0 ? firstTimestamp + startAt : null; // media time to (re)start from
    let resyncs = 0;
    let skip = 1;

    const pushSilenceTo = function* (frame: number) {
      if (!resampler || frame <= expectedFrame) return;
      yield resampler.push(new Float32Array(frame - expectedFrame));
      expectedFrame = frame;
    };

    for (;;) {
      // `canDecode()` is only the browser's promise: some pass isConfigSupported()
      // and then reject configure() or fail on the first packet.
      const samples = sink.samples(resumeAt ?? undefined)[Symbol.asyncIterator]();
      const resumedFrom: number | null = resumeAt;
      let progressed = false;
      let failed: unknown = null;
      for (;;) {
        let step: IteratorResult<AudioSample, void>;
        try {
          step = await samples.next();
        } catch (err) {
          failed = err;
          break;
        }
        if (step.done) break;
        const sample = step.value;
        if (signal?.aborted) {
          sample.close();
          return;
        }
        try {
          const rate = sample.sampleRate;
          if (!resampler) {
            resampler = new StreamingResampler(rate);
            expectedFrame = Math.round(startAt * rate); // timeline begins at startAt
          }
          sourceRate = rate;
          const startFrame = Math.round((sample.timestamp - firstTimestamp) * rate);
          let skipFrames = 0;
          if (startFrame > expectedFrame + rate * 0.05) {
            // A hole: container gap, or the stretch we skipped while resyncing.
            if (resumedFrom !== null && !progressed) onUnreadable?.(expectedFrame / rate, startFrame / rate);
            yield* pushSilenceTo(startFrame);
          } else if (startFrame < expectedFrame) {
            // Restarting can begin slightly before the resume point; drop the overlap.
            skipFrames = expectedFrame - startFrame;
            if (skipFrames >= sample.numberOfFrames) continue;
          }
          const planes: Float32Array[] = [];
          for (let ch = 0; ch < sample.numberOfChannels; ch++) {
            const plane = new Float32Array(sample.numberOfFrames);
            sample.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
            planes.push(skipFrames ? plane.subarray(skipFrames) : plane);
          }
          expectedFrame += sample.numberOfFrames - skipFrames;
          producedFrames += sample.numberOfFrames - skipFrames;
          progressed = true;
          skip = 1;
          const out = resampler.push(downmix(planes));
          if (out.length) yield out;
        } finally {
          sample.close();
        }
      }
      if (!failed) break; // clean end of stream

      const decodedSeconds = sourceRate ? expectedFrame / sourceRate : startAt;
      const producedSeconds = sourceRate ? producedFrames / sourceRate : 0;
      // The decoder refused the format itself — no amount of skipping helps.
      if (isConfigRefusal(failed) && producedSeconds < 1) throw new UnsupportedCodecError(track.codec, failed);
      if (++resyncs > MAX_RESYNCS) {
        if (producedSeconds < 1) throw new UnsupportedCodecError(track.codec, failed);
        if (resampler) {
          const tail = resampler.flush();
          if (tail.length) yield tail;
        }
        throw new DecodeInterruptedError(decodedSeconds, failed);
      }
      // Skip further each time we fail without getting any audio out.
      if (!progressed && resumedFrom !== null) skip = Math.min(MAX_SKIP_SECONDS, skip * 2);
      const here = firstTimestamp + decodedSeconds;
      resumeAt = Math.max(here, resumedFrom ?? here) + skip;
      if (resumeAt >= firstTimestamp + duration) {
        // Damage runs to the end (e.g. a recording that was cut off).
        onUnreadable?.(decodedSeconds, duration);
        break;
      }
    }
    if (resampler) {
      const tail = resampler.flush();
      if (tail.length) yield tail;
    }
  } finally {
    input.dispose();
  }
}

/**
 * Fallback for codecs WebCodecs can't handle (runs on the main thread, where
 * AudioContext exists). Loads the whole file, so it's only used below a size cap.
 */
export async function decodeWithAudioContext(file: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const planes = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return downmix(planes);
}

export const AUDIO_CONTEXT_FALLBACK_MAX_BYTES = 512 * 1024 * 1024;
