import { TARGET_RATE } from "./resample";

/**
 * Turns a 16 kHz PCM stream into ASR-sized chunks cut at pauses.
 *
 * Whisper sees 30 s windows. Cutting blindly every 30 s splits words and
 * feeds it silence, which is where it hallucinates. Instead we run a VAD,
 * group active regions into chunks of at most `maxChunkSeconds`, and only cut
 * inside a region when it is longer than that — at the quietest frame we find.
 *
 * The VAD decides where to CUT, not what to SKIP: audio is only skipped when it
 * is both non-speech and quiet. Silero misses speech over background music
 * (measured on a vlog: p≈0.05 on clearly audible dialogue), so loud non-speech
 * is still transcribed and flagged via `speechRatio` for hallucination filtering.
 */

export const VAD_FRAME = 512; // Silero v5 frame at 16 kHz (32 ms)

export interface ChunkerOptions {
  threshold: number; // speech starts at p >= threshold
  negThreshold: number; // ...and ends after p < negThreshold for minSilence
  minSilenceSeconds: number;
  minSpeechSeconds: number;
  padSeconds: number;
  maxChunkSeconds: number;
  /** Gaps longer than this close the current chunk instead of being included. */
  maxGapSeconds: number;
  /** Non-speech within this many dB of the recording's speech level counts as active. */
  loudMarginDb: number;
  /** Loudness floor used before any confident speech has been heard. */
  initialLoudDbfs: number;
}

export const DEFAULT_CHUNKER: ChunkerOptions = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSilenceSeconds: 0.5,
  minSpeechSeconds: 0.25,
  padSeconds: 0.3,
  maxChunkSeconds: 28,
  maxGapSeconds: 4,
  loudMarginDb: 14,
  initialLoudDbfs: -28,
};

export interface AudioChunk {
  /** Absolute position in the media, seconds. */
  start: number;
  end: number;
  audio: Float32Array;
  /** Share of frames the VAD called speech. Low = music/noise; filter hallucinations. */
  speechRatio: number;
}

export type VadFn = (frame: Float32Array) => Promise<number>;

/** Append-at-end / drop-from-front PCM store addressed by absolute sample index. */
class PcmBuffer {
  private data = new Float32Array(16000 * 64);
  private head = 0; // index in `data` of absolute sample `start`
  length = 0;
  start = 0;

  append(block: Float32Array) {
    if (this.head + this.length + block.length > this.data.length) {
      const cap = Math.max(this.data.length, (this.length + block.length) * 2);
      // Reuse the array (compacting to the front) unless it is genuinely too small.
      const next = cap === this.data.length ? this.data : new Float32Array(cap);
      next.set(this.data.subarray(this.head, this.head + this.length), 0);
      this.data = next;
      this.head = 0;
    }
    this.data.set(block, this.head + this.length);
    this.length += block.length;
  }

  dropBefore(absSample: number) {
    const n = Math.min(this.length, absSample - this.start);
    if (n <= 0) return;
    this.head += n;
    this.length -= n;
    this.start += n;
  }

  /** Copy of absolute range [from, to). */
  slice(from: number, to: number): Float32Array {
    return this.data.slice(this.head + (from - this.start), this.head + (to - this.start));
  }
}

interface Region {
  start: number; // sample index
  end: number;
  /** Boundary was a forced mid-utterance cut, not a pause — don't pad across it. */
  cutStart?: boolean;
  cutEnd?: boolean;
}

export class SpeechChunker {
  private readonly o: ChunkerOptions;
  private readonly frameProbs: number[] = []; // one per VAD_FRAME, absolute index = i + probsOffset
  private readonly frameDb: number[] = []; // frame loudness, dBFS (same indexing)
  /** Running estimate of this recording's speech loudness. */
  private speechDb: number | null = null;
  private probsOffset = 0;
  private pending = new Float32Array(0); // PCM not yet framed
  private framed = 0; // samples consumed into frames (absolute)

