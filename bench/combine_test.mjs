// Combine two transcripts through the real UI.
//
//   node bench/combine_test.mjs --url http://localhost:3000

import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDb, signIn } from "./signin.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "data", "shots-combine");
mkdirSync(shots, { recursive: true });
const context = await chromium.launchPersistentContext(join(here, "data", ".chromium-profile"), {
  headless: true,
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const user = await signIn(page, args.url);
await page.goto(`${args.url}/transcribe`);
await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });

// Seed two lecture halves into this account's cache, transcribed in the "wrong" order (part 2 first).
await page.evaluate(async (dbName) => {
  const mk = (id, name, duration, lines, createdAt, edits = {}) => ({
    id, title: name, fileName: `${name}.mp4`, fileSize: 1000, hasVideo: true, createdAt, updatedAt: createdAt, edits,
    raw: {
      segments: lines.map(([start, text], i) => ({ id: i, start, end: start + 4, text, language: "tl" })),
      durationSeconds: duration, modelId: "whisper-large-v3-turbo", engine: "browser-webgpu", language: "auto",
      detectedLanguages: ["tl"], createdAt, stats: { processingSeconds: duration / 5, realtimeFactor: 5 },
    },
  });
  const a = mk("test-part-a", "2026-09-10 10-45-48", 5093, [[0, "It's a company or organization that publishes psychological tests."], [85, "So this led them to coining the term Hawthorne Effect."], [5033, "Headhunters, parang ano din sila."]], "2026-09-11T09:00:00Z", { 1: "So this led them to coining the term Hawthorne effect. [edited]" });
  const b = mk("test-part-b", "2026-09-10 12-11-38", 3030, [[0, "Iba-iba tayo types of interviews."], [626, "Primacy effect, o daing niya unstructured."], [2890, "KSAOs, knowledge, skills, abilities and other characteristics."]], "2026-09-11T08:00:00Z");
  await new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("transcripts", { keyPath: "id" }).createIndex("createdAt", "createdAt");
    r.onsuccess = () => {
      const tx = r.result.transaction("transcripts", "readwrite");
      tx.objectStore("transcripts").put(a);
      tx.objectStore("transcripts").put(b);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    };
  });
}, cacheDb(user));
await page.reload();
await page.getByText(/Recent transcripts/).waitFor();

await page.getByRole("button", { name: "Combine recordings…" }).click();
await page.getByLabel("Include 2026-09-10 12-11-38").check();
await page.getByLabel("Include 2026-09-10 10-45-48").check();
const panel = page.locator("text=Combine 2 recordings, in this order").locator("xpath=..");
await panel.waitFor();
const order = await panel.locator("ol .truncate").allInnerTexts();
check("1. ordered by recording time, not transcription time", order[0] === "2026-09-10 10-45-48" && order[1] === "2026-09-10 12-11-38", order.join(" → "));
const gapText = await panel.locator("ol li p").first().innerText();
check("2. gap between recordings explained", /1 min after the previous one ended/.test(gapText), gapText.trim());
const name = await panel.locator("input").inputValue();
check("3. suggested name", name === "2026-09-10 (combined)", name);
await page.screenshot({ path: join(shots, "combine-panel.png"), fullPage: false });

await page.getByRole("button", { name: "Create combined transcript" }).click();
await page.getByText("← All transcripts").waitFor();
const headings = await page.locator("[id^=part-] .text-base").allInnerTexts();
check("4. part headings in the editor", headings.join("|") === "2026-09-10 10-45-48|2026-09-10 12-11-38", headings.join(" | "));
const stamps = await page.locator("button.font-mono").allInnerTexts();
check("5. part-local timestamps", stamps.join(",") === "1 · 0:00,1 · 1:25,1 · 1:23:53,2 · 0:00,2 · 10:26,2 · 48:10", stamps.join(", "));
const edited = await page.getByText("[edited]").count();
check("6. edit from the original carried over", edited === 1, `${edited} edited line`);
await page.screenshot({ path: join(shots, "combined-editor.png") });

const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "txt" }).click()]);
const txt = readFileSync(await dl.path(), "utf8");
check("7. TXT export has parts", txt.includes("## Part 1 — 2026-09-10 10-45-48 (1:24:53 · recorded 2026-09-10 10:45:48)") && txt.includes("[10:26] Primacy effect"), txt.split("\n")[0]);

// Clean up the seeded and combined records so the test leaves no trace.
await page.evaluate(async (dbName) => {
  await new Promise((res) => {
    const r = indexedDB.open(dbName, 1);
    r.onsuccess = () => {
      const store = r.result.transaction("transcripts", "readwrite").objectStore("transcripts");
      const q = store.getAll();
      q.onsuccess = () => {
        for (const t of q.result) if (t.id.startsWith("test-part-") || (t.parts && t.parts.some((p) => p.sourceId.startsWith("test-part-")))) store.delete(t.id);
        res();
      };
    };
  });
}, cacheDb(user));
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await context.close();
process.exit(results.every(Boolean) ? 0 : 1);
