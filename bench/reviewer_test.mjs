// The reviewer view and its PDF/Word exports, through the real editor.
//
//   node bench/reviewer_test.mjs --url http://localhost:3000

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
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const TITLE = "Reviewer test — IO Psych lecture";
const user = await signIn(page, args.url);
await page.goto(`${args.url}/transcribe`);
await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });
await page.evaluate(
  async ([dbName, title]) => {
    // A lecture with the cues a reviewer feeds on: topic announcements,
    // spoken definitions, years and a law.
    const lines = [
      [0, "It's a company or it's an organization that produces or publishes psychological tests."],
      [20, "So in 1924, Harvard University and Western Electric Company conducted their research."],
      [60, "So this led them to pointing the term Hawthorne Effect."],
      [90, "So yung Hawthorne Effect is a phenomenon wherein after introducing a novel treatment doon sa isang tao, nagbabago yung kanyang productivity."],
      [130, "And it will go back to the earlier level of productivity."],
      [189, "So next we have Elton Mayo."],
      [215, "So he's an Australian psychologist and he's also a Harvard professor."],
      [250, "So he's known to be the founder of human relations movement in organizational theory."],
      [309, "So next, Walter Bingham ulit tayo."],
      [340, "And one way to organize such is to classify them according to their capabilities or their ability."],
      [386, "Now let's go to the specialization from 1946 to 1963."],
      [430, "In fact, it was integrated in the American Psychological Association in 1946 when they established the Division of Industrial Psych."],
      [664, "Okay, now let's go to the information age from 1994 to present."],
      [700, "So, ang internet ay naintroduce sa atin in the 1990s."],
      [900, "Now, let's go to human resources."],
      [950, "When we say human resources, this pertains to both people who work for the company and also the organization where they are working."],
      [1000, "So HR is the division of a business that is charged with finding, recruiting, screening, and training job applicants and employees."],
      [1200, "This is because of a law called the peso act, the Republic Act 8759."],
    ];
    const t = {
      id: "reviewer-test", title, fileName: "x.mp4", fileSize: 1, hasVideo: false,
      createdAt: "2026-09-12T03:00:00Z", updatedAt: "2026-09-12T03:00:00Z", edits: {},
      raw: {
        segments: lines.map(([start, text], id) => ({ id, start, end: start + 5, text, language: "tl" })),
        durationSeconds: 1400, modelId: "whisper-large-v3-turbo", engine: "browser-webgpu", language: "auto",
        detectedLanguages: ["tl"], createdAt: "2026-09-12T03:00:00Z", stats: { processingSeconds: 250, realtimeFactor: 5.6 },
      },
    };
    await new Promise((res) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("transcripts", { keyPath: "id" }).createIndex("createdAt", "createdAt");
      r.onsuccess = () => { const tx = r.result.transaction("transcripts", "readwrite"); tx.objectStore("transcripts").put(t); tx.oncomplete = res; };
    });
  },
  [cacheDb(user), TITLE],
);
await page.reload();
await page.getByText(TITLE).click();
await page.getByText("← All transcripts").waitFor();

// 1. The reviewer view opens and is organised from the lecture's own cues.
await page.getByRole("button", { name: "Reviewer", exact: true }).click();
await page.locator("h2:visible", { hasText: "Topics" }).first().waitFor({ timeout: 10_000 });
const headings = await page.locator("h3:visible").allTextContents();
const wanted = ["Elton Mayo", "Walter Bingham", "specialization", "information age", "human resources"];
const found = wanted.filter((w) => headings.some((h) => h.toLowerCase().includes(w.toLowerCase())));
check("1. topics come from what the lecturer announced", found.length === wanted.length, `${found.length}/${wanted.length}: ${headings.join(" | ")}`);

// 2. Terms, facts and questions.
// Scoped to the reviewer's own sections — the sidebar has a <dl> of its own.
const terms = await page.locator("section:visible dt").allTextContents();
check(
  "2. key terms are picked up, without the filler they were spoken with",
  terms.some((t) => t.toLowerCase().startsWith("hawthorne")),
  terms.join(" | ") || "none",
);
const questions = await page.locator("details:visible summary").allTextContents();
check("3. review questions are generated", questions.length >= 4 && questions.some((q) => q.includes("Republic Act 8759")), `${questions.length} questions`);

// 3. Nothing was invented: every reviewer line is text from the transcript.
const spoken = await page.evaluate(() =>
  [...document.querySelectorAll("[contenteditable]")].map((el) => el.textContent.trim()),
);
const bullets = await page.locator("section:visible li span:not(.text-muted)").allTextContents();
const quoted = bullets.map((b) => b.trim()).filter((b) => b.length > 40);
const invented = quoted.filter((b) => !spoken.some((s) => s.includes(b)));
check("4. every reviewer line is quoted from the transcript", invented.length === 0, invented.length ? invented[0].slice(0, 80) : `${quoted.length} lines all traced to the transcript`);

// 4. Exports follow the open view.
const grab = async (label) => {
  const t = Date.now();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByRole("button", { name: label, exact: true }).click()]);
  return { path: await dl.path(), name: dl.suggestedFilename(), ms: Date.now() - t };
};
const pdf = await grab("PDF");
const parsed = await PDFDocument.load(readFileSync(pdf.path));
check("5. PDF exports the reviewer, not the transcript", pdf.name.endsWith("Reviewer.pdf") && parsed.getTitle().endsWith("— Reviewer"), `${pdf.name}, ${parsed.getPageCount()} pages, ${pdf.ms} ms`);

const docx = await grab("Word");
const text = execFileSync("textutil", ["-convert", "txt", "-stdout", "-format", "docx", docx.path], { encoding: "utf8" });
check("6. Word exports the reviewer with its sections", docx.name.endsWith("Reviewer.docx") && text.includes("Key terms") && text.includes("Elton Mayo") && text.includes("Republic Act 8759"), `${docx.name}, ${docx.ms} ms`);

// 5. Switching back gives the editable transcript again.
await page.getByRole("button", { name: "Transcript", exact: true }).click();
await page.locator("[contenteditable]").first().waitFor({ state: "visible", timeout: 10_000 });
const topicsGone = await page.locator("h2:visible", { hasText: "Topics" }).count();
check("7. the transcript view comes back intact", topicsGone === 0 && spoken.length === 18, `${spoken.length} editable lines`);

// Clean up.
await page.evaluate(async (dbName) => {
  await new Promise((res) => {
    const r = indexedDB.open(dbName, 1);
    r.onsuccess = () => { const tx = r.result.transaction("transcripts", "readwrite"); tx.objectStore("transcripts").delete("reviewer-test"); tx.oncomplete = res; };
  });
}, cacheDb(user));
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await context.close();
process.exit(results.every(Boolean) ? 0 : 1);
