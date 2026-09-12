import { describe, expect, test } from "bun:test";
import { SpeechChunker, type AudioChunk } from "./chunker";
import { StreamingResampler } from "./resample";

const SR = 16000;

function tone(rate: number, hz: number, seconds: number) {
  const x = new Float32Array(rate * seconds);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}

function rms(x: Float32Array, from = 2000, to = x.length - 2000) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

function resampleAll(rate: number, x: Float32Array, block = 1237) {
  const r = new StreamingResampler(rate);
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += block) parts.push(r.push(x.subarray(i, i + block)));
  parts.push(r.flush());
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("StreamingResampler", () => {
  for (const rate of [8000, 22050, 44100, 48000]) {
    test(`${rate} Hz → 16 kHz keeps length and passband`, () => {
      const y = resampleAll(rate, tone(rate, 1000, 3));
      expect(Math.abs(y.length - 3 * SR)).toBeLessThanOrEqual(1);
      expect(rms(y)).toBeCloseTo(Math.SQRT1_2, 2);
    });
  }

  test("rejects content above the new Nyquist instead of aliasing it", () => {
    expect(rms(resampleAll(48000, tone(48000, 12000, 3)))).toBeLessThan(0.01);
  });

  test("block size does not change the output", () => {
    const x = tone(44100, 440, 2);
    const a = resampleAll(44100, x, 100);
    const b = resampleAll(44100, x, 4096);
    expect(a.length).toBe(b.length);
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    expect(maxDiff).toBeLessThan(1e-5);
  });
});

/** Synthetic timeline: "speech" is an amplitude-modulated tone; the fake VAD is energy-based. */
function timeline(total: number, speech: [number, number][], opts: { dips?: [number, number, number] } = {}) {
  const x = new Float32Array(total * SR);
  for (const [a, b] of speech) for (let i = a * SR; i < b * SR; i++) x[i] = 0.5 * Math.sin(i * 0.3) * (1 + 0.3 * Math.sin(i / 4000));
  if (opts.dips) {
    const [from, to, every] = opts.dips;
    for (let t = from; t < to; t += every) for (let i = t * SR; i < (t + 0.2) * SR; i++) x[i] *= 0.02;
  }
  return x;
}

async function chunkAll(x: Float32Array, vad: (f: Float32Array) => Promise<number>) {
  const c = new SpeechChunker(vad);
  const chunks: AudioChunk[] = [];
  let maxRetained = 0;
  for (let i = 0; i < x.length; i += 341) {
    chunks.push(...(await c.push(x.subarray(i, i + 341))));
    maxRetained = Math.max(maxRetained, c.seconds - (c as unknown as { pcm: { start: number } }).pcm.start / SR);
  }
  chunks.push(...(await c.flush()));
  return { chunks, maxRetained };
}

const energyVad = async (f: Float32Array) => {
  let e = 0;
  for (const v of f) e += v * v;
  return Math.sqrt(e / f.length) > 0.05 ? 0.9 : 0.05;
};

function coverage(chunks: AudioChunk[], speech: [number, number][]) {
  let covered = 0;
  let total = 0;
  for (const [a, b] of speech)
    for (let t = a; t < b; t += 0.01) {
      total++;
      if (chunks.some((c) => t >= c.start && t < c.end)) covered++;
    }
  return covered / total;
}

describe("SpeechChunker", () => {
  const speech: [number, number][] = [[1, 4], [4.3, 9], [15, 18], [18.2, 40], [41, 111], [140, 141], [141.5, 150]];

  test("covers all speech, respects the max chunk length, bounds memory", async () => {
    const { chunks, maxRetained } = await chunkAll(timeline(160, speech, { dips: [48, 111, 7] }), energyVad);
    expect(coverage(chunks, speech)).toBe(1);
    expect(Math.max(...chunks.map((c) => c.end - c.start))).toBeLessThanOrEqual(28.7);
    expect(maxRetained).toBeLessThan(35);
    for (const c of chunks) expect(Math.abs(c.audio.length - (c.end - c.start) * SR)).toBeLessThan(2);
  });

  test("splits a 70 s monologue at breaths without duplicating audio at the seams", async () => {
    const { chunks } = await chunkAll(timeline(160, speech, { dips: [48, 111, 7] }), energyVad);
    const mono = chunks.filter((c) => c.start >= 40 && c.end <= 112);
    expect(mono.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < mono.length; i++) expect(mono[i].start).toBeGreaterThanOrEqual(mono[i - 1].end - 1e-9);
  });

  test("never skips loud audio the VAD calls non-speech (speech over music)", async () => {
    const x = timeline(40, [[2, 30]]);
    // VAD is confident about 2–10 s, then (wrongly) calls the loud 10–30 s non-speech.
    let frame = 0;
    const blindVad = async () => (frame++ * 512) / SR < 10 ? 0.95 : 0.05;
    const { chunks } = await chunkAll(x, blindVad);
    expect(coverage(chunks, [[2, 30]])).toBe(1);
    const late = chunks.filter((c) => c.start >= 9.5);
    expect(late.length).toBeGreaterThan(0);
    expect(Math.max(...late.map((c) => c.speechRatio))).toBeLessThan(0.3); // flagged for hallucination filtering
  });

  test("skips silence entirely", async () => {
    const { chunks } = await chunkAll(new Float32Array(30 * SR), energyVad);
    expect(chunks).toHaveLength(0);
  });
});
