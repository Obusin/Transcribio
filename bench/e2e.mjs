// End-to-end: drive the real /transcribe UI with a media file, save the
// resulting transcript + screenshots.
//
//   node bench/e2e.mjs --file bench/data/longform/taglish-interview.mp4 [--language auto] [--shots dir]

// PLAYWRIGHT_CORE lets a newer Playwright (e.g. one with a WebKit build for this macOS) drive the test.
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDb, signIn } from "./signin.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(args.file);
const base = args.url ?? "http://localhost:3001";
const shots = resolve(args.shots ?? join(here, "data", "shots"));
mkdirSync(shots, { recursive: true });
const label = { auto: "Auto-detect", tl: "Filipino / Taglish", en: "English only" }[args.language ?? "auto"];

// --executable runs another Chromium-based browser (e.g. Opera); --profile-dir keeps it isolated.
const profileDir = resolve(args["profile-dir"] ?? join(here, "data", ".chromium-profile"));
// --browser webkit|firefox|chromium (default chromium).
const engine = args.browser ?? "chromium";
const context = await pw[engine].launchPersistentContext(profileDir, {
  headless: !args.headed,
  viewport: { width: 1280, height: 860 },
  ...(args.executable ? { executablePath: args.executable } : {}),
  ...(engine === "chromium"
    ? {
        args: args.executable
          ? ["--no-first-run", "--no-default-browser-check"]
          : ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--ignore-gpu-blocklist", "--use-angle=metal"],
      }
    : {}),
});
if (args.executable) await new Promise((r) => setTimeout(r, 3000)); // let the browser's own start page settle
const page = await context.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => m.type() === "error" && console.log(`[console.error] ${m.text()}`));

const user = await signIn(page, base);
await page.goto(`${base}/transcribe`);
await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });
await page.screenshot({ path: join(shots, "1-home.png") });

await page.locator('input[type="file"]').first().setInputFiles(file);
await page.getByText("Ready to transcribe").waitFor();
await page.getByText(/^\d+:\d\d/).first().waitFor({ timeout: 30_000 }); // duration probed
await page.getByText(label, { exact: true }).click();
if (args.profile) {
  const name = { light: "Light", balanced: "Balanced", max: "Maximum" }[args.profile];
  await page.getByRole("radio", { name, exact: true }).click();
}
await page.screenshot({ path: join(shots, "2-setup.png") });

// ── Resource sampler: RSS + CPU of the whole browser process tree, and
// system-wide GPU memory (macOS IOAccelerator), every 3 s.
const samples = [];
function sampleResources() {
  const rows = execSync("ps -Ao pid=,ppid=,rss=,%cpu=,command=", { encoding: "utf8", maxBuffer: 1 << 24 })
    .trim()
    .split("\n")
    .map((l) => {
      const [pid, ppid, rss, cpu, ...cmd] = l.trim().split(/\s+/);
      return { pid: +pid, ppid: +ppid, rss: +rss, cpu: +cpu, cmd: cmd.join(" ") };
    });
  const root = rows.find((r) => r.cmd.includes(`--user-data-dir=${profileDir}`) && !r.cmd.includes("--type="));
  if (!root) return;
  const tree = new Set([root.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (!tree.has(r.pid) && tree.has(r.ppid)) {
        tree.add(r.pid);
        grew = true;
      }
    }
  }
  const procs = rows.filter((r) => tree.has(r.pid));
  const kind = (c) => (c.includes("--type=gpu-process") ? "gpu" : c.includes("--type=renderer") ? "renderer" : "other");
  const by = { gpu: 0, renderer: 0, other: 0 };
  for (const p of procs) by[kind(p.cmd)] += p.rss / 1024;
  let gpuMem = null;
  try {
    const m = execSync("ioreg -r -d 1 -w 0 -c IOAccelerator", { encoding: "utf8" }).match(/"In use system memory"=(\d+)/);
    if (m) gpuMem = +m[1] / 2 ** 20;
  } catch {}
  samples.push({
    t: (Date.now() - t0) / 1000,
    rssMB: Math.round(procs.reduce((a, p) => a + p.rss, 0) / 1024),
    rendererMB: Math.round(by.renderer),
    gpuProcMB: Math.round(by.gpu),
    cpuPct: Math.round(procs.reduce((a, p) => a + p.cpu, 0)),
    gpuMemMB: gpuMem && Math.round(gpuMem),
  });
}
const t0 = Date.now();
const sampler = args.monitor ? setInterval(sampleResources, 3000) : null;
await page.getByRole("button", { name: "Start transcription" }).click();
let shotMid = false;
for (;;) {
  if (await page.getByText("← All transcripts").isVisible().catch(() => false)) break;
  if (await page.getByText("Something went wrong").isVisible().catch(() => false)) {
    await page.screenshot({ path: join(shots, "error.png") });
    console.error(await page.locator("section").innerText());
    process.exit(1);
  }
  const pct = await page.locator("section span.text-4xl").innerText().catch(() => null);
  if (pct) process.stdout.write(`\r${pct}   `);
  if (!shotMid && pct && parseInt(pct) >= 30) {
    await page.screenshot({ path: join(shots, "3-progress.png") });
    shotMid = true;
  }
  await page.waitForTimeout(2000);
}
const wall = (Date.now() - t0) / 1000;
if (sampler) {
  clearInterval(sampler);
  const peak = (k) => Math.max(...samples.map((s) => s[k] ?? 0));
  const avg = (k) => Math.round(samples.reduce((a, s) => a + (s[k] ?? 0), 0) / samples.length);
  const third = Math.floor(samples.length / 3);
  const early = samples.slice(third, 2 * third).map((s) => s.rssMB);
  const late = samples.slice(2 * third).map((s) => s.rssMB);
  const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1));
  console.log(
    `\nresources: peak RSS ${peak("rssMB")} MB (renderer ${peak("rendererMB")}, gpu-proc ${peak("gpuProcMB")}), ` +
      `peak GPU mem ${peak("gpuMemMB")} MB, avg CPU ${avg("cpuPct")}%, ` +
      `RSS middle→last third ${mean(early)}→${mean(late)} MB`,
  );
  writeFileSync(join(shots, `resources-${basename(file)}.json`), JSON.stringify(samples));
}
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, "4-editor.png") });

