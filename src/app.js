import { preparePalette, buildPattern, computeGrid, boardLayout } from "./pattern.js";
import { renderSheet } from "./render.js";
import { exportPdf } from "./pdf.js";
import { luminance, hexToRgb } from "./color.js";

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL("./snap-worker.js", import.meta.url), { type: "module" });

const state = {
  paletteIndex: [],
  palette: null,
  excluded: new Set(),
  source: null, // { name, img: HTMLImageElement, imageData }
  snapped: null, // { width, height, data, stepX }
  pattern: null,
  info: null,
  view: "pattern",
  snapJob: 0,
};

function setStatus(text, err = false) {
  $("status").textContent = text;
  $("status").classList.toggle("err", err);
}

async function loadPaletteIndex() {
  state.paletteIndex = await (await fetch("palettes/index.json")).json();
  $("palette").innerHTML = state.paletteIndex.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  const def = state.paletteIndex.find((p) => p.default) || state.paletteIndex[0];
  $("palette").value = def.id;
  await loadPalette(def.id);
}

async function loadPalette(id) {
  const meta = state.paletteIndex.find((p) => p.id === id);
  state.palette = await (await fetch(`palettes/${meta.file}`)).json();
  state.excluded = new Set();
  $("palette-source").innerHTML = `<a href="${state.palette.source.split(" ")[0]}" target="_blank" rel="noopener">${state.palette.name.en}</a>`;
  renderPaletteControls();
}

function renderPaletteControls() {
  const P = state.palette;
  $("series").innerHTML = Object.entries(P.series)
    .map(([k, v]) => {
      const codes = P.colors.filter((c) => c.series === k);
      const off = codes.every((c) => state.excluded.has(c.code));
      return `<span class="chip${off ? " off" : ""}" data-series="${k}" title="${v.en}">${k} ${v.zh} · ${codes.length}</span>`;
    })
    .join("");
  $("swatches").innerHTML = P.colors
    .map((c) => {
      const fg = luminance(hexToRgb(c.hex)) > 0.36 ? "#1f2328" : "#fff";
      return `<button class="sw${state.excluded.has(c.code) ? " off" : ""}" data-code="${c.code}" title="${c.code} ${c.name} ${c.hex}" style="background:${c.hex};color:${fg}">${c.code}</button>`;
    })
    .join("");
  const n = state.excluded.size;
  $("excluded-count").textContent = n ? `(${n} 已排除 excluded · 剩 ${P.colors.length - n} left)` : `(${P.colors.length} 色 colors)`;
}

function readSettings() {
  const bead = $("bead").value;
  const pitchMm = bead === "custom" ? Math.max(0.5, parseFloat($("pitch").value) || 5) : parseFloat(bead);
  const boardSel = $("board").value;
  const board = boardSel === "custom" ? Math.max(5, parseInt($("board-custom").value, 10) || 29) : parseInt(boardSel, 10);
  return {
    pitchMm,
    board,
    mode: document.querySelector('input[name="mode"]:checked').value,
    maxW: parseFloat($("target-w").value) || 0,
    maxH: parseFloat($("target-h").value) || 0,
    maxColors: parseInt($("max-colors").value, 10) || 0,
    removeBg: $("remove-bg").checked,
    showCodes: $("show-codes").checked,
    cellPx: parseInt($("cell-px").value, 10),
  };
}

async function loadImageFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  state.source = { name: name.replace(/\.[^.]+$/, ""), img, imageData: ctx.getImageData(0, 0, c.width, c.height) };
  const drop = $("drop");
  drop.querySelector("img")?.remove();
  const thumb = img.cloneNode();
  drop.prepend(thumb);
  runSnap();
}

function runSnap() {
  if (!state.source) return;
  const { imageData } = state.source;
  if (!$("snap-on").checked) {
    state.snapped = { width: imageData.width, height: imageData.height, data: imageData.data, stepX: 1 };
    $("snap-info").textContent = `未校正，按原图 1 像素 = 1 颗豆 · No snapping: 1 image pixel = 1 bead (${imageData.width}×${imageData.height})`;
    recompute();
    return;
  }
  const id = ++state.snapJob;
  const ps = parseFloat($("pixel-size").value);
  setStatus("正在校正网格… Snapping grid…");
  const data = new Uint8ClampedArray(imageData.data);
  worker.postMessage(
    { id, width: imageData.width, height: imageData.height, data, options: { kColors: parseInt($("k-colors").value, 10) || 16, pixelSizeOverride: ps > 0 ? ps : null } },
    [data.buffer],
  );
}

worker.onmessage = (e) => {
  const m = e.data;
  if (m.id !== state.snapJob) return;
  if (!m.ok) {
    setStatus(`校正失败 Snap failed: ${m.error}`, true);
    return;
  }
  state.snapped = m;
  const { width, height } = state.source.imageData;
  $("snap-info").textContent = `检测像素 ≈ ${m.stepX.toFixed(1)}px · ${width}×${height} → ${m.width}×${m.height} 格 cells`;
  if (document.querySelector('input[name="mode"]:checked').value === "original") primeTargets();
  recompute();
};

function primeTargets() {
  if (!state.snapped) return;
  const s = readSettings();
  if (s.mode === "cm") {
    $("target-w").value = ((state.snapped.width * s.pitchMm) / 10).toFixed(1);
    $("target-h").value = "";
  } else if (s.mode === "beads") {
    $("target-w").value = state.snapped.width;
    $("target-h").value = "";
  }
}

