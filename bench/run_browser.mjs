// Drive /bench in headless Chromium (WebGPU on) and save the run to bench/results/.
//
//   npm run dev   # in another terminal
//   node bench/run_browser.mjs --model whisper-large-v3-turbo --variant 0 --language auto
//
// Flags: --model, --variant (index into the model's variants), --language (auto|en|tl),
//        --limit N, --bucket english|taglish|filipino, --url http://localhost:3000, --headed

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const base = args.url ?? "http://localhost:3000";
const q = new URLSearchParams({
  model: args.model ?? "whisper-large-v3-turbo",
  variant: args.variant ?? "0",
  language: args.language ?? "auto",
  ...(args.limit ? { limit: args.limit } : {}),
  ...(args.bucket ? { bucket: args.bucket } : {}),
});

// Persistent profile so the model cache (Cache Storage) survives between runs.
const context = await chromium.launchPersistentContext(join(dirname(fileURLToPath(import.meta.url)), "data", ".chromium-profile"), {
  headless: !args.headed,
  args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--ignore-gpu-blocklist", "--use-angle=metal"],
});
const page = await context.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /done|loaded|device|ERROR|FATAL/.test(t)) console.log(`[page] ${t}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`${base}/bench?${q}`, { timeout: 120_000 });
let last = -1;
let lastLine = "";
for (;;) {
  const s = await page.evaluate(() => window.__bench ?? null);
  if (s?.status === "error") {
    console.error(s.error);
    process.exit(1);
  }
  if (s?.status === "done") {
    const out = s.output;
    const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${out.run}.json`), JSON.stringify(out, null, 1));
    console.log(`saved ${out.run}: ${out.audio_seconds}s audio, ${out.realtime_factor}x realtime, load ${out.model_load_seconds}s, errors ${out.errors.length}`);
    break;
  }
  if (s && s.done !== last && s.done % 25 === 0) {
    console.log(`progress ${s.done}/${s.total}`);
    last = s.done;
  }
  const line = (await page.locator("main div").allTextContents().catch(() => [])).at(-1) ?? "";
  if (line && line !== lastLine) {
    console.log(line.slice(0, 160));
    lastLine = line;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
await context.close();
