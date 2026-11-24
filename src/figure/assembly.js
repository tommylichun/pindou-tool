import { FONT, drawGrid, drawLegend, legendMetrics } from "../render.js";
import { newPage, header, footer, ruler, PAGE, M, PX_PER_MM } from "../pdf.js";
import { FigureWorld } from "./physics.js";
import { plateCanvas } from "./view.js";
import { partName, CONNECTORS, orderedParts } from "./model.js";

/** Joint list in tree order: J1 is the keyring hole, then each child's hole pair. */
export function jointList(fig) {
  const out = [];
  const parts = orderedParts(fig);
  const root = parts.find((p) => !p.parent);
  if (root) out.push({ id: "J1", parent: null, child: root, parentHole: null, childHole: root.pivotSelf, connector: "keyring", limit: 180 });
  for (const p of parts) {
    if (!p.parent) continue;
    out.push({ id: `J${out.length + 1}`, parent: fig.parts.find((q) => q.id === p.parent), child: p, parentHole: p.pivotParent, childHole: p.pivotSelf, connector: p.connector, limit: p.limit });
  }
  return out;
}

export function hardwareCounts(fig) {
  const joints = jointList(fig);
  return {
    jumpRings: joints.filter((j) => j.connector === "jump-ring").length,
    rivets: joints.filter((j) => j.connector === "rivet").length,
    keyring: 1,
  };
}

export function combinedLegend(patterns) {
  const map = new Map();
  for (const P of patterns) for (const l of P.legend) {
    const e = map.get(l.code) || { ...l, count: 0 };
    e.count += l.count;
    map.set(l.code, e);
  }
  return [...map.values()].sort((a, b) => a.series.localeCompare(b.series) || parseInt(a.code.slice(1)) - parseInt(b.code.slice(1)));
}

const hole1 = ([c, r]) => `(${c + 1}, ${r + 1})`;

