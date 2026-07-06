// Dopamine Toll settings page logic.

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 300 * 1024;
const MAX_DIM = 600;

// Stepper controls for "The toll". min/max preserve the original ranges.
const LOCK_STEP = { key: "lockDuration", valId: "lock-val", decId: "lock-dec", incId: "lock-inc", min: 10, max: 120, step: 5, def: 30 };
const UNLOCK_STEP = { key: "unlockDuration", valId: "unlock-val", decId: "unlock-dec", incId: "unlock-inc", min: 1, max: 30, step: 1, def: 10 };
const FRICTION_STEP = { key: "frictionMinutes", valId: "friction-val", decId: "friction-dec", incId: "friction-inc", min: 1, max: 60, step: 1, def: 5 };

const THEMES = ["amber", "indigo", "emerald", "rose"];
const THEME_ACCENT = {
  amber: "#e9a24c",
  indigo: "#8b9cff",
  emerald: "#34d399",
  rose: "#fb7185"
};

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
let toastTimer = null;

// Draw the countdown-gauge favicon in the theme's accent and apply it to the
// settings tab. Same geometry as the toolbar icon / logo (72px grid).
function setFavicon(name) {
  const link = $("favicon");
  if (!link) return;
  const accent = THEME_ACCENT[name] || THEME_ACCENT.amber;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const s = size / 72;

  ctx.fillStyle = "#0a0908";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 16 * s);
  ctx.fill();

  const cx = 36 * s;
  const cy = 36 * s;
  const r = 28 * s;
  ctx.lineWidth = 6 * s;
  ctx.lineCap = "round";

  ctx.strokeStyle = "#2a2419";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const start = -Math.PI / 2;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + (234 * Math.PI) / 180);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 7 * s, 0, Math.PI * 2);
  ctx.fill();

  link.href = c.toDataURL("image/png");
}

// Apply the saved theme as early as possible. The localStorage mirror is read
// synchronously to avoid a flash; chrome.storage.sync is the source of truth and
// reconciles it on load (renderTheme).
try {
  const t = localStorage.getItem("dt-theme");
  if (t) {
    document.documentElement.dataset.theme = t;
    setFavicon(t);
  }
} catch {}