  // Retained PCM: samples [pcmStart, pcmStart + pcm.length).
  private readonly pcm = new PcmBuffer();
  private get pcmStart() {
    return this.pcm.start;
  }

  // Region detection state.
  private inSpeech = false;
  private speechStart = 0;
  private speechStartIsCut = false;
  private silenceStart: number | null = null;
  private regions: Region[] = [];
  private emittedUntil = 0;

  constructor(
    private readonly vad: VadFn,
    opts: Partial<ChunkerOptions> = {},
  ) {
    this.o = { ...DEFAULT_CHUNKER, ...opts };
  }

  /** Total audio seen so far, seconds. */
  get seconds(): number {
    return (this.pcmStart + this.pcm.length) / TARGET_RATE;
  }

  async push(block: Float32Array): Promise<AudioChunk[]> {
    this.pcm.append(block);
    const merged = new Float32Array(this.pending.length + block.length);
    merged.set(this.pending);
    merged.set(block, this.pending.length);
    let off = 0;
    for (; off + VAD_FRAME <= merged.length; off += VAD_FRAME) {
      const frame = merged.subarray(off, off + VAD_FRAME);
      const p = await this.vad(frame);
      let e = 0;
      for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
      this.onFrame(p, 10 * Math.log10(e / frame.length + 1e-12));
    }
    this.pending = merged.slice(off);
    return this.collect(false);
  }

  async flush(): Promise<AudioChunk[]> {
    const total = this.pcmStart + this.pcm.length;
    if (this.inSpeech) this.closeRegion(total);
    return this.collect(true);
  }

  private onFrame(p: number, db: number) {
    const frameStart = this.framed;
    this.framed += VAD_FRAME;
    this.frameProbs.push(p);
    this.frameDb.push(db);
    const o = this.o;
    if (p >= 0.8) this.speechDb = this.speechDb == null ? db : this.speechDb * 0.99 + db * 0.01;
    const loudFloor = this.speechDb != null ? this.speechDb - o.loudMarginDb : o.initialLoudDbfs;
    const loud = db >= loudFloor;
    if (!this.inSpeech) {
      if (p >= o.threshold || loud) {
        this.inSpeech = true;
        this.speechStart = frameStart;
        this.speechStartIsCut = false;
        this.silenceStart = null;
      }
      return;
    }
    if (p < o.negThreshold && !loud) {
      this.silenceStart ??= frameStart;
      if (this.framed - this.silenceStart >= o.minSilenceSeconds * TARGET_RATE) {
        this.closeRegion(this.silenceStart);
      }
    } else {
      this.silenceStart = null;
    }
  }

  private closeRegion(end: number) {
    this.inSpeech = false;
    this.silenceStart = null;
    if (end - this.speechStart >= this.o.minSpeechSeconds * TARGET_RATE) {
      this.regions.push({ start: this.speechStart, end, cutStart: this.speechStartIsCut });
    }
  }