/** Assembly sheet as a canvas: rest-pose figure, flat parts with numbered holes, joint table, totals. */
export function renderAssembly(fig, patterns, { scale = 2.4 } = {}) {
  const joints = jointList(fig);
  const hw = hardwareCounts(fig);
  const world = new FigureWorld(fig, patterns, [0, 0]);
  const parts = orderedParts(fig);
  const pitch = fig.pitchMm;
  const pad = 32, unit = 14;

  // Rest-pose bounds.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of world.partBodies) {
    const x0 = b.x - b.com[0], y0 = b.y - b.com[1];
    minX = Math.min(minX, x0); minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x0 + b.pattern.cols * pitch); maxY = Math.max(maxY, y0 + b.pattern.rows * pitch);
  }
  minY = Math.min(minY, -24);
  const poseW = (maxX - minX) * scale, poseH = (maxY - minY) * scale;

  // Flat parts layout (wrap into rows).
  const flatMaxW = 760;
  const tiles = [];
  let fx = 0, fy = 0, rowH = 0;
  for (const p of parts) {
    const P = patterns.get(p.id);
    const w = P.cols * pitch * scale, h = P.rows * pitch * scale;
    const tw = Math.max(w, 170), th = h + 70;
    if (fx > 0 && fx + tw > flatMaxW) { fx = 0; fy += rowH + 18; rowH = 0; }
    tiles.push({ p, P, x: fx, y: fy, w, h, tw });
    fx += tw + 22;
    rowH = Math.max(rowH, th);
  }
  const flatW = Math.max(...tiles.map((t) => t.x + t.tw)), flatH = fy + rowH;

  const totalBeads = [...patterns.values()].reduce((s, P) => s + P.total, 0);
  const legend = combinedLegend([...patterns.values()]);
  const width = Math.max(pad * 3 + poseW + flatW, 980);
  const lm = legendMetrics(legend.length, width - pad * 2, unit);
  const tableRowH = 24;
  const topH = Math.max(poseH + 30, flatH + 30);
  const height = pad + 80 + topH + 40 + (joints.length + 1) * tableRowH + 50 + lm.height + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#1f2328";
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(`装配图 Assembly sheet — ${fig.name}`, pad, pad);
  ctx.font = `400 13px ${FONT}`;
  ctx.fillStyle = "#57606a";
  ctx.fillText(`${parts.length} 个部件 parts · ${joints.length} 个连接点 joints · 开口圈 jump rings ×${hw.jumpRings} · 铆钉/按扣 rivets ×${hw.rivets} · 钥匙圈+珠链 keyring + ball chain ×1 · 合计 Total ${totalBeads} 颗 beads @ ${pitch} mm`, pad, pad + 32);
  ctx.fillText(`静止悬挂尺寸 Hanging size ≈ ${((maxX - minX) / 10).toFixed(1)} × ${((maxY - Math.min(...world.partBodies.map((b) => b.y - b.com[1]))) / 10).toFixed(1)} cm · 孔位按 (列, 行) 从 1 开始 Hole = (col, row), 1-based`, pad, pad + 52);

  const top = pad + 84;
  const S = (x, y) => [pad + (x - minX) * scale, top + 10 + (y - minY) * scale];
  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = "#1f2328";
  ctx.fillText("组装效果 Assembled (rest)", pad, top - 6);
  for (const b of world.partBodies) {
    const pc = plateCanvas(b.pattern, pitch * scale);
    const [x, y] = S(b.x - b.com[0], b.y - b.com[1]);
    ctx.drawImage(pc, x - 1, y - 1);
  }
  const [hx, hy] = S(0, 0);
  ctx.strokeStyle = "#9aa3ad";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx, hy - 8 * scale, 8 * scale, 0, Math.PI * 2); ctx.stroke();
  const chainEnd = world.joints.find((j) => j.part && !j.part.parent);
  if (chainEnd) {
    const [ex, ey] = S(...world.jointPos(chainEnd));
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  const tag = (x, y, text, color = "#ef5b5b") => {
    ctx.font = `700 11px ${FONT}`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x + 6, y - 8, w, 16, 4); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 10, y);
    ctx.textBaseline = "top";
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
  };
  joints.forEach((j) => {
    const wj = world.joints.find((q) => q.part === j.child);
    if (wj) tag(...S(...world.jointPos(wj)), j.id);
  });

  // Flat parts with numbered holes.
  const fx0 = pad * 2 + poseW;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = "#1f2328";
  ctx.fillText("部件与孔位 Parts & holes", fx0, top - 6);
  for (const t of tiles) {
    const x = fx0 + t.x, y = top + 14 + t.y;
    const pc = plateCanvas(t.P, pitch * scale);
    ctx.drawImage(pc, x - 1, y - 1);
    ctx.fillStyle = "#1f2328";
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(partName(t.p), x, y + t.h + 6);
    ctx.font = `400 11.5px ${FONT}`;
    ctx.fillStyle = "#57606a";
    ctx.fillText(`${t.P.cols}×${t.P.rows} 颗 · ${(t.P.cols * pitch / 10).toFixed(1)}×${(t.P.rows * pitch / 10).toFixed(1)} cm`, x, y + t.h + 24);
    ctx.fillText(`${t.P.total} 颗 beads${t.p.pattern ? "" : " · 占位 placeholder"}`, x, y + t.h + 40);
    for (const j of joints) {
      const holeHere = j.child === t.p ? j.childHole : j.parent === t.p ? j.parentHole : null;
      if (!holeHere) continue;
      tag(x + (holeHere[0] + 0.5) * pitch * scale, y + (holeHere[1] + 0.5) * pitch * scale, j.id, j.child === t.p ? "#ef5b5b" : "#3e6fd8");
    }
  }

  // Joint table.
  let ty = top + topH + 20;
  const cols = [pad, pad + 60, pad + 300, pad + 540, pad + 720, pad + 860];
  ctx.font = `700 13px ${FONT}`;
  ctx.fillStyle = "#1f2328";
  ["连接 Joint", "上方部件 · 孔 Upper part · hole", "下方部件 · 孔 Hanging part · hole", "连接件 Connector", "摆角 Swing"].forEach((h, i) => ctx.fillText(h, cols[i], ty));
  ctx.strokeStyle = "#d0d7de";
  ctx.beginPath(); ctx.moveTo(pad, ty + 19); ctx.lineTo(width - pad, ty + 19); ctx.stroke();
  ctx.font = `400 13px ${FONT}`;
  for (const j of joints) {
    ty += tableRowH;
    ctx.fillStyle = "#1f2328";
    ctx.fillText(j.id, cols[0], ty);
    ctx.fillText(j.parent ? `${partName(j.parent)} ${hole1(j.parentHole)}` : "钥匙圈 Keyring", cols[1], ty);
    ctx.fillText(`${partName(j.child)} ${hole1(j.childHole)}`, cols[2], ty);
    ctx.fillText(j.connector === "keyring" ? "珠链+钥匙圈 Chain + ring" : CONNECTORS[j.connector] || j.connector, cols[3], ty);
    ctx.fillText(j.limit >= 180 ? "自由 free" : `±${j.limit}°`, cols[4], ty);
  }

  ty += 40;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(`材料清单 Shopping list — ${legend.length} 色 colors · 合计 Total ${totalBeads} 颗 beads`, pad, ty);
  drawLegend(ctx, legend, { x: pad, y: ty + 26, width: width - pad * 2, unit });
  return canvas;
}

