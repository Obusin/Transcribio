import { describe, expect, test } from "bun:test";
import { chooseVariant, defaultProfile, restMs, wasmThreads } from "./resources";
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

describe("threads", () => {
  test("WebGPU needs a single WASM thread (VAD only)", () => {
    expect(wasmThreads("max", 16, "browser-webgpu")).toBe(1);
  });
  test("CPU engine leaves cores free and respects the profile cap", () => {
    expect(wasmThreads("light", 10, "browser-wasm")).toBe(2);
    expect(wasmThreads("balanced", 10, "browser-wasm")).toBe(4);
    expect(wasmThreads("balanced", 4, "browser-wasm")).toBe(2);
    expect(wasmThreads("max", 4, "browser-wasm")).toBe(3);
    expect(wasmThreads("light", 1, "browser-wasm")).toBe(1);
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
  test("low-memory devices get the compact build and default to Light", () => {
    const small = caps({ deviceMemoryGB: 4 });
    expect(chooseVariant(turbo, small, "balanced")?.footprint).toBe("compact");
    expect(defaultProfile(small)).toBe("light");
    expect(defaultProfile(caps())).toBe("balanced");
  });
  test("Intel integrated graphics count as constrained; Intel Arc does not", () => {
    expect(defaultProfile(caps({ gpuDescription: "intel gen-12lp" }))).toBe("light");
    expect(defaultProfile(caps({ gpuDescription: "intel xe-hpg Intel(R) Arc(TM) A770" }))).toBe("balanced");
    expect(defaultProfile(caps({ gpuDescription: "nvidia ampere" }))).toBe("balanced");
  });
  test("no WebGPU falls back to the CPU build", () => {
    expect(chooseVariant(turbo, caps({ webgpu: false }), "balanced")?.engine).toBe("browser-wasm");
  });
});
