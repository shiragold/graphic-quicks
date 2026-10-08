import {
  computeCollageLayout,
  readExifDate,
} from "../../packages/collage/dist/index.js";
import "../../packages/ui-photo-upload/dist/index.js";

const photos = [];

const $ = (id) => document.getElementById(id);
const uploadArea = $("uploadArea");
const thumbsEl = $("thumbs");
const canvas = $("previewCanvas");
const ctx = canvas.getContext("2d");
const previewWrap = $("previewWrap");
const previewPlaceholder = $("previewPlaceholder");
const downloadBtn = $("downloadBtn");
const clearBtn = $("clearBtn");

const controls = {
  outWidth: $("outWidth"),
  outHeight: $("outHeight"),
  layout: $("layout"),
  columns: $("columns"),
  gap: $("gap"),
  radius: $("radius"),
  bgColor: $("bgColor"),
  heroPos: $("heroPos"),
};

// ---------- EXIF date extraction (JPEG only) ----------
// The byte-level parsing lives in @graphic-quicks/collage; this wrapper
// handles the File -> bytes step and the "is it even a JPEG?" check.
async function readFileExifDate(file) {
  if (!/jpeg|jpg/i.test(file.type) && !/\.jpe?g$/i.test(file.name))
    return null;
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    return readExifDate(new Uint8Array(buf));
  } catch (e) {
    return null;
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load failed"));
    };
    img.src = url;
  });
}

// Accepts any iterable of File (the File[] from <photo-upload>).
async function addFiles(incoming) {
  const files = Array.from(incoming).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (!files.length) return;

  const newPhotos = await Promise.all(
    files.map(async (file) => {
      const exifDate = await readFileExifDate(file);
      const date = exifDate || new Date(file.lastModified);
      const { img, url } = await loadImage(file);
      return { file, img, url, date, name: file.name };
    }),
  );

  // Sort the newly-added batch by date taken (oldest first), then append.
  newPhotos.sort((a, b) => a.date - b.date);
  photos.push(...newPhotos);

  renderThumbs();
  render();
  updateButtons();
}

function renderThumbs() {
  thumbsEl.innerHTML = "";
  photos.forEach((p, i) => {
    const el = document.createElement("li");
    el.className = "thumb";
    el.draggable = true;
    el.dataset.index = i;
    el.innerHTML = `
              <img src="${p.url}" alt="">
              <span class="order">${i + 1}</span>
              <button class="remove" title="Remove">x</button>
          `;
    el.querySelector(".remove").addEventListener("click", (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(p.url);
      photos.splice(i, 1);
      renderThumbs();
      render();
      updateButtons();
    });

    el.addEventListener("dragstart", (e) => {
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const from = +e.dataTransfer.getData("text/plain");
      const to = +el.dataset.index;
      if (isNaN(from) || from === to) return;
      const [moved] = photos.splice(from, 1);
      photos.splice(to, 0, moved);
      renderThumbs();
      render();
    });

    thumbsEl.appendChild(el);
  });
}

function updateButtons() {
  const has = photos.length > 0;
  downloadBtn.disabled = !has;
  clearBtn.disabled = !has;
  previewPlaceholder.style.display = has ? "none" : "block";
  canvas.style.display = has ? "block" : "none";
  updateLayoutOptionsAvailability();
}

// Hide layout options that don't apply to the current photo count.
function updateLayoutOptionsAvailability() {
  const n = photos.length;
  const mosaicOpt = controls.layout.querySelector('option[value="mosaic"]');
  const mosaicAvailable = n >= 1 && n <= 9;
  mosaicOpt.hidden = !mosaicAvailable;
  mosaicOpt.disabled = !mosaicAvailable;
  if (!mosaicAvailable && controls.layout.value === "mosaic") {
    controls.layout.value = "justified-rows";
    updateLayoutFieldsVisibility();
  }
}

// ---------- Layout / drawing ----------
function getSettings() {
  return {
    W: Math.max(100, +controls.outWidth.value || 800),
    H: Math.max(100, +controls.outHeight.value || 1200),
    layout: controls.layout.value,
    columns: Math.max(1, +controls.columns.value || 1),
    gap: +controls.gap.value,
    padding: 0,
    radius: +controls.radius.value,
    bg: controls.bgColor.value,
    heroPos: controls.heroPos.value,
  };
}