function recompute() {
  if (!state.snapped) return;
  const s = readSettings();
  const entries = preparePalette(state.palette, state.excluded);
  if (!entries.length) {
    setStatus("没有可用颜色 No colors left — 请恢复部分颜色 restore some colors", true);
    return;
  }
  const t0 = performance.now();
  const grid = computeGrid({ srcW: state.snapped.width, srcH: state.snapped.height, mode: s.mode, maxW: s.maxW, maxH: s.maxH, pitchMm: s.pitchMm });
  state.pattern = buildPattern(state.snapped, entries, { cols: grid.cols, rows: grid.rows, maxColors: s.maxColors, removeBg: s.removeBg });
  const boards = boardLayout(grid.cols, grid.rows, s.board);
  state.info = { ...grid, ...boards, pitchMm: s.pitchMm, board: s.board, paletteName: state.palette.name.zh + " " + state.palette.name.en };

  const P = state.pattern;
  $("s-grid").textContent = `${P.cols} × ${P.rows}`;
  $("s-size").textContent = `${(grid.widthMm / 10).toFixed(1)} × ${(grid.heightMm / 10).toFixed(1)} cm`;
  $("s-boards").textContent = `${boards.boards} 块 (${boards.boardsX}×${boards.boardsY} @ ${s.board}²)`;
  $("s-colors").textContent = `${P.legend.length}`;
  $("s-total").textContent = P.total.toLocaleString();
  ["btn-png", "btn-pdf-fit", "btn-pdf-real"].forEach((id) => ($(id).disabled = false));
  setStatus(`完成 Done · ${Math.round(performance.now() - t0)} ms`);
  renderView();
}

function renderView() {
  const v = $("viewer");
  v.innerHTML = "";
  if (!state.source) {
    v.append($("empty") || "");
    return;
  }
  if (state.view === "original") {
    const img = state.source.img.cloneNode();
    img.className = "scaled";
    v.append(img);
  } else if (state.view === "snapped" && state.snapped) {
    const { width, height, data } = state.snapped;
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
    const scale = Math.max(1, Math.floor(640 / Math.max(width, height)));
    c.style.width = `${width * scale}px`;
    c.style.height = `${height * scale}px`;
    v.append(c);
  } else if (state.pattern) {
    const s = readSettings();
    const sheet = renderSheet(state.pattern, state.info, { cellPx: s.cellPx, showCodes: s.showCodes });
    sheet.style.width = `${sheet.width / devicePixelRatio}px`;
    sheet.style.imageRendering = "auto";
    v.append(sheet);
  }
}

function exportName() {
  const P = state.pattern;
  return `${state.source?.name || "pattern"}-${state.palette.id}-${P.cols}x${P.rows}`;
}

// ---- events ----
$("file").addEventListener("change", (e) => e.target.files[0] && loadImageFile(e.target.files[0], e.target.files[0].name));
const drop = $("drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) loadImageFile(f, f.name);
});
$("btn-sample").addEventListener("click", async () => {
  const blob = await (await fetch("samples/ai-pixel-shiba.jpg")).blob();
  loadImageFile(blob, "ai-pixel-shiba.jpg");
});

["snap-on", "pixel-size", "k-colors"].forEach((id) => $(id).addEventListener("change", runSnap));
$("palette").addEventListener("change", async (e) => { await loadPalette(e.target.value); recompute(); });
["max-colors", "remove-bg", "target-w", "target-h", "board-custom", "pitch"].forEach((id) => $(id).addEventListener("change", recompute));
["show-codes", "cell-px"].forEach((id) => $(id).addEventListener("input", renderView));
$("bead").addEventListener("change", () => {
  const custom = $("bead").value === "custom";
  $("pitch").disabled = !custom;
  if (!custom) $("pitch").value = $("bead").value;
  recompute();
});
$("board").addEventListener("change", () => {
  $("board-custom").hidden = $("board").value !== "custom";
  recompute();
});
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener("change", () => {
    const mode = r.value;
    $("target-row").style.display = mode === "original" ? "none" : "";
    $("unit-w").textContent = mode === "cm" ? "Max width (cm)" : "Max width (beads)";
    $("unit-h").textContent = mode === "cm" ? "Max height (cm)" : "Max height (beads)";
    primeTargets();
    recompute();
  }),
);
$("target-row").style.display = "none";

$("series").addEventListener("click", (e) => {
  const k = e.target.closest(".chip")?.dataset.series;
  if (!k) return;
  const codes = state.palette.colors.filter((c) => c.series === k).map((c) => c.code);
  const allOff = codes.every((c) => state.excluded.has(c));
  codes.forEach((c) => (allOff ? state.excluded.delete(c) : state.excluded.add(c)));
  renderPaletteControls();
  recompute();
});
$("swatches").addEventListener("click", (e) => {
  const code = e.target.closest(".sw")?.dataset.code;
  if (!code) return;
  state.excluded.has(code) ? state.excluded.delete(code) : state.excluded.add(code);
  renderPaletteControls();
  recompute();
});

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    state.view = b.dataset.view;
    renderView();
  }),
);

$("btn-png").addEventListener("click", () => {
  const s = readSettings();
  const canvas = renderSheet(state.pattern, state.info, { cellPx: Math.max(s.cellPx, 28), showCodes: s.showCodes });
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName()}.png`;
    a.click();
  }, "image/png");
});
for (const [id, mode] of [["btn-pdf-fit", "fit"], ["btn-pdf-real", "real"]]) {
  $(id).addEventListener("click", async () => {
    setStatus("正在生成 PDF… Building PDF…");
    await new Promise((r) => setTimeout(r, 30));
    const n = await exportPdf(state.pattern, state.info, mode, exportName());
    setStatus(`PDF 已导出 exported · ${n} 页 pages`);
  });
}

window.__beadApp = state;
loadPaletteIndex().catch((err) => setStatus(`色卡加载失败 Palette load failed: ${err.message}`, true));
