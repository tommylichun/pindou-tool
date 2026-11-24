import { preparePalette, buildPattern, computeGrid, boardLayout } from "../pattern.js";
import { renderSheet } from "../render.js";
import { exportPdf } from "../pdf.js";
import {
  MAX_BEADS, PART_KINDS, SHAPES, CONNECTORS, newPart, partName, partPattern, snapToBead,
  validateFigure, serializeFigure, deserializeFigure, orderedParts,
} from "./model.js";
import { TEMPLATES } from "./templates.js";
import { designFigure } from "./ai-design.js";
import { FigureWorld } from "./physics.js";
import { FigureView } from "./view.js";
import { renderAssembly, exportFigurePdf, hardwareCounts, combinedLegend } from "./assembly.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "bead-figure-v1";
const worker = new Worker(new URL("../snap-worker.js", import.meta.url), { type: "module" });
const pending = new Map();
let jobId = 0;
worker.onmessage = (e) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
};
const snap = (imageData) =>
  new Promise((resolve, reject) => {
    const id = ++jobId;
    pending.set(id, { resolve, reject });
    const data = new Uint8ClampedArray(imageData.data);
    worker.postMessage({ id, width: imageData.width, height: imageData.height, data, options: { kColors: 16 } }, [data.buffer]);
  });

const state = { palette: null, entries: null, fig: null, world: null, view: null, patterns: new Map(), tab: "sim", openPart: null };

function setStatus(t, err = false) {
  $("status").textContent = t;
  $("status").classList.toggle("err", err);
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeFigure(state.fig))); } catch { /* quota */ }
}

function computePatterns() {
  state.patterns = new Map(state.fig.parts.map((p) => [p.id, partPattern(p, state.entries)]));
}

// ---------- simulation ----------
function rebuildWorld(keepHand = true) {
  computePatterns();
  const hand = keepHand && state.world ? state.world.handTarget : [0, 0];
  state.world = new FigureWorld(state.fig, state.patterns, hand);
  state.view.setWorld(state.world);
  updateStats();
  persist();
}

function resizeCanvas() {
  const c = $("sim");
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  state.view.origin = [r.width / 2, 70];
  state.view.cache.clear();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.tab === "sim" && state.world) {
    state.world.step(dt);
    state.view.draw();
  }
  requestAnimationFrame(frame);
}

function setupPointer() {
  const c = $("sim");
  let mode = null, offset = [0, 0];
  c.addEventListener("pointerdown", (e) => {
    const r = c.getBoundingClientRect();
    const [wx, wy] = state.view.toWorld(e.clientX - r.left, e.clientY - r.top);
    c.setPointerCapture(e.pointerId);
    c.classList.add("dragging");
    if (state.world.grab(wx, wy)) { mode = "part"; return; }
    mode = "hand";
    offset = [state.world.handTarget[0] - wx, state.world.handTarget[1] - wy];
  });
  c.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const r = c.getBoundingClientRect();
    const [wx, wy] = state.view.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (mode === "part") state.world.moveDrag(wx, wy);
    else state.world.setHand(wx + offset[0], wy + offset[1]);
  });
  const up = () => { mode = null; state.world.release(); c.classList.remove("dragging"); };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
}

// ---------- stats / issues ----------
/** Rest-pose extent of the plates in mm, relative to the keyring anchor. */
function restExtent() {
  const w = new FigureWorld(state.fig, state.patterns, [0, 0]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of w.partBodies) {
    const x0 = b.x - b.com[0], y0 = b.y - b.com[1];
    minX = Math.min(minX, x0); minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x0 + b.pattern.cols * state.fig.pitchMm); maxY = Math.max(maxY, y0 + b.pattern.rows * state.fig.pitchMm);
  }
  return { minX, minY, maxX, maxY };
}

function hangingSize() {
  const e = restExtent();
  return [(e.maxX - e.minX) / 10, (e.maxY - e.minY) / 10];
}

