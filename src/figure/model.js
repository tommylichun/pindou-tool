import { EMPTY, nearestIndex, countColors } from "../pattern.js";
import { rgbToLab, hexToRgb } from "../color.js";

export const MAX_BEADS = 50;
export const PITCH_MM = 2.6;
export const PART_KINDS = {
  head: { zh: "头", en: "Head" },
  body: { zh: "身体", en: "Body" },
  armL: { zh: "左手", en: "Left arm" },
  armR: { zh: "右手", en: "Right arm" },
  legL: { zh: "左腿", en: "Left leg" },
  legR: { zh: "右腿", en: "Right leg" },
  tail: { zh: "尾巴", en: "Tail" },
  ear: { zh: "耳朵", en: "Ear" },
  wing: { zh: "翅膀", en: "Wing" },
  extra: { zh: "配件", en: "Extra" },
};
export const SHAPES = {
  ears: "带耳圆角 Rounded + ears",
  roundrect: "圆角矩形 Rounded rect",
  oval: "椭圆 Oval",
  capsule: "胶囊 Capsule",
  rect: "矩形 Rect",
};
export const CONNECTORS = { "jump-ring": "开口圈 Jump ring", rivet: "铆钉/按扣 Rivet / snap" };

const clampBeads = (v) => Math.max(3, Math.min(MAX_BEADS, Math.round(v) || 3));

/** Inside-test for a placeholder silhouette on a w×h bead grid. */
function shapeMask(shape, w, h) {
  const m = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const x = c + 0.5, y = r + 0.5;
      let inside;
      if (shape === "oval") {
        inside = ((x - cx) / cx) ** 2 + ((y - cy) / cy) ** 2 <= 1;
      } else if (shape === "capsule") {
        const rad = Math.min(w, h) / 2;
        const ax = w >= h ? Math.min(Math.max(x, rad), w - rad) : cx;
        const ay = w >= h ? cy : Math.min(Math.max(y, rad), h - rad);
        inside = (x - ax) ** 2 + (y - ay) ** 2 <= rad * rad;
      } else if (shape === "rect") {
        inside = true;
      } else {
        const top = shape === "ears" ? h * 0.22 : 0;
        const rad = Math.max(2, Math.min(w, h - top) * 0.28);
        const qx = Math.min(Math.max(x, rad), w - rad);
        const qy = Math.min(Math.max(y, top + rad), h - rad);
        inside = y >= top && (x - qx) ** 2 + (y - qy) ** 2 <= rad * rad;
        if (shape === "ears" && !inside) {
          const ew = w * 0.26, eh = h * 0.34;
          for (const ex of [w * 0.2, w * 0.8]) {
            const dx = (x - ex) / (ew / 2), dy = (y - eh) / eh;
            if (dx * dx + dy * dy <= 1) inside = true;
          }
        }
      }
      m[r * w + c] = inside ? 1 : 0;
    }
  }
  return m;
}

/**
 * Placeholder bead pattern for a part without artwork: the silhouette filled with the
 * palette colour nearest to part.color, with a 1-bead dark outline like real pieces.
 */
export function placeholderPattern(part, entries) {
  const { w, h } = part;
  const mask = shapeMask(part.shape, w, h);
  const fill = nearestIndex(rgbToLab(...hexToRgb(part.color)), entries);
  const outline = nearestIndex(rgbToLab(29, 20, 20), entries);
  const cells = new Int16Array(w * h).fill(EMPTY);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!mask[r * w + c]) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const x = c + dx, y = r + dy;
        return x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x];
      });
      cells[r * w + c] = edge && Math.min(w, h) >= 5 ? outline : fill;
    }
  }
  return finishPattern(w, h, cells, entries);
}

export function finishPattern(cols, rows, cells, entries) {
  const counts = countColors(cells);
  const legend = [...counts.entries()]
    .map(([idx, count]) => ({ ...entries[idx], idx, count }))
    .sort((a, b) => a.series.localeCompare(b.series) || num(a.code) - num(b.code));
  return { cols, rows, cells, entries, legend, total: legend.reduce((s, l) => s + l.count, 0) };
}
const num = (code) => parseInt(code.replace(/^\D+/, ""), 10) || 0;

/** The pattern actually used for a part (imported artwork, else placeholder). */
export function partPattern(part, entries) {
  return part.pattern || placeholderPattern(part, entries);
}

