// Diagnose where the ASR worker's memory goes after the model loads:
// JS heap vs ArrayBuffer backing stores vs everything else (WASM heap, GPU staging).
//
//   node bench/diag_memory.mjs --url http://localhost:3002 --file bench/data/longform/taglish-interview.mp4 --profile light

import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const here = dirname(fileURLToPath(import.meta.url));
const profileDir = join(here, "data", ".chromium-profile");
const PORT = 9333;

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--ignore-gpu-blocklist", "--use-angle=metal", `--remote-debugging-port=${PORT}`],
});
const page = await context.newPage();

function rendererRssMB() {
  const rows = execSync("ps -Ao pid=,ppid=,rss=,command=", { encoding: "utf8", maxBuffer: 1 << 24 }).trim().split("\n");
  return Math.round(
    rows
      .filter((l) => l.includes("--type=renderer") && l.includes("chromium_headless_shell"))
      .reduce((a, l) => a + Number(l.trim().split(/\s+/)[2]), 0) / 1024,
  );
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result ?? m.error);
      pending.delete(m.id);
    }
  };
  return {
    send: (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params })))),
    close: () => ws.close(),
  };
}

await page.goto(`${args.url}/transcribe`);
await page.getByText(/for local transcription/).waitFor({ timeout: 60_000 });
await page.locator('input[type="file"]').first().setInputFiles(resolve(args.file));
await page.getByText("Ready to transcribe").waitFor();
if (args.profile) await page.getByRole("radio", { name: { light: "Light", balanced: "Balanced", max: "Maximum" }[args.profile], exact: true }).click();
console.log(`renderer before start: ${rendererRssMB()} MB`);
await page.getByRole("button", { name: "Start transcription" }).click();
await page.getByText("Transcribing…").waitFor({ timeout: 300_000 });
await page.waitForTimeout(8000);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const worker = targets.find((t) => t.type === "worker");
const pageT = targets.find((t) => t.type === "page" && t.url.includes("/transcribe"));
console.log(`targets: ${targets.map((t) => t.type).join(", ")}`);

for (const [name, t] of [["worker", worker], ["page", pageT]]) {
  if (!t) {
    console.log(`${name}: not found`);
    continue;
  }
  const s = await cdp(t.webSocketDebuggerUrl);
  const before = await s.send("Runtime.getHeapUsage");
  const hasApi = await s.send("Runtime.evaluate", {
    expression: "typeof performance.measureUserAgentSpecificMemory",
    returnByValue: true,
  });
  const rss0 = rendererRssMB();
  await s.send("HeapProfiler.enable");
  await s.send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 3000));
  const after = await s.send("Runtime.getHeapUsage");
  const mb = (x) => Math.round((x ?? 0) / 2 ** 20);
  console.log(
    `${name}: measureUserAgentSpecificMemory=${hasApi?.result?.value} | JS heap used ${mb(before.usedSize)}→${mb(after.usedSize)} MB, ` +
      `ArrayBuffer backing stores ${mb(before.backingStorageSize)}→${mb(after.backingStorageSize)} MB, ` +
      `embedder ${mb(before.embedderHeapUsedSize)}→${mb(after.embedderHeapUsedSize)} MB | renderer RSS ${rss0}→${rendererRssMB()} MB after forced GC`,
  );
  s.close();
}
// Which memory regions hold the renderer's resident memory (macOS vmmap)?
const rows = execSync("ps -Ao pid=,rss=,command=", { encoding: "utf8", maxBuffer: 1 << 24 }).trim().split("\n");
const renderer = rows
  .filter((l) => l.includes("--type=renderer") && l.includes("chromium_headless_shell"))
  .map((l) => l.trim().split(/\s+/))
  .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
try {
  const summary = execSync(`vmmap --summary ${renderer[0]} 2>/dev/null`, { encoding: "utf8", maxBuffer: 1 << 26 });
  const table = summary.split("\n").filter((l) => /^\S.*\s\d+(\.\d+)?[KMG]\s/.test(l) && !/^TOTAL/.test(l));
  const toMB = (v) => (v.endsWith("G") ? parseFloat(v) * 1024 : v.endsWith("M") ? parseFloat(v) : parseFloat(v) / 1024);
  const parsed = table.map((l) => {
    const cols = l.trim().split(/\s{2,}/);
    return { region: cols[0], resident: toMB(cols[2] ?? "0K") };
  });
  console.log("renderer resident memory by region (top):");
  for (const r of parsed.sort((a, b) => b.resident - a.resident).slice(0, 8)) console.log(`   ${r.region.padEnd(34)} ${Math.round(r.resident)} MB`);
} catch (e) {
  console.log(`vmmap failed: ${e.message.split("\n")[0]}`);
}
await page.getByRole("button", { name: "Cancel" }).click().catch(() => {});
await context.close();
