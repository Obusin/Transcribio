// Accounts & history, end to end through the real UI, in a throwaway browser profile.
//
//   node bench/accounts_test.mjs --url http://localhost:3000

import { chromium } from "playwright-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const base = args.url;
const email = `history-${Date.now()}@transcribio.local`;
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function uiSignIn(page, address) {
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByText("Check your email").waitFor();
  await page.getByRole("button", { name: "Use this code" }).click();
  await page.waitForURL(`${base}/transcribe`);
  await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });
}
const savedOnServer = (page) => page.evaluate(async () => (await (await fetch("/api/saved")).json()).items ?? null);

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "tb-accounts-")), { headless: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1. Signed out → sign-in page.
await page.goto(`${base}/transcribe`);
await page.waitForURL(/\/sign-in\?next=%2Ftranscribe|\/sign-in\?next=\/transcribe/);
check("1. /transcribe requires an account", page.url().includes("/sign-in"), page.url().replace(base, ""));

// 2. History made before accounts existed (legacy browser cache).
await page.evaluate(async () => {
  const t = {
    id: "legacy-1", title: "Old lecture", fileName: "old.mp4", fileSize: 1, hasVideo: false,
    createdAt: "2026-09-10T02:00:00Z", updatedAt: "2026-09-10T02:00:00Z", edits: {},
    raw: { segments: [{ id: 0, start: 0, end: 3, text: "So basically yung problem natin…", language: "tl" }], durationSeconds: 60,
      modelId: "whisper-large-v3-turbo", engine: "browser-webgpu", language: "auto", detectedLanguages: ["tl"],
      createdAt: "2026-09-10T02:00:00Z", stats: { processingSeconds: 10, realtimeFactor: 6 } },
  };
  await new Promise((res) => {
    const r = indexedDB.open("transcribio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("transcripts", { keyPath: "id" }).createIndex("createdAt", "createdAt");
    r.onsuccess = () => { const tx = r.result.transaction("transcripts", "readwrite"); tx.objectStore("transcripts").put(t); tx.oncomplete = res; };
  });
});
await uiSignIn(page, email);
const t2 = Date.now();
const adoptedNotice = await page.getByText(/moved into your account's history/).waitFor({ timeout: 10_000 }).then(() => true, () => false);
const listed = await page.getByText("Old lecture").isVisible();
console.log(`      (history appeared ${Date.now() - t2} ms after the page loaded)`);
check("2. sign in with email code; old history adopted", adoptedNotice && listed, `notice ${adoptedNotice}, listed ${listed}`);

// 3. Not saved by default; nothing on the server.
check("3. transcripts stay in the browser by default", (await savedOnServer(page)).length === 0, "server has 0 saved");

// 4. Save to my account, then edit → the edit syncs.
await page.getByText("Old lecture").click();
await page.getByRole("switch", { name: "Save to my account" }).click();
await page.getByText("Saved to your account.").waitFor();
const line = page.locator("[contenteditable]").first();
await line.click();
await page.keyboard.press("End");
await page.keyboard.type(" (edited)");
await page.locator("input[placeholder='Search transcript']").click();
await page.getByText("Saved to your account.").waitFor();
const onServer = await page.evaluate(async () => (await (await fetch("/api/saved/legacy-1")).json()).record);
check("4. saved to account; edits sync", onServer?.edits?.[0]?.endsWith("(edited)") === true, JSON.stringify(onServer?.edits));

// 5. Sign out and clear this browser → history gone locally; sign back in → saved transcript comes back.
await page.getByText("← All transcripts").click();
await page.locator("summary", { hasText: email }).click();
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Sign out and remove history from this browser" }).click();
await page.waitForURL(`${base}/sign-in`);
const cleared = await page.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name?.startsWith("transcribio")).length);
check("5a. sign out + clear removes this browser's history", cleared === 0, `${cleared} history databases left`);
await page.waitForTimeout(31_000); // one code per 30 s per email
await uiSignIn(page, email);
const downloaded = await page.getByText(/downloaded from your account/).waitFor({ timeout: 10_000 }).then(() => true, () => false);
const back = await page.getByText("Old lecture").isVisible();
const badge = await page.getByText(/saved to account/).first().isVisible();
check("5b. signing back in restores saved transcripts", downloaded && back && badge, `notice ${downloaded}, listed ${back}, badge ${badge}`);

// 6. Another person on the same browser sees none of it.
await page.locator("summary", { hasText: email }).click();
await page.getByRole("button", { name: "Sign out", exact: true }).click();
await page.waitForURL(`${base}/sign-in`);
await uiSignIn(page, `other-${Date.now()}@transcribio.local`);
const leaked = await page.getByText("Old lecture").count();
check("6. a second account on the same browser sees no one else's history", leaked === 0 && (await savedOnServer(page)).length === 0, `${leaked} leaked items`);

// 7. Back as the first user: deleting a saved transcript removes it from the account too.
await page.locator("summary", { hasText: "other-" }).click();
await page.getByRole("button", { name: "Sign out", exact: true }).click();
await page.waitForURL(`${base}/sign-in`);
await page.waitForTimeout(31_000);
await uiSignIn(page, email);
await page.getByText("Old lecture").hover();
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Delete" }).first().click();
await page.waitForTimeout(800);
check("7. deleting a saved transcript removes it from the account", (await savedOnServer(page)).length === 0, "server has 0 saved");

check("no page errors", errors.length === 0, errors.join(" | ") || "none");
await ctx.close();
process.exit(results.every(Boolean) ? 0 : 1);
