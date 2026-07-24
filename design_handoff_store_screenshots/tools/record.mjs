// Record video/animation.html to an MP4 by deterministic frame capture.
// Drives window.seek(t) frame by frame (never the wall clock), screenshots the
// 1920x1080 .stage each frame, then muxes the PNGs with ffmpeg. Uses system
// Chrome via puppeteer-core — same approach as render.mjs, no bundled Chromium.
//
//   npm run record                 # english, 60fps, ../video/dopamine-toll.mp4
//   FPS=30 npm run record          # faster/smaller draft
//   node record.mjs --lang de      # a localized cut (needs the lang in strings.js)
//   node record.mjs --music bed.mp3
//   node record.mjs --keep         # keep the PNG frames after muxing
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = resolve(HERE, "..", "video");
const PAGE = join(VIDEO_DIR, "animation.html");
const STAGE = { width: 1920, height: 1080 };
const FPS = Number(process.env.FPS) || 60;

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LANG = arg("--lang", "en");
const MUSIC = arg("--music");
const KEEP = process.argv.includes("--keep");

const FRAMES_DIR = join(VIDEO_DIR, "frames");
const OUT_MP4 = join(VIDEO_DIR, LANG === "en" ? "dopamine-toll.mp4" : `dopamine-toll-${LANG}.mp4`);

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

function pageUrl() {
  const base = pathToFileURL(PAGE).href;
  return `${base}?capture=1${LANG === "en" ? "" : `&lang=${LANG}`}`;
}

// Capture one PNG per frame by seeking the timeline to an exact millisecond.
async function captureFrames(page) {
  const { durationMs } = await page.evaluate(() => window.VIDEO);
  const frameCount = Math.round((durationMs / 1000) * FPS);
  const stage = await page.$(".stage");
  if (!stage) throw new Error("No .stage element in animation.html");
  for (let i = 0; i < frameCount; i++) {
    const t = (i / FPS) * 1000;
    await page.evaluate((ms) => window.seek(ms), t);
    await stage.screenshot({ path: join(FRAMES_DIR, `f-${String(i).padStart(5, "0")}.png`) });
  }
  console.log(`captured ${frameCount} frames @ ${FPS}fps (${(durationMs / 1000).toFixed(1)}s)`);
  return frameCount;
}

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function mux() {
  const input = join(FRAMES_DIR, "f-%05d.png");
  const args = ["-y", "-framerate", String(FPS), "-i", input];
  if (MUSIC) args.push("-i", resolve(process.cwd(), MUSIC));
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart");
  if (MUSIC) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(OUT_MP4);
  const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  console.log("wrote", OUT_MP4);
}

async function main() {
  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: "new" });
  const page = await browser.newPage();
  await page.setViewport({ ...STAGE, deviceScaleFactor: Number(process.env.SCALE) || 1 });
  await page.goto(pageUrl(), { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await captureFrames(page);
  await browser.close();

  if (!hasFfmpeg()) {
    console.log(`\nffmpeg not found — frames are in ${FRAMES_DIR}. Then run:`);
    console.log(`  ffmpeg -y -framerate ${FPS} -i "${join(FRAMES_DIR, "f-%05d.png")}" -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart "${OUT_MP4}"`);
    return;
  }
  mux();
  if (!KEEP) rmSync(FRAMES_DIR, { recursive: true, force: true });
  else console.log(`kept ${readdirSync(FRAMES_DIR).length} frames in ${FRAMES_DIR}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
