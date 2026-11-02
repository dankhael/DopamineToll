// The north star photos: upload, downscale, store, render, remove. An animated
// GIF, WebP or PNG skips the downscale and is stored as it is, so it keeps moving
// on the gate (ADR-0005).
//
// Split out of options.js so that file stays about the settings and this one owns
// one thing — the photos. `toast` is passed in rather than reached for, so this
// module has no opinion on how the page reports a save.
(() => {
  const MAX_IMAGES = 8;
  const MAX_IMAGE_BYTES = 300 * 1024;
  const MAX_DIM = 600;

  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => DTDom.el(document, tag, className, text);
  let toast = () => {};

  // Stored as {name, src}; legacy entries are bare base64 strings.
  function normImage(entry, i) {
    const fallbackName = DTI18n.t("optionsPhotoLabel", [String(i + 1)]);
    if (typeof entry === "string") return { name: fallbackName, src: entry };
    return { name: entry.name || fallbackName, src: entry.src };
  }

  async function renderStars() {
    const { goalImages = [] } = await chrome.storage.local.get("goalImages");
    const grid = $("stars");
    grid.innerHTML = "";

    goalImages.forEach((entry, i) => {
      const { name, src } = normImage(entry, i);
      const star = document.createElement("div");
      star.className = "star filled";
      star.innerHTML = `<img alt=""><span class="lbl"></span><button class="del">✕</button>`;
      star.querySelector("img").src = src;
      star.querySelector(".lbl").textContent = name;
      const del = star.querySelector(".del");
      del.title = DTI18n.t("optionsRemove");
      del.addEventListener("click", async () => {
        const next = goalImages.filter((_, j) => j !== i);
        await chrome.storage.local.set({ goalImages: next });
        toast();
        renderStars();
      });
      grid.appendChild(star);
    });

    if (goalImages.length < MAX_IMAGES) {
      const add = el("div", "star add");
      add.append(el("span", "plus", "+"), el("span", "lbl", DTI18n.t("optionsAddPhoto")));
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
      img.onerror = () => reject(new Error(DTI18n.t("optionsDecodeError")));
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

  // Shown under the grid; an empty message hides it.
  function showWarn(message) {
    const warn = $("upload-warn");
    warn.textContent = message || "";
    warn.style.display = message ? "block" : "none";
  }

  const kb = (bytes) => String(Math.round(bytes / 1024));

  // A refusal from DTPhotoBudget, as the sentence the user reads.
  function refusalMessage(refusal) {
    if (refusal.reason === "tooBig") {
      return DTI18n.t("optionsAnimationTooBig", [kb(refusal.size), kb(refusal.max)]);
    }
    return DTI18n.t("optionsPhotosFull", [kb(refusal.used), kb(refusal.max)]);
  }

  // A still is downscaled to a JPEG, as photos always were.
  async function stillDataUrl(file) {
    const raw = await readFileAsDataURL(file);
    const img = await loadImageElement(raw);
    return resizeToBase64(img, MAX_DIM);
  }

  // An animation goes in byte for byte, because a canvas keeps only its first
  // frame. `mime` comes from the sniffed bytes, not the file's extension.
  function animatedDataUrl(bytes, mime) {
    return readFileAsDataURL(new Blob([bytes], { type: mime }));
  }

  // The entry the file will be stored as, or why it can't be.
  async function buildEntry(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = DTAnimation.animatedType(bytes);
    if (!mime) {
      return { entry: { name: file.name, src: await stillDataUrl(file) }, animated: false };
    }
    const refusal = DTPhotoBudget.refuseTooBig(bytes.length);
    if (refusal) return { refusal };
    return { entry: { name: file.name, src: await animatedDataUrl(bytes, mime) }, animated: true };
  }

  // A still that came out heavy is saved anyway, with a nudge to pick a lighter one.
  function warnIfHeavy(src) {
    // base64 length * 0.75 ≈ bytes
    const bytes = Math.floor((src.length - "data:image/jpeg;base64,".length) * 0.75);
    if (bytes <= MAX_IMAGE_BYTES) return;
    showWarn(DTI18n.t("optionsCompressWarn", [kb(bytes), kb(MAX_IMAGE_BYTES)]));
  }

  async function saveUpload(file, goalImages) {
    const { entry, animated, refusal } = await buildEntry(file);
    const refused = refusal || DTPhotoBudget.refuseForRoom(goalImages, entry);
    if (refused) return showWarn(refusalMessage(refused));
    if (!animated) warnIfHeavy(entry.src);
    await chrome.storage.local.set({ goalImages: [...goalImages, entry] });
    toast();
    renderStars();
  }

  async function handleUpload(file) {
    showWarn("");
    const { goalImages = [] } = await chrome.storage.local.get("goalImages");
    if (goalImages.length >= MAX_IMAGES) {
      return showWarn(DTI18n.t("optionsLimitReached", [String(MAX_IMAGES)]));
    }
    try {
      await saveUpload(file, goalImages);
    } catch (err) {
      showWarn(DTI18n.t("optionsUploadFailed", [String(err.message || err)]));
    }
  }

  /**
   * Render the grid and wire the file picker. `toast` reports each save.
   *
   * Example: DTNorthStar.init({ toast: showToast })
   */
  function init(deps) {
    toast = deps.toast;
    $("file-input").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      e.target.value = "";
    });
    renderStars();
  }

  window.DTNorthStar = { init };
})();
