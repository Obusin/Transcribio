/**
 * Streaming band-limited resampler (windowed-sinc) to 16 kHz mono.
 *
 * Push arbitrary-sized blocks at the source rate; get 16 kHz blocks back. State
 * is carried between pushes so block boundaries are seamless, which lets us
 * decode hour-long files without ever holding the whole signal in memory.
 */

export const TARGET_RATE = 16000;
const ZERO_CROSSINGS = 16; // filter half-width, in output-rate samples
const TABLE_RES = 512;

export class StreamingResampler {
  private readonly step: number; // input samples per output sample
  private readonly cutoff: number; // normalised to the input rate
  private readonly halfWidth: number; // in input samples
  private buf = new Float32Array(0);
  /** Absolute input index of buf[0]. */
  private bufStart = 0;
  /** Absolute (fractional) input position of the next output sample. */
  private pos = 0;

  /** Kernel sampled at TABLE_RES points per input sample over [0, halfWidth]. */
  private readonly table: Float32Array;

  constructor(private readonly inputRate: number) {
    this.step = inputRate / TARGET_RATE;
    this.cutoff = Math.min(1, TARGET_RATE / inputRate) * 0.95;
    this.halfWidth = Math.ceil(ZERO_CROSSINGS / this.cutoff);
    this.table = new Float32Array(this.halfWidth * TABLE_RES + 2);
    for (let i = 0; i < this.table.length; i++) {
      const x = i / TABLE_RES;
      this.table[i] = this.cutoff * sinc(this.cutoff * x) * hann(x / this.halfWidth);
    }
  }

  push(input: Float32Array): Float32Array {
    if (this.inputRate === TARGET_RATE) return input;
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;
    return this.drain(false);
  }

  /** Flush the tail once the stream has ended. */
  flush(): Float32Array {
    if (this.inputRate === TARGET_RATE) return new Float32Array(0);
    const pad = new Float32Array(this.buf.length + this.halfWidth);
    pad.set(this.buf);
    this.buf = pad;
    return this.drain(true);
  }

  private drain(final: boolean): Float32Array {
    const end = this.bufStart + this.buf.length;
    const limit = final ? end - this.halfWidth : end - this.halfWidth - 1;
    const count = Math.max(0, Math.floor((limit - this.pos) / this.step) + 1);
    const out = new Float32Array(count);
    const { halfWidth, table, buf } = this;
    for (let n = 0; n < count; n++) {
      const center = this.pos - this.bufStart;
      const c0 = Math.floor(center);
      const kLo = Math.max(0, c0 - halfWidth + 1);
      const kHi = Math.min(buf.length - 1, c0 + halfWidth);
      let acc = 0;
      let norm = 0;
      for (let k = kLo; k <= kHi; k++) {
        const t = Math.abs(k - center) * TABLE_RES;
        const i = t | 0;
        const h = table[i] + (table[i + 1] - table[i]) * (t - i);
        acc += buf[k] * h;
        norm += h;
      }
      out[n] = norm !== 0 ? acc / norm : 0;
      this.pos += this.step;
    }
    // Drop input we will never need again (keep one filter width of history).
    const keepFrom = Math.max(0, Math.floor(this.pos - this.bufStart) - halfWidth);
    if (keepFrom > 0) {
      this.buf = this.buf.slice(keepFrom);
      this.bufStart += keepFrom;
    }
    return out;
  }
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function hann(t: number): number {
  return Math.abs(t) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Average interleaved-or-planar channels into mono. */
export function downmix(planes: Float32Array[]): Float32Array {
  if (planes.length === 1) return planes[0];
  const n = planes[0].length;
  const out = new Float32Array(n);
  for (const p of planes) for (let i = 0; i < n; i++) out[i] += p[i];
  const inv = 1 / planes.length;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}
