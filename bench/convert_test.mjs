// PDF → Word conversion through the real /convert page.
//
//   node bench/convert_test.mjs --url http://localhost:3000

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "tb-convert-e2e-"));
const context = await chromium.launchPersistentContext(join(here, "data", ".chromium-profile"), { headless: true, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

/** A PDF shaped like a real handout: a heading, wrapped paragraphs, two pages. */
async function handout() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Employee Screening Handout");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p1 = pdf.addPage([595.28, 841.89]);
  p1.drawText("Employee Screening", { x: 60, y: 760, size: 20, font: bold });
  p1.drawText("Employee screening is the process of reviewing informa-", { x: 60, y: 728, size: 11, font });
  p1.drawText("tion about applicants used to select workers.", { x: 60, y: 713, size: 11, font });
  p1.drawText("A resume is targeted for a specific job and should be one", { x: 60, y: 672, size: 11, font });
  p1.drawText("to two pages long.", { x: 60, y: 657, size: 11, font });
  const p2 = pdf.addPage([595.28, 841.89]);
  p2.drawText("Selection", { x: 60, y: 760, size: 20, font: bold });
  p2.drawText("After screening, applicants are placed in specific roles.", { x: 60, y: 728, size: 11, font });
  const file = join(dir, "handout.pdf");
  writeFileSync(file, Buffer.from(await pdf.save()));
  return file;
}

/** A PDF that is only pictures of pages — nothing to extract. */
async function scanned() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  const file = join(dir, "scan.pdf");
  writeFileSync(file, Buffer.from(await pdf.save()));
  return file;
}

await page.goto(`${args.url}/convert`);
await page.getByText("Drop your PDF here").waitFor({ timeout: 30_000 });

// 1. A text PDF converts.
await page.locator('input[type="file"]').setInputFiles(await handout());
await page.getByText("Ready to save").waitFor({ timeout: 60_000 });
const pages = await page.locator("dd").first().textContent();
const words = await page.locator("dd").nth(1).textContent();
check("1. the PDF is read on the device", pages.trim() === "2" && Number(words.replace(/\D/g, "")) > 20, `${pages.trim()} pages, ${words.trim()} words`);

// 2. Structure survived: heading kept, hyphenated word rejoined, paragraphs merged.
const previewText = await page.locator(".max-h-64").innerText();
check(
  "2. headings and paragraphs are rebuilt from the page layout",
  previewText.includes("Employee Screening") && previewText.includes("information about applicants"),
  previewText.split("\n").slice(0, 2).join(" / ").slice(0, 110),
);

// 3. The Word document downloads and opens.
const [dl] = await Promise.all([
  page.waitForEvent("download", { timeout: 30_000 }),
  page.getByRole("button", { name: "Download Word document" }).click(),
]);
const docx = join(dir, dl.suggestedFilename());
await dl.saveAs(docx);
const text = execFileSync("textutil", ["-convert", "txt", "-stdout", "-format", "docx", docx], { encoding: "utf8" });
check(
  "3. Word document downloads with the text intact",
  dl.suggestedFilename().endsWith(".docx") && text.includes("Employee Screening") && text.includes("information about applicants used to select workers.") && text.includes("Selection"),
  dl.suggestedFilename(),
);

// 4. A scanned PDF is refused with an explanation rather than an empty file.
await page.getByRole("button", { name: "Convert another" }).click();
await page.getByText("Drop your PDF here").waitFor();
await page.locator('input[type="file"]').setInputFiles(await scanned());
await page.getByText("Couldn't convert this PDF").waitFor({ timeout: 30_000 });
const why = await page.locator("p.text-danger").textContent();
check("4. a scanned PDF is refused with a reason", /no text|OCR/i.test(why), why.slice(0, 90));

check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await context.close();
process.exit(results.every(Boolean) ? 0 : 1);
