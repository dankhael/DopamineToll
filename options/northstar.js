// The north star photos: upload, downscale, store, render, remove.
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

  async function handleUpload(file) {
    const warn = $("upload-warn");
    warn.style.display = "none";
    warn.textContent = "";

    const { goalImages = [] } = await chrome.storage.local.get("goalImages");
    if (goalImages.length >= MAX_IMAGES) {
      warn.style.display = "block";
      warn.textContent = DTI18n.t("optionsLimitReached", [String(MAX_IMAGES)]);
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
        const kb = String((bytes / 1024).toFixed(0));
        const maxKb = String(Math.round(MAX_IMAGE_BYTES / 1024));
        warn.textContent = DTI18n.t("optionsCompressWarn", [kb, maxKb]);
      }
      await chrome.storage.local.set({ goalImages: [...goalImages, { name: file.name, src: compressed }] });
      toast();
      renderStars();
    } catch (err) {
      warn.style.display = "block";
      warn.textContent = DTI18n.t("optionsUploadFailed", [String(err.message || err)]);
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
