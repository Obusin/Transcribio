// Exercise every way of stopping a job through the real UI, and time how fast each responds.
//
//   node bench/cancel_test.mjs --url http://localhost:3000 --file bench/data/longform/taglish-interview.mp4

import { chromium } from "playwright-core";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signIn } from "./signin.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "data", "shots-cancel");
const context = await chromium.launchPersistentContext(join(here, "data", ".chromium-profile"), {
  headless: !args.headed,
  viewport: { width: 1280, height: 860 },
  args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--ignore-gpu-blocklist", "--use-angle=metal"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const percent = async () => parseInt((await page.locator("section span.text-4xl").innerText().catch(() => "0")) || "0");

async function openFile() {
  await signIn(page, args.url);
  await page.goto(`${args.url}/transcribe`);
  await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });
  await page.locator('input[type="file"]').first().setInputFiles(resolve(args.file));
  await page.getByText("Ready to transcribe").waitFor();
  await page.getByRole("radio", { name: "Balanced", exact: true }).click();
}

async function startAndReach(pct) {
  await page.getByRole("button", { name: "Start transcription" }).click();
  await page.getByText("Transcribing…").waitFor({ timeout: 300_000 });
  while ((await percent()) < pct) await page.waitForTimeout(500);
}

// A. Cancel while the model is loading, then make sure a fresh start still works.
await openFile();
await page.getByRole("button", { name: "Start transcription" }).click();
const loading = await page.getByText("Getting the model ready").waitFor({ timeout: 10_000 }).then(() => true, () => false);
if (loading) {
  const t = Date.now();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByText("Ready to transcribe").waitFor({ timeout: 10_000 });
  check("A. cancel during model load", true, `back to setup in ${Date.now() - t} ms`);
} else {
  check("A. cancel during model load", false, "loading screen never appeared (model already in memory?)");
}
await startAndReach(5);
check("A2. start again after cancelling a load", true, "transcription running on a fresh worker");

// B. Cancel → Discard mid-transcription.
while ((await percent()) < 15) await page.waitForTimeout(500);
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByText("Stop transcribing?").waitFor();
await page.screenshot({ path: join(shots, "b-confirm.png") });
let t = Date.now();
await page.getByRole("button", { name: "Discard" }).click();
await page.getByText("Ready to transcribe").waitFor({ timeout: 30_000 });
check("B. discard mid-transcription", true, `back to setup in ${Date.now() - t} ms`);

// C. Cancel → Keep what's done: editor opens with a partial transcript.
await startAndReach(20);
await page.getByRole("button", { name: "Cancel" }).click();
const keep = page.getByRole("button", { name: /Keep what's done/ });
const label = await keep.innerText();
t = Date.now();
await keep.click();
await page.getByText("← All transcripts").waitFor({ timeout: 30_000 });
const banner = await page.getByText(/Partial transcript — stopped at/).innerText().catch(() => null);
const lines = await page.locator("button.font-mono").count();
await page.screenshot({ path: join(shots, "c-partial-editor.png") });
check("C. keep what's done", !!banner && lines > 0, `${Date.now() - t} ms; "${label}" → ${lines} lines, banner: ${banner}`);

// D. Pause, then cancel while paused (must not hang).
await page.getByText("← All transcripts").click();
await page.locator('input[type="file"]').first().setInputFiles(resolve(args.file));
await page.getByText("Ready to transcribe").waitFor();
await startAndReach(8);
await page.getByRole("button", { name: "Pause" }).click();
await page.getByText("Paused").waitFor();
await page.waitForTimeout(3000);
const p1 = await percent();
await page.waitForTimeout(4000);
const p2 = await percent();
check("D1. pause actually pauses", p2 <= p1 + 1, `progress ${p1}% → ${p2}% over 4 s while paused`);
await page.getByRole("button", { name: "Cancel" }).click();
t = Date.now();
await page.getByRole("button", { name: "Discard" }).click();
await page.getByText("Ready to transcribe").waitFor({ timeout: 30_000 });
check("D2. cancel while paused", true, `back to setup in ${Date.now() - t} ms`);

check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await context.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