function roundedRectPath(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

// Draw image to fill rect (object-fit: cover)
function drawCover(c, img, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  c.save();
  if (r > 0) {
    roundedRectPath(c, x, y, w, h, r);
    c.clip();
  } else {
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
  }
  const ir = img.naturalWidth / img.naturalHeight;
  const tr = w / h;
  let sx, sy, sw, sh;
  if (ir > tr) {
    sh = img.naturalHeight;
    sw = sh * tr;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / tr;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  c.restore();
}

function render() {
  const s = getSettings();
  canvas.width = s.W;
  canvas.height = s.H;
  previewWrap.style.aspectRatio = `${s.W} / ${s.H}`;

  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, s.W, s.H);

  if (photos.length === 0) return;

  const aspects = photos.map((p) => p.img.naturalWidth / p.img.naturalHeight);
  const rects = computeCollageLayout(aspects, {
    width: s.W,
    height: s.H,
    layout: s.layout,
    columns: s.columns,
    gap: s.gap,
    padding: s.padding,
    heroPos: s.heroPos,
  });
  for (let i = 0; i < photos.length; i++) {
    const r = rects[i];
    if (!r) continue;
    if (r.polaroid) {
      drawPolaroid(ctx, photos[i].img, r);
    } else {
      drawCover(ctx, photos[i].img, r.x, r.y, r.w, r.h, s.radius);
    }
  }
}

function drawPolaroid(c, img, r) {
  const { borderSide, borderBottom, cx, cy, frameW, frameH } = r.polaroid;
  c.save();
  c.translate(cx, cy);
  c.rotate(r.rotation);
  // Frame (white with subtle shadow)
  c.shadowColor = "rgba(0,0,0,0.25)";
  c.shadowBlur = Math.max(4, frameW * 0.04);
  c.shadowOffsetX = 0;
  c.shadowOffsetY = Math.max(2, frameW * 0.02);
  c.fillStyle = "#ffffff";
  c.fillRect(-frameW / 2, -frameH / 2, frameW, frameH);
  // Photo content (cover-fit inside the photo rect, no shadow)
  c.shadowColor = "transparent";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
  const photoW = frameW - 2 * borderSide;
  const photoH = frameH - borderSide - borderBottom;
  const photoX = -frameW / 2 + borderSide;
  const photoY = -frameH / 2 + borderSide;
  drawCover(c, img, photoX, photoY, photoW, photoH, 0);
  c.restore();
}

// ---------- Wire up ----------
// <photo-upload> handles the picker, drag-and-drop, and dragover styling
// itself; it emits a File[] on every selection or drop.
uploadArea.addEventListener("photo-upload:files", (e) => {
  addFiles(e.detail.files);
});

// All inputs commit on blur / Enter / drag-release (change event),
// not on every keystroke or drag tick.
["gap", "radius"].forEach((k) => {
  controls[k].addEventListener("change", () => {
    $(k + "Val").textContent = controls[k].value;
    render();
  });
});
["outWidth", "outHeight", "layout", "columns", "bgColor", "heroPos"].forEach(
  (k) => {
    controls[k].addEventListener("change", render);
  },
);

// Show layout-specific fields only when relevant.
const columnsField = $("columnsField");
const heroPosField = $("heroPosField");
const LAYOUTS_WITH_COLUMNS = new Set(["grid", "columns"]);
function updateLayoutFieldsVisibility() {
  const layout = controls.layout.value;
  columnsField.hidden = !LAYOUTS_WITH_COLUMNS.has(layout);
  heroPosField.hidden = layout !== "hero-grid";
}
controls.layout.addEventListener("change", updateLayoutFieldsVisibility);

// Ratio preset buttons
document.querySelectorAll(".preset-btns button").forEach((btn) => {
  btn.addEventListener("click", () => {
    controls.outWidth.value = btn.dataset.w;
    controls.outHeight.value = btn.dataset.h;
    render();
  });
});

downloadBtn.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collage-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});

clearBtn.addEventListener("click", () => {
  photos.forEach((p) => URL.revokeObjectURL(p.url));
  photos.length = 0;
  renderThumbs();
  render();
  updateButtons();
});

// Initial state
updateButtons();
updateLayoutFieldsVisibility();
render();