function toast(msg = "Saved") {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1100);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Accepts "host" or "host/path" (and full URLs, which get split into the two).
// Returns the normalized entry — e.g. "youtube.com/shorts" — or false if the
// host part isn't a valid domain. A path narrows the toll to that section.
function normalizeBlockedEntry(input) {
  let host;
  let path = "";
  const s = input.trim();
  if (!s) return false;

  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      host = url.hostname;
      path = url.pathname;
    } catch {
      return false;
    }
  } else {
    const slash = s.indexOf("/");
    host = slash === -1 ? s : s.slice(0, slash);
    path = slash === -1 ? "" : s.slice(slash);
  }

  host = host.toLowerCase().replace(/^www\./, "");
  if (host.length > 253) return false;
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return false;

  // Drop query/hash, normalize a leading slash, and trim a trailing one.
  path = path.split(/[?#]/)[0];
  if (path && !path.startsWith("/")) path = "/" + path;
  if (path === "/") path = "";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  return host + path;
}

// ---------- Toll list (domains) ----------
async function renderDomains() {
  const { blockedDomains = [] } = await chrome.storage.sync.get("blockedDomains");
  const list = $("domain-list");
  list.innerHTML = "";
  if (blockedDomains.length === 0) {
    list.innerHTML = `<div class="empty">nothing on your toll list yet — add a site above</div>`;
    return;
  }
  for (const entry of blockedDomains) {
    const slash = entry.indexOf("/");
    const host = slash === -1 ? entry : entry.slice(0, slash);
    const path = slash === -1 ? "" : entry.slice(slash);
    const li = document.createElement("div");
    li.className = "item dom";
    li.innerHTML = `<span class="val"></span><button class="remove">remove</button>`;
    const val = li.querySelector(".val");
    val.textContent = host;
    if (path) {
      const pathEl = document.createElement("span");
      pathEl.className = "path";
      pathEl.textContent = path;
      val.appendChild(pathEl);
    }
    li.querySelector(".remove").addEventListener("click", async () => {
      const next = blockedDomains.filter((x) => x !== entry);
      await chrome.storage.sync.set({ blockedDomains: next });
      toast();
      renderDomains();
    });
    list.appendChild(li);
  }
}

async function addDomain() {
  const input = $("domain-input");
  const cleaned = normalizeBlockedEntry(input.value);
  if (!cleaned) {
    toast("invalid hostname");
    return;
  }
  const { blockedDomains = [] } = await chrome.storage.sync.get("blockedDomains");
  if (blockedDomains.includes(cleaned)) {
    toast("already on the list");
    input.value = "";
    return;
  }
  await chrome.storage.sync.set({ blockedDomains: [...blockedDomains, cleaned] });
  input.value = "";
  toast();
  renderDomains();
}

// ---------- Phrases ----------
async function renderPhrases() {
  const { phrases = [] } = await chrome.storage.sync.get("phrases");
  const list = $("phrase-list");
  list.innerHTML = "";
  if (phrases.length === 0) {
    list.innerHTML = `<div class="empty">no phrases yet — write something that hits</div>`;
    return;
  }
  phrases.forEach((p, i) => {
    const li = document.createElement("div");
    li.className = "item";
    li.innerHTML = `<span class="val"></span><button class="remove">remove</button>`;
    li.querySelector(".val").textContent = p;
    li.querySelector(".remove").addEventListener("click", async () => {
      const next = phrases.filter((_, j) => j !== i);
      await chrome.storage.sync.set({ phrases: next });
      toast();
      renderPhrases();
    });
    list.appendChild(li);
  });
}

async function addPhrase() {
  const input = $("phrase-input");
  const v = input.value.trim();
  if (!v) return;
  const { phrases = [] } = await chrome.storage.sync.get("phrases");
  await chrome.storage.sync.set({ phrases: [...phrases, v] });
  input.value = "";
  toast();
  renderPhrases();
}

// ---------- North star photos ----------
// Stored as {name, src}; legacy entries are bare base64 strings.
function normImage(entry, i) {
  if (typeof entry === "string") return { name: `photo ${i + 1}`, src: entry };
  return { name: entry.name || `photo ${i + 1}`, src: entry.src };
}

async function renderStars() {
  const { goalImages = [] } = await chrome.storage.local.get("goalImages");
  const grid = $("stars");
  grid.innerHTML = "";

  goalImages.forEach((entry, i) => {
    const { name, src } = normImage(entry, i);
    const star = document.createElement("div");
    star.className = "star filled";
    star.innerHTML = `<img alt=""><span class="lbl"></span><button class="del" title="remove">✕</button>`;
    star.querySelector("img").src = src;
    star.querySelector(".lbl").textContent = name;
    star.querySelector(".del").addEventListener("click", async () => {
      const next = goalImages.filter((_, j) => j !== i);
      await chrome.storage.local.set({ goalImages: next });
      toast();
      renderStars();
    });
    grid.appendChild(star);
  });

  if (goalImages.length < MAX_IMAGES) {
    const add = document.createElement("div");
    add.className = "star add";
    add.innerHTML = `<span class="plus">+</span><span class="lbl">add photo</span>`;
    add.addEventListener("click", () => $("file-input").click());
    grid.appendChild(add);
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = src;
  });
}

function resizeToBase64(img, maxDim) {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  return c.toDataURL("image/jpeg", 0.85);
}

