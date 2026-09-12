// Resident memory of each model build after loading + a few clips, via the dev-only /bench page.
//
//   node bench/variant_memory.mjs --url http://localhost:3001 --variants 0,1,2

import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));

function snapshot() {
  const rows = execSync("ps -Ao pid=,rss=,%cpu=,command=", { encoding: "utf8", maxBuffer: 1 << 24 }).trim().split("\n");
  const r = rows.filter((l) => l.includes("chromium_headless_shell")).map((l) => l.trim().split(/\s+/));
  const renderer = r.filter((x) => x.join(" ").includes("--type=renderer")).sort((a, b) => b[1] - a[1])[0];
  const gpu = r.find((x) => x.join(" ").includes("--type=gpu-process"));
  let wasm = null;
  try {
    const s = execSync(`vmmap --summary ${renderer[0]} 2>/dev/null`, { encoding: "utf8", maxBuffer: 1 << 26 });
    const line = s.split("\n").find((l) => l.startsWith("Memory Tag 255"));
    const v = line?.trim().split(/\s{2,}/)[2];
    wasm = v ? (v.endsWith("G") ? parseFloat(v) * 1024 : v.endsWith("M") ? parseFloat(v) : parseFloat(v) / 1024) : 0;
  } catch {}
  const gm = execSync("ioreg -r -d 1 -w 0 -c IOAccelerator", { encoding: "utf8" }).match(/"In use system memory"=(\d+)/);
  return {
    rendererMB: Math.round(renderer[1] / 1024),
    wasmTagMB: wasm && Math.round(wasm),
    gpuProcMB: Math.round((gpu?.[1] ?? 0) / 1024),
    gpuMemMB: gm ? Math.round(gm[1] / 2 ** 20) : null,
  };
}

for (const v of (args.variants ?? "0,1,2").split(",")) {
  const context = await chromium.launchPersistentContext(join(here, "data", ".chromium-profile"), {
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--ignore-gpu-blocklist", "--use-angle=metal"],
  });
  const page = await context.newPage();
  const idle = snapshot();
  await page.goto(`${args.url}/bench?model=whisper-large-v3-turbo&variant=${v}&language=tl&limit=6`);
  const t0 = Date.now();
  let peak = 0;
  for (;;) {
    const s = await page.evaluate(() => window.__bench ?? null);
    peak = Math.max(peak, snapshot().rendererMB);
    if (s?.status === "done" || s?.status === "error") {
      if (s.status === "error") console.log(s.error);
      break;
    }
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(5000);
  const after = snapshot();
  const out = await page.evaluate(() => window.__bench?.output);
  console.log(
    `variant ${v} (${out?.precision}): load ${out?.model_load_seconds}s, ${out?.realtime_factor}x | renderer peak ${peak} MB, ` +
      `steady ${after.rendererMB} MB (WASM/V8 region ${after.wasmTagMB} MB) | GPU mem ${idle.gpuMemMB}→${after.gpuMemMB} MB | ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  await context.close();
}
