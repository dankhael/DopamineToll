// Render every store screenshot to a 1280x800 PNG, one file per language.
// Uses the system Chrome via puppeteer-core (no bundled Chromium download).
// Output: ../png/screenshot-0N-<lang>.png  (exactly 1280x800, the .board box).
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(HERE, "..");
const OUT_DIR = join(SHOTS_DIR, "png");

const LANGS = ["en", "de", "fr", "ja", "pt", "zh"]; // pt = pt_BR, zh = zh_CN
const SHOTS = [1, 2, 3, 4, 5, 6];
const BOARD = { width: 1280, height: 800 };

// Common Chrome/Edge install paths on Windows; override with CHROME_PATH.
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`No Chrome/Edge found. Set CHROME_PATH. Tried: ${candidates.join(", ")}`);
  return found;
}

// file:///…/screenshot-N.html?lang=xx  (English is the default, no query).
function pageUrl(shot, lang) {
  const file = join(SHOTS_DIR, `screenshot-${shot}.html`);
  const base = pathToFileURL(file).href;
  return lang === "en" ? base : `${base}?lang=${lang}`;
}

async function renderOne(page, shot, lang) {
  await page.goto(pageUrl(shot, lang), { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => document.fonts && document.fonts.ready); // fonts before capture
  const board = await page.$(".board");
  if (!board) throw new Error(`No .board element in screenshot-${shot}.html`);
  const out = join(OUT_DIR, `screenshot-0${shot}-${lang}.png`);
  await board.screenshot({ path: out });
  return out;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ ...BOARD, deviceScaleFactor: 1 }); // 1x -> exact 1280x800
  for (const shot of SHOTS) {
    for (const lang of LANGS) {
      const out = await renderOne(page, shot, lang);
      console.log("wrote", out);
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
