// PDF and Word exports through the real editor.
//
//   node bench/export_test.mjs --url http://localhost:3000

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { cacheDb, signIn } from "./signin.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const context = await chromium.launchPersistentContext(join(here, "data", ".chromium-profile"), { headless: true, acceptDownloads: true });
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
await page.evaluate(async (dbName) => {
  const lines = [
    [0, "So basically yung problem natin is the customer can’t book kasi walang nagre-reply."],
    [65, "Niño said: “Mañana na lang” — okay lang ba?"],
    ...Array.from({ length: 80 }, (_, i) => [120 + i * 20, `Punto ${i + 1}: the Hawthorne effect ay pansamantalang pagtaas ng productivity.`]),
  ];
  const t = {
    id: "export-test", title: "Export test — Señora’s lecture", fileName: "x.mp4", fileSize: 1, hasVideo: false,
    createdAt: "2026-09-11T03:00:00Z", updatedAt: "2026-09-11T03:00:00Z", edits: { 0: "So basically, yung problem natin is the customer can’t book." },
    raw: { segments: lines.map(([start, text], id) => ({ id, start, end: start + 5, text, language: "tl" })), durationSeconds: 1800,
      modelId: "whisper-large-v3-turbo", engine: "browser-webgpu", language: "auto", detectedLanguages: ["tl"],
      createdAt: "2026-09-11T03:00:00Z", stats: { processingSeconds: 300, realtimeFactor: 6 } },
  };
  await new Promise((res) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("transcripts", { keyPath: "id" }).createIndex("createdAt", "createdAt");
    r.onsuccess = () => { const tx = r.result.transaction("transcripts", "readwrite"); tx.objectStore("transcripts").put(t); tx.oncomplete = res; };
  });
}, cacheDb(user));
await page.reload();
await page.getByText("Export test — Señora’s lecture").click();
await page.getByText("← All transcripts").waitFor();

const grab = async (label) => {
  const t = Date.now();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByRole("button", { name: label, exact: true }).click()]);
  return { path: await dl.path(), name: dl.suggestedFilename(), ms: Date.now() - t };
};

const pdf = await grab("PDF");
const parsed = await PDFDocument.load(readFileSync(pdf.path));
check("1. PDF downloads and opens", parsed.getPageCount() >= 2 && parsed.getTitle() === "Export test — Señora’s lecture", `${pdf.name}, ${parsed.getPageCount()} pages, ${Math.round(readFileSync(pdf.path).length / 1024)} KB, ${pdf.ms} ms`);

const docx = await grab("Word");
const text = execFileSync("textutil", ["-convert", "txt", "-stdout", "-format", "docx", docx.path], { encoding: "utf8" });
check("2. Word document downloads and opens", docx.name.endsWith(".docx") && text.includes("Niño said: “Mañana na lang” — okay lang ba?"), `${docx.name}, ${docx.ms} ms`);
check("3. edits are in the export, not the raw text", text.includes("So basically, yung problem natin is the customer can’t book.") && !text.includes("walang nagre-reply"), "edited line exported");

// Clean up.
await page.evaluate(async (dbName) => {
  await new Promise((res) => {
    const r = indexedDB.open(dbName, 1);
    r.onsuccess = () => { const tx = r.result.transaction("transcripts", "readwrite"); tx.objectStore("transcripts").delete("export-test"); tx.oncomplete = res; };
  });
}, cacheDb(user));
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await context.close();
process.exit(results.every(Boolean) ? 0 : 1);