function fitView() {
  const r = $("sim").getBoundingClientRect();
  if (!r.height) return;
  const e = restExtent();
  const half = Math.max(-e.minX, e.maxX) * 1.25;
  const s = Math.min((r.height - state.view.origin[1] - 50) / e.maxY, (r.width / 2 - 20) / half);
  state.view.scale = Math.max(1, Math.min(6, Math.floor(s * 10) / 10));
  $("zoom").value = state.view.scale;
  state.view.cache.clear();
}

function updateStats() {
  const hw = hardwareCounts(state.fig);
  const pats = [...state.patterns.values()];
  const total = pats.reduce((s, P) => s + P.total, 0);
  const [w, h] = hangingSize();
  $("s-parts").textContent = `${state.fig.parts.length} 件 · ${state.fig.parts.filter((p) => p.pattern).length} 有图 art`;
  $("s-hw").textContent = `圈 ${hw.jumpRings} · 钉 ${hw.rivets} · 钥匙圈 1`;
  $("s-size").textContent = `${w.toFixed(1)} × ${h.toFixed(1)} cm`;
  $("s-colors").textContent = combinedLegend(pats).length;
  $("s-total").textContent = total.toLocaleString();
  const issues = validateFigure(state.fig, state.entries);
  $("issues").innerHTML = issues.map((i) => `<li>${i}</li>`).join("");
}