export function isFilled(P, c, r) {
  return c >= 0 && r >= 0 && c < P.cols && r < P.rows && P.cells[r * P.cols + c] !== EMPTY;
}

/** Nearest filled bead to (c, r): a jump-ring hole must go through a real bead. */
export function snapToBead(P, [c, r]) {
  c = Math.max(0, Math.min(P.cols - 1, Math.round(c)));
  r = Math.max(0, Math.min(P.rows - 1, Math.round(r)));
  if (isFilled(P, c, r)) return [c, r];
  let best = [c, r], bestD = Infinity;
  for (let y = 0; y < P.rows; y++) {
    for (let x = 0; x < P.cols; x++) {
      if (!isFilled(P, x, y)) continue;
      const d = (x - c) ** 2 + (y - r) ** 2;
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
  }
  return best;
}

let uid = 0;
export function newPart(props) {
  const p = {
    id: props.id || `p${Date.now().toString(36)}${uid++}`,
    kind: "extra",
    label: "",
    w: 20,
    h: 20,
    shape: "roundrect",
    color: "#f2f2f2",
    z: 1,
    parent: null,
    pivotSelf: [10, 1],
    pivotParent: [10, 10],
    limit: 30,
    connector: "jump-ring",
    pattern: null,
    ...props,
  };
  p.w = clampBeads(p.w);
  p.h = clampBeads(p.h);
  return p;
}

export function partName(p) {
  if (p.label) return p.label;
  const k = PART_KINDS[p.kind] || PART_KINDS.extra;
  return `${k.zh} ${k.en}`;
}

/** Parents before children, so layout and physics can walk the tree in order. */
export function orderedParts(fig) {
  const out = [], seen = new Set();
  const byId = new Map(fig.parts.map((p) => [p.id, p]));
  const visit = (p, stack = new Set()) => {
    if (seen.has(p.id)) return;
    if (stack.has(p.id)) { p.parent = null; }
    stack.add(p.id);
    const parent = p.parent && byId.get(p.parent);
    if (parent) visit(parent, stack);
    else p.parent = null;
    seen.add(p.id);
    out.push(p);
  };
  fig.parts.forEach((p) => visit(p));
  return out;
}

export function validateFigure(fig, entries) {
  const issues = [];
  const roots = fig.parts.filter((p) => !p.parent);
  if (roots.length !== 1) issues.push(`需要恰好 1 个挂在钥匙圈上的部件 Exactly one part must hang from the keyring (found ${roots.length})`);
  for (const p of fig.parts) {
    if (p.w > MAX_BEADS || p.h > MAX_BEADS) issues.push(`${partName(p)} > ${MAX_BEADS} beads`);
    const P = partPattern(p, entries);
    if (!isFilled(P, ...p.pivotSelf)) issues.push(`${partName(p)}: 孔位不在豆子上 hole is not on a bead`);
    const parent = fig.parts.find((q) => q.id === p.parent);
    if (parent && !isFilled(partPattern(parent, entries), ...p.pivotParent)) issues.push(`${partName(parent)} → ${partName(p)}: 父件孔位不在豆子上 parent hole is not on a bead`);
  }
  return issues;
}

/** Plain-JSON form (patterns stored as colour codes) for save / load / localStorage. */
export function serializeFigure(fig) {
  return {
    version: 1,
    name: fig.name,
    pitchMm: fig.pitchMm,
    chain: fig.chain,
    parts: fig.parts.map(({ pattern, ...p }) => ({
      ...p,
      pattern: pattern ? { cols: pattern.cols, rows: pattern.rows, codes: Array.from(pattern.cells, (v) => (v === EMPTY ? "" : pattern.entries[v].code)) } : null,
    })),
  };
}

export function deserializeFigure(json, entries) {
  const index = new Map(entries.map((e, i) => [e.code, i]));
  return {
    name: json.name || "figure",
    pitchMm: json.pitchMm || PITCH_MM,
    chain: json.chain || { links: 3, linkMm: 7 },
    parts: (json.parts || []).map((p) => {
      let pattern = null;
      if (p.pattern?.codes) {
        const cells = Int16Array.from(p.pattern.codes, (c) => (c && index.has(c) ? index.get(c) : EMPTY));
        pattern = finishPattern(p.pattern.cols, p.pattern.rows, cells, entries);
      }
      return newPart({ ...p, pattern });
    }),
  };
}
