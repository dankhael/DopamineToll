// Render video/thumbnail.html to video/thumbnail.png at exactly 1280x720
// (YouTube's thumbnail size). Same system Chrome + puppeteer-core as render.mjs.
//   npm run thumbnail            # -> ../video/thumbnail.png
//   SCALE=2 npm run thumbnail    # 2560x1440 master (downscale if >2MB)
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, "..", "video", "thumbnail.html");
const OUT = resolve(HERE, "..", "video", "thumbnail.png");
const SIZE = { width: 1280, height: 720 };

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

async function main() {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ ...SIZE, deviceScaleFactor: Number(process.env.SCALE) || 1 });
  await page.goto(pathToFileURL(PAGE).href, { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const board = await page.$(".thumb");
  if (!board) throw new Error("No .thumb element in thumbnail.html");
  await board.screenshot({ path: OUT });
  await browser.close();
  console.log("wrote", OUT);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
