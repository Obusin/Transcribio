import { describe, expect, test } from "bun:test";
import { adaptiveDuty, chooseVariant, defaultProfile, MIN_DUTY, PROFILES, restMs, wasmThreads } from "./resources";
import type { Capabilities } from "./types";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  webgpu: true,
  gpuDescription: "test",
  shaderF16: true,
  maxBufferSizeMB: 4096,
  webcodecs: true,
  crossOriginIsolated: true,
  deviceMemoryGB: 8,
  hardwareConcurrency: 10,
  storageAvailableMB: 100_000,
  ...over,
});

describe("duty cycle", () => {
  test("rest time keeps the GPU busy at most the allowed share", () => {
    expect(restMs(1000, 1)).toBe(0);
    expect(restMs(1000, 0.5)).toBe(1000); // busy 1 s, rest 1 s → 50%
    expect(restMs(900, 0.75)).toBeCloseTo(300); // busy 0.9 s, rest 0.3 s → 75%
    expect(restMs(60_000, 0.5)).toBe(10_000); // rests are capped
  });
});

describe("headroom", () => {
  test("no profile ever lets the GPU run flat out", () => {
    for (const p of Object.values(PROFILES)) expect(p.gpuDuty).toBeLessThan(1);
    expect(PROFILES.light.gpuDuty).toBeLessThan(PROFILES.balanced.gpuDuty);
    expect(PROFILES.balanced.gpuDuty).toBeLessThan(PROFILES.max.gpuDuty);
  });
  test("even Maximum rests between chunks", () => {
    expect(restMs(1000, PROFILES.max.gpuDuty)).toBeGreaterThan(0);
  });
});

describe("threads", () => {
  test("WebGPU needs a single WASM thread (VAD only)", () => {
    expect(wasmThreads("max", 16, "browser-webgpu")).toBe(1);
  });
  test("thread counts scale with the machine", () => {
    expect(wasmThreads("light", 10, "browser-wasm")).toBe(2);
    expect(wasmThreads("balanced", 10, "browser-wasm")).toBe(5);
    expect(wasmThreads("max", 10, "browser-wasm")).toBe(7);
    expect(wasmThreads("balanced", 4, "browser-wasm")).toBe(2);
  });
  test("a quarter of the cores (at least one) is always left free", () => {
    for (const cores of [2, 3, 4, 6, 8, 10, 12, 16, 32]) {
      for (const p of ["light", "balanced", "max"] as const) {
        const reserve = Math.max(1, Math.ceil(cores * 0.25));
        expect(wasmThreads(p, cores, "browser-wasm")).toBeLessThanOrEqual(cores - reserve);
      }
    }
  });
  test("never below one thread, never above eight", () => {
    expect(wasmThreads("light", 1, "browser-wasm")).toBe(1);
    expect(wasmThreads("max", 2, "browser-wasm")).toBe(1);
    expect(wasmThreads("max", 64, "browser-wasm")).toBe(8);
  });
});

describe("adaptive duty", () => {
  const cap = PROFILES.max.gpuDuty;
  test("uses the profile's figure until it has enough chunks to judge", () => {
    expect(adaptiveDuty(cap, [])).toBe(cap);
    expect(adaptiveDuty(cap, [100, 300, 100])).toBe(cap);
  });
  test("ordinary variation in how much is said does not throttle", () => {
    // ±30% around 100 ms of work per audio second.
    const noisy = [100, 125, 80, 130, 95, 120, 75, 128, 110, 90, 125, 118];
    expect(adaptiveDuty(cap, noisy)).toBe(cap);
  });
  test("a sustained slowdown gives the machine more rest", () => {
    const throttling = [100, 105, 95, 100, 102, 98, 190, 205, 210];
    const d = adaptiveDuty(cap, throttling);
    expect(d).toBeLessThan(cap);
    expect(d).toBeCloseTo(cap / 2, 1);
  });
  test("one slow chunk is not a trend", () => {
    expect(adaptiveDuty(cap, [100, 102, 98, 101, 99, 100, 400])).toBe(cap);
  });
  test("recovers once the pace comes back", () => {
    expect(adaptiveDuty(cap, [100, 100, 100, 100, 200, 210, 205, 100, 98, 102])).toBe(cap);
  });
  test("never throttles below the floor, and never exceeds 95%", () => {
    expect(adaptiveDuty(cap, [100, 100, 100, 100, 100, 100, 900, 950, 1000])).toBe(MIN_DUTY);
    expect(adaptiveDuty(1, [])).toBe(0.95);
  });
});

describe("model build selection", () => {
  const turbo = "whisper-large-v3-turbo";
  test("balanced on a capable GPU gets the standard build", () => {
    expect(chooseVariant(turbo, caps(), "balanced")?.footprint).toBe("standard");
  });
  test("light always uses the compact build", () => {
    expect(chooseVariant(turbo, caps(), "light")?.downloadMB).toBe(564);
  });
  test("GPUs without fp16 get the compact q4 build, never a multi-GB fp32 one", () => {
    const v = chooseVariant(turbo, caps({ shaderF16: false }), "max");
    expect(v?.dtype.encoder_model).toBe("q4");
    expect(v!.downloadMB).toBeLessThan(1000);
  });
  test("low-memory devices get the compact build even on a higher profile", () => {
    expect(chooseVariant(turbo, caps({ deviceMemoryGB: 4 }), "balanced")?.footprint).toBe("compact");
  });
  test("everyone starts on Light, however strong the machine", () => {
    expect(defaultProfile(caps())).toBe("light");
    expect(defaultProfile(caps({ gpuDescription: "nvidia ampere", deviceMemoryGB: 8, hardwareConcurrency: 32 }))).toBe("light");
    expect(defaultProfile(null)).toBe("light");
  });
  test("Intel integrated graphics count as constrained (compact build); Intel Arc does not", () => {
    expect(chooseVariant(turbo, caps({ gpuDescription: "intel gen-12lp" }), "max")?.footprint).toBe("compact");
    expect(chooseVariant(turbo, caps({ gpuDescription: "intel xe-hpg Intel(R) Arc(TM) A770" }), "max")?.footprint).toBe("standard");
  });
  test("no WebGPU falls back to the CPU build", () => {
    expect(chooseVariant(turbo, caps({ webgpu: false }), "balanced")?.engine).toBe("browser-wasm");
  });
});