// Click the 5th timestamp: media should seek there and the row should highlight.
const stamps = page.locator("button.font-mono");
const stamp = stamps.nth(Math.max(0, Math.min(4, (await stamps.count()) - 1)));
const stampText = await stamp.innerText();
await stamp.click();
await page.waitForTimeout(1500);
const current = await page.evaluate(() => document.querySelector("video, audio")?.currentTime ?? -1);
await page.screenshot({ path: join(shots, "5-seek.png") });

const record = await page.evaluate(
  (dbName) =>
    new Promise((res, rej) => {
      const r = indexedDB.open(dbName, 1);
      r.onsuccess = () => {
        const q = r.result.transaction("transcripts").objectStore("transcripts").getAll();
        q.onsuccess = () => res(q.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
        q.onerror = () => rej(q.error);
      };
    }),
  cacheDb(user),
);

// Export: the SRT download must be produced and non-empty.
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "srt" }).click()]);
const srtPath = join(shots, await download.suggestedFilename());
await download.saveAs(srtPath);

const out = join(here, "data", "longform", `${basename(file)}.${args.language ?? "auto"}.json`);
writeFileSync(out, JSON.stringify({ wallSeconds: wall, seekTo: stampText, mediaTimeAfterSeek: current, record }, null, 1));
console.log(`\ndone in ${wall.toFixed(0)}s; ${record.raw.segments.length} segments; rtf ${record.raw.stats.realtimeFactor.toFixed(2)}; languages ${record.raw.detectedLanguages}`);
console.log(`seek: clicked ${stampText}, media at ${current.toFixed(1)}s; srt saved to ${srtPath}`);

if (args["idle-check"]) {
  // The engine should release the model ~60 s after the job ends.
  const before = samples.length ? samples.at(-1) : null;
  sampleResources();
  const atEnd = samples.at(-1);
  await page.waitForTimeout(75_000);
  sampleResources();
  const after = samples.at(-1);
  console.log(
    `idle release: renderer ${atEnd.rendererMB}→${after.rendererMB} MB, GPU mem ${atEnd.gpuMemMB}→${after.gpuMemMB} MB` +
      (before ? ` (last busy sample GPU ${before.gpuMemMB} MB)` : ""),
  );
}

if (args["crash-check"]) {
  // Simulate a transcription that never finished (machine crashed), then reload.
  await page.evaluate(() => localStorage.setItem("transcribio.activeJob", JSON.stringify({ profile: "max", startedAt: 0 })));
  await page.goto(`${base}/transcribe`);
  const notice = await page.getByText(/last transcription stopped before it finished/).isVisible({ timeout: 10_000 }).catch(() => false);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.getByText("Ready to transcribe").waitFor();
  const light = await page.getByRole("radio", { name: "Light", exact: true }).getAttribute("aria-checked");
  await page.screenshot({ path: join(shots, "6-crash-recovery.png") });
  console.log(`crash recovery: notice shown ${notice}, Light selected ${light === "true"}`);
}
await context.close();