// ---------- parts editor ----------
const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${typeof v === "string" ? v : `${v.zh} ${v.en}`}</option>`).join("");

function renderParts() {
  const fig = state.fig;
  $("part-count").textContent = `${fig.parts.length} 件 parts`;
  $("parts").innerHTML = orderedParts(fig)
    .map((p) => {
      const P = state.patterns.get(p.id) || partPattern(p, state.entries);
      const parents = fig.parts.filter((q) => q.id !== p.id);
      const parentOpts = `<option value="">🔑 钥匙圈 Keyring</option>` + parents.map((q) => `<option value="${q.id}" ${q.id === p.parent ? "selected" : ""}>${partName(q)}</option>`).join("");
      const cm = (n) => ((n * state.fig.pitchMm) / 10).toFixed(1);
      return `<details class="part" data-id="${p.id}" ${state.openPart === p.id ? "open" : ""}>
        <summary><span class="dot" style="background:${p.color}"></span><b>${partName(p)}</b>
          <span class="art ${p.pattern ? "" : "ph"}">${p.pattern ? "图案 art" : "占位 placeholder"}</span>
          <span class="meta">${P.cols}×${P.rows} · ${cm(P.cols)}×${cm(P.rows)} cm</span></summary>
        <div class="body">
          <label>类型 <em>Kind</em><select data-k="kind">${opt(PART_KINDS, p.kind)}</select></label>
          <label>名称 <em>Label</em><input data-k="label" type="text" value="${p.label || ""}" placeholder="${partName({ ...p, label: "" })}" /></label>
          <label>宽 <em>W (beads)</em><input data-k="w" type="number" min="3" max="${MAX_BEADS}" value="${p.w}" ${p.pattern ? "disabled title='由图案决定 set by artwork'" : ""} /></label>
          <label>高 <em>H (beads)</em><input data-k="h" type="number" min="3" max="${MAX_BEADS}" value="${p.h}" ${p.pattern ? "disabled title='由图案决定 set by artwork'" : ""} /></label>
          <label>占位形状 <em>Placeholder shape</em><select data-k="shape">${opt(SHAPES, p.shape)}</select></label>
          <label>占位颜色 <em>Color</em><input data-k="color" type="color" value="${p.color}" /></label>
          <label class="full">挂在 <em>Hangs from</em><select data-k="parent">${parentOpts}</select></label>
          <label>本件孔 <em>Own hole (col,row)</em><span class="pair"><input data-k="pivotSelf.0" type="number" min="1" max="${P.cols}" value="${p.pivotSelf[0] + 1}" /><input data-k="pivotSelf.1" type="number" min="1" max="${P.rows}" value="${p.pivotSelf[1] + 1}" /></span></label>
          <label>父件孔 <em>Parent hole</em><span class="pair"><input data-k="pivotParent.0" type="number" min="1" value="${p.pivotParent[0] + 1}" ${p.parent ? "" : "disabled"} /><input data-k="pivotParent.1" type="number" min="1" value="${p.pivotParent[1] + 1}" ${p.parent ? "" : "disabled"} /></span></label>
          <label>摆角 ± <em>Swing limit (°)</em><input data-k="limit" type="number" min="0" max="180" value="${p.limit}" /></label>
          <label>连接件 <em>Connector</em><select data-k="connector">${opt(CONNECTORS, p.connector)}</select></label>
          <label>层级 <em>Layer (z)</em><input data-k="z" type="number" min="0" max="9" value="${p.z}" /></label>
          <div class="actions">
            <label class="btn small">导入图片 Import art<input data-act="import" type="file" accept="image/*" hidden /></label>
            ${p.pattern ? `<button class="btn small" data-act="clear">清除图案 Clear art</button>` : ""}
            <button class="btn small" data-act="png">PNG</button>
            <button class="btn small" data-act="pdf">PDF 1:1</button>
            <button class="btn small danger" data-act="delete">删除 Delete</button>
          </div>
        </div>
      </details>`;
    })
    .join("");
}

function setField(p, key, raw) {
  if (key.includes(".")) {
    const [k, i] = key.split(".");
    p[k] = [...p[k]];
    p[k][+i] = Math.max(0, (parseInt(raw, 10) || 1) - 1);
    return;
  }
  if (["w", "h"].includes(key)) {
    const old = p[key];
    p[key] = Math.max(3, Math.min(MAX_BEADS, parseInt(raw, 10) || old));
    scaleHoles(p, key === "w" ? p.w / old : 1, key === "h" ? p.h / old : 1);
  } else if (["limit", "z"].includes(key)) p[key] = parseInt(raw, 10) || 0;
  else if (key === "parent") p.parent = raw || null;
  else p[key] = raw;
}

/** Keep holes in proportion when a part is resized, then make sure they sit on beads. */
function scaleHoles(p, sx, sy) {
  const sc = ([c, r]) => [Math.round((c + 0.5) * sx - 0.5), Math.round((r + 0.5) * sy - 0.5)];
  p.pivotSelf = sc(p.pivotSelf);
  for (const child of state.fig.parts) if (child.parent === p.id) child.pivotParent = sc(child.pivotParent);
}

function snapHolesOnto(p) {
  const P = partPattern(p, state.entries);
  p.pivotSelf = snapToBead(P, p.pivotSelf);
  for (const child of state.fig.parts) if (child.parent === p.id) child.pivotParent = snapToBead(P, child.pivotParent);
}

/** Crop rows/columns that are entirely the corner (background) colour or transparent. */
function trimMargin(img) {
  const { width: w, height: h, data } = img;
  const bg = [data[0], data[1], data[2], data[3]];
  const isBg = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return true;
    return bg[3] >= 128 && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 24;
  };
  let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
  const colBg = (x) => { for (let y = y0; y <= y1; y++) if (!isBg(x, y)) return false; return true; };
  const rowBg = (y) => { for (let x = 0; x < w; x++) if (!isBg(x, y)) return false; return true; };
  while (y0 < y1 && rowBg(y0)) y0++;
  while (y1 > y0 && rowBg(y1)) y1--;
  while (x0 < x1 && colBg(x0)) x0++;
  while (x1 > x0 && colBg(x1)) x1--;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return img;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * tw * 4);
  return { ...img, width: tw, height: th, data: out };
}

async function importArt(p, file) {
  setStatus(`正在处理 ${partName(p)}… Processing artwork…`);
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const snapped = trimMargin(await snap(cx.getImageData(0, 0, cv.width, cv.height)));
  // Fit within the part's bead box (never upscaled), MARD 221 colours, background removed.
  const grid = computeGrid({ srcW: snapped.width, srcH: snapped.height, mode: "beads", maxW: p.w, maxH: p.h, pitchMm: state.fig.pitchMm });
  const P = buildPattern(snapped, state.entries, { cols: grid.cols, rows: grid.rows, removeBg: true });
  const sx = P.cols / p.w, sy = P.rows / p.h;
  p.pattern = P;
  scaleHoles(p, sx, sy);
  p.w = P.cols;
  p.h = P.rows;
  snapHolesOnto(p);
  setStatus(`${partName(p)}: ${snapped.width}×${snapped.height} 格 → ${P.cols}×${P.rows} 颗, ${P.legend.length} 色, ${P.total} 颗`);
  return P;
}

function partInfo(P) {
  const pitch = state.fig.pitchMm;
  return { cols: P.cols, rows: P.rows, widthMm: P.cols * pitch, heightMm: P.rows * pitch, pitchMm: pitch, board: 52, ...boardLayout(P.cols, P.rows, 52), paletteName: `${state.palette.name.zh} ${state.palette.name.en}` };
}

function download(canvas, name) {
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }, "image/png");
}

function setupPartEvents() {
  const root = $("parts");
  root.addEventListener("toggle", (e) => {
    const d = e.target.closest?.("details.part");
    if (d && d.open) state.openPart = d.dataset.id;
  }, true);
  root.addEventListener("change", async (e) => {
    const d = e.target.closest("details.part");
    if (!d) return;
    const p = state.fig.parts.find((q) => q.id === d.dataset.id);
    state.openPart = p.id;
    if (e.target.dataset.act === "import" && e.target.files[0]) {
      try { await importArt(p, e.target.files[0]); } catch (err) { setStatus(`导入失败 Import failed: ${err.message}`, true); }
    } else if (e.target.dataset.k) {
      setField(p, e.target.dataset.k, e.target.value);
      if (["w", "h", "shape"].includes(e.target.dataset.k)) snapHolesOnto(p);
    } else return;
    rebuildWorld();
    renderParts();
    if (state.tab === "assembly") showAssembly();
  });
  root.addEventListener("click", async (e) => {
    const act = e.target.dataset?.act;
    if (!act || act === "import") return;
    const d = e.target.closest("details.part");
    const p = state.fig.parts.find((q) => q.id === d.dataset.id);
    const P = state.patterns.get(p.id);
    const name = `${state.fig.name}-${p.id}`;
    if (act === "png") download(renderSheet(P, partInfo(P), { cellPx: 28 }), `${name}-${P.cols}x${P.rows}.png`);
    if (act === "pdf") await exportPdf(P, partInfo(P), "real", `${name}-${P.cols}x${P.rows}`);
    if (act === "clear") { p.pattern = null; snapHolesOnto(p); }
    if (act === "delete") {
      if (state.fig.parts.length <= 1) return;
      state.fig.parts = state.fig.parts.filter((q) => q !== p);
      for (const q of state.fig.parts) if (q.parent === p.id) q.parent = p.parent;
      if (!state.fig.parts.some((q) => !q.parent)) state.fig.parts[0].parent = null;
    }
    if (act === "clear" || act === "delete") { rebuildWorld(); renderParts(); }
  });
}

// ---------- figure-level ----------
function loadFigure(fig) {
  state.fig = fig;
  state.openPart = null;
  $("chain-links").value = fig.chain.links;
  $("chain-len").value = fig.chain.linkMm;
  for (const p of fig.parts) snapHolesOnto(p);
  rebuildWorld(false);
  fitView();
  renderParts();
  if (state.tab === "assembly") showAssembly();
}

function showAssembly() {
  const box = $("assembly");
  box.innerHTML = "";
  box.append(renderAssembly(state.fig, state.patterns));
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tabs button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
  $("assembly").hidden = tab !== "assembly";
  $("sim-tools").style.visibility = tab === "sim" ? "visible" : "hidden";
  $("sim-hint").hidden = tab !== "sim";
  if (tab === "assembly") showAssembly();
}

async function init() {
  state.palette = await (await fetch("palettes/mard-221.json")).json();
  state.entries = preparePalette(state.palette);
  $("template").innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");
  $("llm-state").textContent = typeof window.figureDesignLLM === "function" ? "✓ 已接入 connected" : "— 未接入 not connected";

  state.view = new FigureView($("sim"), null);
  let fig = null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.parts?.length) fig = deserializeFigure(saved, state.entries);
  } catch { fig = null; }
  state.fig = fig || TEMPLATES.squirrel.build();
  resizeCanvas();
  loadFigure(state.fig);
  setupPointer();
  setupPartEvents();
  new ResizeObserver(() => resizeCanvas()).observe($("sim"));
  requestAnimationFrame(frame);

  $("btn-template").addEventListener("click", () => loadFigure(TEMPLATES[$("template").value].build()));
  $("btn-ai").addEventListener("click", async () => {
    const text = $("ai-text").value.trim();
    if (!text) return;
    const r = await designFigure(text, { useLLM: $("ai-llm").checked });
    if (r.source === "llm") {
      loadFigure(deserializeFigure(r.json, state.entries));
      $("ai-info").textContent = "LLM 设计已载入 LLM design loaded";
    } else {
      loadFigure(r.figure);
      const p = r.params;
      $("ai-info").textContent = `规则推断 Rules: ${p.species} · 尾巴 tail ${p.tail} · 手 arms ${p.arms ? "✓" : "✗"} · 腿 legs ${p.legs ? "✓" : "✗"}${p.headCm ? ` · 头宽 head ${p.headCm} cm` : ""}${p.totalCm ? ` · 总高 total ${p.totalCm} cm` : ""}`;
    }
  });
  $("btn-add").addEventListener("click", () => {
    const body = state.fig.parts.find((p) => p.kind === "body") || state.fig.parts[0];
    const p = newPart({ kind: "extra", w: 10, h: 10, shape: "oval", color: "#fec0df", z: 3, parent: body.id, pivotParent: [Math.floor(body.w / 2), Math.floor(body.h / 2)], pivotSelf: [5, 1], limit: 40 });
    state.fig.parts.push(p);
    state.openPart = p.id;
    snapHolesOnto(body);
    snapHolesOnto(p);
    rebuildWorld();
    renderParts();
  });
  for (const id of ["chain-links", "chain-len"]) {
    $(id).addEventListener("change", () => {
      state.fig.chain = { links: Math.max(0, Math.min(8, parseInt($("chain-links").value, 10) || 0)), linkMm: Math.max(2, parseFloat($("chain-len").value) || 7) };
      rebuildWorld();
    });
  }
  $("btn-shake").addEventListener("click", () => state.world.shake(1));
  $("btn-shake-hard").addEventListener("click", () => state.world.shake(2));
  $("btn-reset").addEventListener("click", () => { state.world = null; rebuildWorld(false); });
  $("show-joints").addEventListener("change", (e) => { state.view.showJoints = e.target.checked; state.view.cache.clear(); });
  $("zoom").addEventListener("input", (e) => { state.view.scale = parseFloat(e.target.value); state.view.cache.clear(); });
  document.querySelectorAll(".tabs button[data-view]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.view)));

  $("btn-save").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(serializeFigure(state.fig), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.fig.name}.figure.json`;
    a.click();
  });
  $("file-load").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { loadFigure(deserializeFigure(JSON.parse(await f.text()), state.entries)); } catch (err) { setStatus(`载入失败 Load failed: ${err.message}`, true); }
  });
  $("btn-assembly-png").addEventListener("click", () => download(renderAssembly(state.fig, state.patterns, { scale: 3 }), `${state.fig.name}-assembly.png`));
  $("btn-figure-pdf").addEventListener("click", async () => {
    setStatus("正在生成 PDF… Building PDF…");
    await new Promise((r) => setTimeout(r, 30));
    const n = await exportFigurePdf(state.fig, state.patterns, `${state.palette.name.zh} ${state.palette.name.en}`, state.fig.name);
    setStatus(`PDF 已导出 exported · ${n} 页 pages`);
  });
  setStatus("就绪 Ready");
}

window.__figureApp = state;
init().catch((err) => setStatus(`初始化失败 Init failed: ${err.message}`, true));
