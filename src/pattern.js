import { rgbToLab, hexToRgb, ciede2000 } from "./color.js";

export const EMPTY = -1;

/** Turn a palette JSON file into match-ready entries, dropping excluded codes. */
export function preparePalette(paletteJson, excluded = new Set()) {
  return paletteJson.colors
    .filter((c) => !excluded.has(c.code))
    .map((c) => {
      const rgb = hexToRgb(c.hex);
      return { ...c, rgb, lab: rgbToLab(...rgb) };
    });
}

export function nearestIndex(lab, entries) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < entries.length; i++) {
    const d = ciede2000(lab, entries[i].lab);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Map every RGBA pixel to a palette index (EMPTY for transparent pixels). */
export function mapToPalette(img, entries, alphaThreshold = 128) {
  const { width, height, data } = img;
  const out = new Int16Array(width * height);
  const cache = new Map();
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < alphaThreshold) { out[i] = EMPTY; continue; }
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = nearestIndex(rgbToLab(data[o], data[o + 1], data[o + 2]), entries);
      cache.set(key, idx);
    }
    out[i] = idx;
  }
  return out;
}

/**
 * Resample an index grid. Each target cell takes the most frequent index of the
 * source cells it covers (nearest-neighbour when enlarging), which keeps edges crisp.
 */
export function resampleIndices(cells, w, h, tw, th) {
  if (tw === w && th === h) return Int16Array.from(cells);
  const out = new Int16Array(tw * th);
  const counts = new Map();
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      counts.clear();
      let best = EMPTY, bestC = -1;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = cells[y * w + x];
          const c = (counts.get(v) || 0) + 1;
          counts.set(v, c);
          if (c > bestC || (c === bestC && v < best)) { bestC = c; best = v; }
        }
      }
      out[ty * tw + tx] = best;
    }
  }
  return out;
}

/** Clear the background: flood-fill from the border using the most common border colour. */
export function removeBackground(cells, w, h) {
  const border = new Map();
  const bump = (i) => border.set(cells[i], (border.get(cells[i]) || 0) + 1);
  for (let x = 0; x < w; x++) { bump(x); bump((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { bump(y * w); bump(y * w + w - 1); }
  let bg = EMPTY, bgC = 0;
  for (const [k, c] of border) if (k !== EMPTY && c > bgC) { bg = k; bgC = c; }
  if (bg === EMPTY) return cells;
  const out = Int16Array.from(cells);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (out[i] === bg) { out[i] = EMPTY; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return out;
}

export function countColors(cells) {
  const counts = new Map();
  for (const v of cells) if (v !== EMPTY) counts.set(v, (counts.get(v) || 0) + 1);
  return counts;
}

/** Repeatedly fold the least-used colour into its perceptually nearest surviving colour. */
export function limitColors(cells, entries, maxColors) {
  const counts = countColors(cells);
  if (!maxColors || counts.size <= maxColors) return cells;
  const remap = new Map();
  while (counts.size > maxColors) {
    let victim = -1, victimC = Infinity;
    for (const [k, c] of counts) if (c < victimC) { victimC = c; victim = k; }
    counts.delete(victim);
    let target = -1, bestD = Infinity;
    for (const k of counts.keys()) {
      const d = ciede2000(entries[victim].lab, entries[k].lab);
      if (d < bestD) { bestD = d; target = k; }
    }
    counts.set(target, counts.get(target) + victimC);
    remap.set(victim, target);
    for (const [from, to] of remap) if (to === victim) remap.set(from, target);
  }
  const out = Int16Array.from(cells);
  for (let i = 0; i < out.length; i++) {
    const r = remap.get(out[i]);
    if (r !== undefined) out[i] = r;
  }
  return out;
}

/**
 * Work out the bead grid from the snapped source size and the user's sizing choice.
 * mode: "original" | "cm" | "beads". maxW/maxH are the bounding box (either may be empty);
 * the grid keeps the source aspect ratio and fits inside the box.
 */
export function computeGrid({ srcW, srcH, mode, maxW, maxH, pitchMm }) {
  let cols = srcW, rows = srcH;
  if (mode !== "original") {
    const toBeads = (v) => (mode === "cm" ? (v * 10) / pitchMm : v);
    const bw = maxW > 0 ? toBeads(maxW) : Infinity;
    const bh = maxH > 0 ? toBeads(maxH) : Infinity;
    if (Number.isFinite(bw) || Number.isFinite(bh)) {
      const scale = Math.min(bw / srcW, bh / srcH);
      cols = Math.max(1, Math.floor(srcW * scale + 1e-6));
      rows = Math.max(1, Math.floor(srcH * scale + 1e-6));
    }
  }
  cols = Math.min(cols, 1000);
  rows = Math.min(rows, 1000);
  return { cols, rows, widthMm: cols * pitchMm, heightMm: rows * pitchMm };
}

export function boardLayout(cols, rows, board) {
  const bx = Math.ceil(cols / board), by = Math.ceil(rows / board);
  return { boardsX: bx, boardsY: by, boards: bx * by };
}

/** Full downstream pipeline from a snapped RGBA grid to a bead pattern. */
export function buildPattern(snapped, entries, { cols, rows, maxColors = 0, removeBg = false }) {
  let cells = mapToPalette(snapped, entries);
  cells = resampleIndices(cells, snapped.width, snapped.height, cols, rows);
  if (removeBg) cells = removeBackground(cells, cols, rows);
  cells = limitColors(cells, entries, maxColors);
  const counts = countColors(cells);
  const legend = [...counts.entries()]
    .map(([idx, count]) => ({ ...entries[idx], idx, count }))
    .sort((a, b) => a.series.localeCompare(b.series) || codeNum(a.code) - codeNum(b.code));
  const total = legend.reduce((s, l) => s + l.count, 0);
  return { cols, rows, cells, entries, legend, total };
}

function codeNum(code) {
  return parseInt(code.replace(/^\D+/, ""), 10) || 0;
}