/** PDF: assembly sheet (fit) + one 1:1 page per part with its holes marked + combined shopping list. */
export async function exportFigurePdf(fig, patterns, paletteName, filename) {
  const { jsPDF } = window.jspdf;
  const pages = [];
  const pitch = fig.pitchMm;
  const joints = jointList(fig);

  {
    const { canvas, ctx } = newPage();
    const a = renderAssembly(fig, patterns, { scale: 2.4 });
    const maxW = PAGE.w - 2 * M, maxH = PAGE.h - 2 * M - 8;
    const k = Math.min(maxW / a.width, maxH / a.height);
    ctx.drawImage(a, M, M, a.width * k, a.height * k);
    pages.push(canvas);
  }

  for (const p of orderedParts(fig)) {
    const P = patterns.get(p.id);
    const { canvas, ctx } = newPage();
    const top = header(ctx, `${partName(p)} · 1:1`, [
      `${P.cols} × ${P.rows} 颗 beads · ${((P.cols * pitch) / 10).toFixed(1)} × ${((P.rows * pitch) / 10).toFixed(1)} cm @ ${pitch} mm · ${P.total} 颗 · ${paletteName}`,
      `○ 孔位 holes: ${joints.filter((j) => j.child === p || j.parent === p).map((j) => `${j.id} ${hole1(j.child === p ? j.childHole : j.parentHole)}`).join(" · ")} — 在该豆上穿开口圈/铆钉 put the ring/rivet through this bead`,
    ]);
    const x = (PAGE.w - P.cols * pitch) / 2, y = top + 6;
    drawGrid(ctx, P, { x, y, cell: pitch, board: 1000, numberSize: Math.min(2.4, pitch * 0.7), thin: 0.08 });
    for (const j of joints) {
      const hole = j.child === p ? j.childHole : j.parent === p ? j.parentHole : null;
      if (!hole) continue;
      const cx = x + (hole[0] + 0.5) * pitch, cy = y + (hole[1] + 0.5) * pitch;
      ctx.lineWidth = 0.45;
      ctx.strokeStyle = j.child === p ? "#ef5b5b" : "#3e6fd8";
      ctx.beginPath(); ctx.arc(cx, cy, pitch * 0.75, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `700 2.6px ${FONT}`;
      ctx.textBaseline = "middle";
      ctx.fillText(j.id, cx + pitch * 0.9, cy - pitch * 0.6);
    }
    const ly = y + P.rows * pitch + 9;
    ctx.fillStyle = "#1f2328";
    ctx.textBaseline = "top";
    ctx.font = `700 3.2px ${FONT}`;
    ctx.fillText(`色号清单 Legend — ${P.legend.length} 色 · ${P.total} 颗`, M, ly);
    drawLegend(ctx, P.legend, { x: M, y: ly + 5, width: PAGE.w - 2 * M, unit: 3 });
    ruler(ctx, M, PAGE.h - 16);
    pages.push(canvas);
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pages.forEach((canvas, i) => {
    if (i > 0) doc.addPage("a4", "portrait");
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(PX_PER_MM, PX_PER_MM);
    footer(ctx, `${filename} · ${i === 0 ? "装配图 assembly" : "1:1 实际尺寸 real scale"}`, `${i + 1} / ${pages.length}`);
    doc.addImage(canvas, "PNG", 0, 0, PAGE.w, PAGE.h, undefined, "FAST");
  });
  doc.save(`${filename}-figure.pdf`);
  return pages.length;
}

