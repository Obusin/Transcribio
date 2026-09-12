// "Transcribe more" flows: stop & keep → edit → continue → full transcript; transcribe again; new file.
//
//   node bench/continue_test.mjs --url http://localhost:3000 --file bench/data/longform/taglish-interview.mp4

const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDb, signIn } from "./signin.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const engine = args.browser ?? "chromium";
const context = await pw[engine].launchPersistentContext(resolve(args["profile-dir"] ?? join(here, "data", ".chromium-profile")), {
  headless: true,
  viewport: { width: 1280, height: 860 },
  ...(engine === "chromium" ? { args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--ignore-gpu-blocklist", "--use-angle=metal"] } : {}),
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const file = resolve(args.file);
const percent = async () => parseInt((await page.locator("section span.text-4xl").innerText().catch(() => "0")) || "0");
const readRecord = () =>
  page.evaluate(
    (dbName) =>
      new Promise((res) => {
        const r = indexedDB.open(dbName, 1);
        r.onsuccess = () => {
          const q = r.result.transaction("transcripts").objectStore("transcripts").getAll();
          q.onsuccess = () => res(q.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]);
        };
      }),
    cacheDb(user),
  );

const user = await signIn(page, args.url);
await page.goto(`${args.url}/transcribe`);
await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });
await page.locator('input[type="file"]').first().setInputFiles(file);
await page.getByText("Ready to transcribe").waitFor();
await page.getByRole("radio", { name: args.profile ?? "Balanced", exact: true }).click();
await page.getByRole("button", { name: "Start transcription" }).click();
await page.getByText("Transcribing…").waitFor({ timeout: 600_000 });
while ((await percent()) < 25) await page.waitForTimeout(500);
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByRole("button", { name: /Keep what's done/ }).click();
await page.getByText(/Partial transcript — stopped at/).waitFor({ timeout: 60_000 });
const partial = await readRecord();
check("1. stop & keep", !!partial.raw.partial, `partial at ${Math.round(partial.raw.partial.stoppedAtSeconds)} s, ${partial.raw.segments.length} lines`);

// Edit the first line, then continue.
const firstLine = page.locator("[contenteditable]").first();
await firstLine.click();
await page.keyboard.press("End");
await page.keyboard.type(" [EDITED]");
await page.locator("input[placeholder='Search transcript']").click(); // blur → save
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Continue from/ }).click();
await page.getByText("Transcribing…").waitFor({ timeout: 120_000 });
const startPct = await percent();
check("2. continue starts where it stopped", startPct >= 20, `progress starts at ${startPct}%`);
await page.getByText("← All transcripts").waitFor({ timeout: 900_000 });
const full = await readRecord();
const segs = full.raw.segments;
const ids = new Set(segs.map((s) => s.id));
const seam = partial.raw.partial.stoppedAtSeconds;
const nearSeam = segs.filter((s) => Math.abs(s.start - seam) < 3).map((s) => `${s.start.toFixed(1)} ${s.text}`);
check("3. continuation completes the transcript", !full.raw.partial && segs.at(-1).end > 590, `${segs.length} lines to ${Math.round(segs.at(-1).end)} s, partial=${!!full.raw.partial}`);
check("4. edit kept, ids unique", Object.values(full.edits).some((t) => t.includes("[EDITED]")) && ids.size === segs.length, `edits=${JSON.stringify(full.edits).slice(0, 80)}`);
check("5. same record (no duplicate transcript)", full.id === partial.id, `id ${full.id.slice(0, 8)}`);
console.log(`      lines within 3 s of the seam (${seam.toFixed(1)} s):\n        ${nearSeam.join("\n        ")}`);

// Transcribe again → setup screen for the same file.
await page.getByRole("button", { name: "Transcribe again" }).click();
const again = await page.getByText("Ready to transcribe").waitFor({ timeout: 10_000 }).then(() => true, () => false);
const againName = await page.locator("section p").first().innerText().catch(() => "");
check("6. transcribe again → setup", again && againName.includes("taglish-interview"), `setup for "${againName}"`);

// New transcription from the editor: go back to the transcript, pick a different file.
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByText(/Recent transcripts/).waitFor();
await page.getByText(/taglish-interview/).first().click();
await page.getByText("← All transcripts").waitFor();
const chooser = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "+ New transcription" }).click();
await (await chooser).setFiles(resolve(here, "data", "longform", "corrupt-middle.m4a"));
const newOk = await page.getByText("Ready to transcribe").waitFor({ timeout: 10_000 }).then(() => true, () => false);
check("7. + New transcription → setup for the new file", newOk && (await page.locator("section p").first().innerText()).includes("corrupt-middle"), "file chooser → setup");

check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await context.close();
process.exit(results.every(Boolean) ? 0 : 1);
