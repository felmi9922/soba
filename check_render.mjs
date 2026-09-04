// docs/ をローカル配信し、headless Chromium で全タブ・主要モーダルを開いて JS エラーが出ないことを確認する。
// 使い方: node scripts/check_render.mjs   （要 playwright。CI では npx playwright で実行）
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DOCS = path.resolve("docs");
const srv = http.createServer(async (req, res) => {
  const p = path.join(DOCS, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  try { res.end(await readFile(p)); } catch { res.statusCode = 404; res.end("nf"); }
}).listen(0);
const port = srv.address().port;
const errors = [];
const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForSelector("text=OVERVIEW", { timeout: 15000 });

const tabs = ["OVERVIEW", "SIGNALS", "THEMES", "ROTATION", "OPTIONS", "PIPELINE", "WATCH"];
for (const t of tabs) {
  await page.click(`nav >> text=${t}`); await page.waitForTimeout(150);
  const txt = await page.locator("#root").innerText();
  if (txt.length < 200) errors.push(`${t}: ほぼ空`);
  console.log(`${t}: ${txt.length} chars`);
}
// モーダル: 指標 → テーマ → 候補 → SYNC
await page.click("nav >> text=SIGNALS");
await page.locator("tbody tr").first().click(); await page.waitForTimeout(150);
console.log("IDetail:", (await page.locator("h3").first().innerText()));
await page.keyboard.press("Escape");
await page.click("nav >> text=THEMES");
await page.locator("tbody tr").first().click(); await page.waitForTimeout(150);
console.log("TDetail:", (await page.locator("h3").first().innerText()));
await page.keyboard.press("Escape");
await page.click("nav >> text=ROTATION");
for (const s of ["LEADERS", "CUMULATIVE", "RANKING", "HEATMAP"]) { await page.click(`text=${s}`); await page.waitForTimeout(100); }
await page.click("nav >> text=PIPELINE");
await page.locator("#root span", { hasText: /^[0-9]{3}[0-9A-Z]$/ }).first().click(); await page.waitForTimeout(150);
console.log("CDetail:", (await page.locator("h3").first().innerText()));
// ステータス変更 → localStorage に保存されるか
await page.getByRole("button", { name: "精査中", exact: true }).last().click(); await page.waitForTimeout(300);
const saved = await page.evaluate(() => localStorage.getItem("soba_v2"));
console.log("localStorage:", saved ? saved.slice(0, 80) : "(none)");
if (!saved) errors.push("判断が localStorage に保存されていない");
await page.keyboard.press("Escape");
await page.click("text=SYNC"); await page.waitForTimeout(100); await page.keyboard.press("Escape");
await page.screenshot({ path: "docs/../scripts/overview.png", fullPage: false });
await browser.close(); srv.close();
if (errors.length) { console.error("NG\n" + errors.join("\n")); process.exit(1); }
console.log("OK: 全タブ・モーダルでエラーなし");