  /** Group finished regions into chunks; `final` also emits the trailing group. */
  private collect(final: boolean): AudioChunk[] {
    const o = this.o;
    const sr = TARGET_RATE;
    const maxLen = o.maxChunkSeconds * sr;
    const pad = Math.round(o.padSeconds * sr);
    const out: AudioChunk[] = [];

    // An utterance still in progress that already exceeds the max must be split now.
    if (this.inSpeech && this.framed - this.speechStart > maxLen) {
      const cut = this.quietestSample(this.speechStart + maxLen * 0.6, this.speechStart + maxLen);
      this.regions.push({ start: this.speechStart, end: cut, cutStart: this.speechStartIsCut, cutEnd: true });
      this.speechStart = cut;
      this.speechStartIsCut = true;
    }

    while (this.regions.length) {
      const first = this.regions[0];
      let last = 0;
      for (let i = 1; i < this.regions.length; i++) {
        const r = this.regions[i];
        const gap = r.start - this.regions[i - 1].end;
        if (r.end - first.start > maxLen || gap > o.maxGapSeconds * sr) break;
        last = i;
      }
      const group = this.regions.slice(0, last + 1);
      const groupEnd = group[group.length - 1].end;
      const closedByNext = last + 1 < this.regions.length;
      // Could a region that hasn't finished yet still join this group?
      const nextStart = this.inSpeech ? this.speechStart : this.framed;
      const canGrow =
        !closedByNext && !final &&
        nextStart - groupEnd <= o.maxGapSeconds * sr &&
        this.framed - first.start < maxLen;
      if (canGrow) break;

      this.regions.splice(0, last + 1);
      if (first.end - first.start > maxLen) {
        // Single long utterance: split at the quietest point.
        const cut = this.quietestSample(first.start + maxLen * 0.6, first.start + maxLen);
        this.regions.unshift({ start: cut, end: first.end, cutStart: true, cutEnd: first.cutEnd });
        out.push(this.makeChunk({ ...first, end: cut, cutEnd: true }, pad));
        continue;
      }
      out.push(this.makeChunk({ ...first, end: groupEnd, cutEnd: group[group.length - 1].cutEnd }, pad));
    }

    // Release PCM nobody can reference any more.
    const keepFrom = Math.min(
      this.regions[0]?.start ?? Infinity,
      this.inSpeech ? this.speechStart : this.framed,
    ) - pad;
    this.trim(Math.max(this.pcmStart, keepFrom));
    return out;
  }

  private makeChunk(r: Region, pad: number): AudioChunk {
    // Never re-send audio a previous chunk already covered: duplicated audio
    // becomes duplicated words at the seam.
    const s = Math.max(this.pcmStart, this.emittedUntil, r.cutStart ? r.start : r.start - pad);
    const e = Math.min(this.pcmStart + this.pcm.length, r.cutEnd ? r.end : r.end + pad);
    this.emittedUntil = e;
    const f0 = Math.max(0, Math.floor(s / VAD_FRAME) - this.probsOffset);
    const f1 = Math.min(this.frameProbs.length, Math.ceil(e / VAD_FRAME) - this.probsOffset);
    let speech = 0;
    for (let f = f0; f < f1; f++) if (this.frameProbs[f] >= this.o.threshold) speech++;
    return {
      start: s / TARGET_RATE,
      end: e / TARGET_RATE,
      audio: this.pcm.slice(s, e),
      speechRatio: f1 > f0 ? speech / (f1 - f0) : 0,
    };
  }

  private quietestSample(from: number, to: number): number {
    let best = Math.floor(to);
    let bestP = Infinity;
    const f0 = Math.max(0, Math.floor(from / VAD_FRAME) - this.probsOffset);
    const f1 = Math.min(this.frameProbs.length, Math.floor(to / VAD_FRAME) - this.probsOffset);
    // Prefer frames that are both unlikely speech and quiet relative to speech.
    const ref = this.speechDb ?? this.o.initialLoudDbfs;
    for (let f = f0; f < f1; f++) {
      const quiet = Math.min(1, Math.max(0, (this.frameDb[f] - (ref - 30)) / 30));
      const score = this.frameProbs[f] + quiet;
      if (score < bestP) {
        bestP = score;
        best = (f + this.probsOffset) * VAD_FRAME;
      }
    }
    return best;
  }

  private trim(absSample: number) {
    const drop = Math.floor(absSample - this.pcmStart);
    if (drop <= 0) return;
    this.pcm.dropBefore(this.pcmStart + drop);
    const dropFrames = Math.floor(this.pcmStart / VAD_FRAME) - this.probsOffset;
    if (dropFrames > 0) {
      this.frameProbs.splice(0, dropFrames);
      this.frameDb.splice(0, dropFrames);
      this.probsOffset += dropFrames;
    }
  }
}