async function handleUpload(file) {
  const warn = $("upload-warn");
  warn.style.display = "none";
  warn.textContent = "";

  const { goalImages = [] } = await chrome.storage.local.get("goalImages");
  if (goalImages.length >= MAX_IMAGES) {
    warn.style.display = "block";
    warn.textContent = `limit reached — max ${MAX_IMAGES} photos`;
    return;
  }

  try {
    const raw = await readFileAsDataURL(file);
    const img = await loadImageElement(raw);
    const compressed = resizeToBase64(img, MAX_DIM);
    // base64 length * 0.75 ≈ bytes
    const bytes = Math.floor((compressed.length - "data:image/jpeg;base64,".length) * 0.75);
    if (bytes > MAX_IMAGE_BYTES) {
      warn.style.display = "block";
      warn.textContent = `compressed photo is ${(bytes / 1024).toFixed(0)}KB (>300KB) — saved anyway, but consider a smaller one`;
    }
    await chrome.storage.local.set({ goalImages: [...goalImages, { name: file.name, src: compressed }] });
    toast();
    renderStars();
  } catch (err) {
    warn.style.display = "block";
    warn.textContent = `upload failed: ${err.message || err}`;
  }
}

// ---------- The toll (steppers) ----------
function renderStepper(cfg, value) {
  $(cfg.valId).textContent = String(value);
  $(cfg.decId).disabled = value <= cfg.min;
  $(cfg.incId).disabled = value >= cfg.max;
}

async function loadStepper(cfg) {
  const got = await chrome.storage.sync.get(cfg.key);
  const value = clamp(typeof got[cfg.key] === "number" ? got[cfg.key] : cfg.def, cfg.min, cfg.max);
  renderStepper(cfg, value);
}

async function bumpStepper(cfg, dir) {
  const got = await chrome.storage.sync.get(cfg.key);
  const current = typeof got[cfg.key] === "number" ? got[cfg.key] : cfg.def;
  const next = clamp(current + dir * cfg.step, cfg.min, cfg.max);
  if (next === current) return;
  await chrome.storage.sync.set({ [cfg.key]: next });
  renderStepper(cfg, next);
  toast();
}

function wireStepper(cfg) {
  $(cfg.decId).addEventListener("click", () => bumpStepper(cfg, -1));
  $(cfg.incId).addEventListener("click", () => bumpStepper(cfg, +1));
}

// ---------- Friction reminders ----------
async function renderFrictionToggle() {
  const { frictionEnabled } = await chrome.storage.sync.get("frictionEnabled");
  const on = frictionEnabled !== false;
  const btn = $("friction-toggle");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-checked", String(on));
}

async function toggleFrictionReminders() {
  const { frictionEnabled } = await chrome.storage.sync.get("frictionEnabled");
  await chrome.storage.sync.set({ frictionEnabled: frictionEnabled === false });
  toast();
  renderFrictionToggle();
}

function wireFrictionToggle() {
  const btn = $("friction-toggle");
  btn.addEventListener("click", toggleFrictionReminders);
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFrictionReminders();
    }
  });
}

// ---------- Theme ----------
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  setFavicon(name);
  try { localStorage.setItem("dt-theme", name); } catch {}
}

function markActiveTheme(name) {
  document.querySelectorAll(".theme-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === name);
  });
}

async function renderTheme() {
  const { theme } = await chrome.storage.sync.get("theme");
  const active = THEMES.includes(theme) ? theme : "amber";
  applyTheme(active);
  markActiveTheme(active);
}

function wireThemes() {
  document.querySelectorAll(".theme-opt").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.theme;
      if (!THEMES.includes(name)) return;
      await chrome.storage.sync.set({ theme: name });
      applyTheme(name);
      markActiveTheme(name);
      toast();
    });
  });
}

// ---------- Wire-up ----------
function init() {
  $("domain-add").addEventListener("click", addDomain);
  $("domain-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDomain();
  });

  $("phrase-add").addEventListener("click", addPhrase);
  $("phrase-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addPhrase();
  });

  $("file-input").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
    e.target.value = "";
  });

  wireStepper(LOCK_STEP);
  wireStepper(UNLOCK_STEP);
  wireStepper(FRICTION_STEP);
  wireFrictionToggle();
  wireThemes();

  renderDomains();
  renderPhrases();
  renderStars();
  loadStepper(LOCK_STEP);
  loadStepper(UNLOCK_STEP);
  loadStepper(FRICTION_STEP);
  renderFrictionToggle();
  renderTheme();
}

document.addEventListener("DOMContentLoaded", init);
