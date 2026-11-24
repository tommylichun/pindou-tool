import { luminance } from "./color.js";
import { EMPTY } from "./pattern.js";

export const FONT = `"Noto Sans CJK SC","PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif`;
const BOARD_LINE = "#e5484d";

function textColorFor(rgb) {
  return luminance(rgb) > 0.36 ? "#1f2328" : "#ffffff";
}

/**
 * Draw (part of) the pattern grid. Coordinates are in whatever unit the context
 * is scaled to (px for PNG, mm for PDF pages), so the same code serves both.
 * Region is columns [c0,c1) and rows [r0,r1); numbers are global (1-based).
 */
export function drawGrid(ctx, P, o) {
  const { x, y, cell, board, showCodes = true, numbers = true } = o;
  const c0 = o.c0 ?? 0, c1 = o.c1 ?? P.cols, r0 = o.r0 ?? 0, r1 = o.r1 ?? P.rows;
  const nc = c1 - c0, nr = r1 - r0;
  const W = nc * cell, H = nr * cell;
  const thin = o.thin ?? cell * 0.04;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const longest = Math.max(1, ...P.legend.map((l) => l.code.length));
  const fontSize = Math.min(cell * 0.46, (cell * 0.92) / (longest * 0.62));
  ctx.font = `600 ${fontSize}px ${FONT}`;

  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const v = P.cells[r * P.cols + c];
      const cx = x + (c - c0) * cell, cy = y + (r - r0) * cell;
      if (v === EMPTY) {
        ctx.fillStyle = "#c9ced6";
        ctx.beginPath();
        ctx.arc(cx + cell / 2, cy + cell / 2, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const e = P.entries[v];
      ctx.fillStyle = e.hex;
      ctx.fillRect(cx, cy, cell, cell);
      if (showCodes) {
        ctx.fillStyle = textColorFor(e.rgb);
        ctx.fillText(e.code, cx + cell / 2, cy + cell / 2 + fontSize * 0.04);
      }
    }
  }

  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  for (let pass = 0; pass < 3; pass++) {
    for (let c = c0; c <= c1; c++) {
      const kind = c % board === 0 || c === P.cols ? 2 : c % 5 === 0 ? 1 : 0;
      if (kind !== pass) continue;
      styleLine(ctx, kind, thin);
      line(x + (c - c0) * cell, y, x + (c - c0) * cell, y + H);
    }
    for (let r = r0; r <= r1; r++) {
      const kind = r % board === 0 || r === P.rows ? 2 : r % 5 === 0 ? 1 : 0;
      if (kind !== pass) continue;
      styleLine(ctx, kind, thin);
      line(x, y + (r - r0) * cell, x + W, y + (r - r0) * cell);
    }
  }
  ctx.lineWidth = thin * 3;
  ctx.strokeStyle = "#1f2328";
  ctx.strokeRect(x, y, W, H);

  if (numbers) {
    const nSize = Math.min(cell * 0.5, o.numberSize ?? cell * 0.5);
    ctx.font = `500 ${nSize}px ${FONT}`;
    const step = cell < nSize * 1.9 ? 5 : 1;
    const gap = nSize * 0.5;
    for (let c = c0; c < c1; c++) {
      const n = c + 1;
      if (step > 1 && n % step !== 0 && n !== 1) continue;
      ctx.fillStyle = n % board === 0 ? BOARD_LINE : n % 5 === 0 ? "#1f2328" : "#6e7781";
      const cx = x + (c - c0 + 0.5) * cell;
      ctx.textBaseline = "bottom";
      ctx.fillText(String(n), cx, y - gap * 0.6);
      ctx.textBaseline = "top";
      ctx.fillText(String(n), cx, y + H + gap * 0.6);
    }
    ctx.textBaseline = "middle";
    for (let r = r0; r < r1; r++) {
      const n = r + 1;
      if (step > 1 && n % step !== 0 && n !== 1) continue;
      ctx.fillStyle = n % board === 0 ? BOARD_LINE : n % 5 === 0 ? "#1f2328" : "#6e7781";
      const cy = y + (r - r0 + 0.5) * cell;
      ctx.textAlign = "right";
      ctx.fillText(String(n), x - gap, cy);
      ctx.textAlign = "left";
      ctx.fillText(String(n), x + W + gap, cy);
    }
  }
  ctx.restore();
}

function styleLine(ctx, kind, thin) {
  if (kind === 2) { ctx.strokeStyle = BOARD_LINE; ctx.lineWidth = thin * 3; }
  else if (kind === 1) { ctx.strokeStyle = "rgba(31,35,40,0.55)"; ctx.lineWidth = thin * 1.6; }
  else { ctx.strokeStyle = "rgba(31,35,40,0.22)"; ctx.lineWidth = thin; }
}

/** Legend layout: returns rows-per-column metrics so callers can size canvases/pages. */
export function legendMetrics(count, width, unit) {
  const colW = unit * 11;
  const perRow = Math.max(1, Math.floor(width / colW));
  const rowH = unit * 1.9;
  return { colW: width / perRow, perRow, rowH, rows: Math.ceil(count / perRow), height: Math.ceil(count / perRow) * rowH };
}

/** Draw legend items [start, end) in a grid; `unit` ~ base text size. */
export function drawLegend(ctx, items, { x, y, width, unit, start = 0, end = items.length }) {
  const m = legendMetrics(end - start, width, unit);
  ctx.save();
  ctx.textBaseline = "middle";
  for (let i = start; i < end; i++) {
    const k = i - start;
    const col = k % m.perRow, row = Math.floor(k / m.perRow);
    const ix = x + col * m.colW, iy = y + row * m.rowH;
    const it = items[i];
    const sw = unit * 1.45;
    ctx.fillStyle = it.hex;
    ctx.fillRect(ix, iy + (m.rowH - sw) / 2, sw, sw);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = unit * 0.06;
    ctx.strokeRect(ix, iy + (m.rowH - sw) / 2, sw, sw);
    ctx.fillStyle = textColorFor(it.rgb);
    ctx.textAlign = "center";
    ctx.font = `700 ${unit * 0.62}px ${FONT}`;
    ctx.fillText(it.code, ix + sw / 2, iy + m.rowH / 2);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1f2328";
    ctx.font = `700 ${unit}px ${FONT}`;
    ctx.fillText(it.code, ix + sw + unit * 0.5, iy + m.rowH / 2);
    ctx.font = `400 ${unit * 0.8}px ${FONT}`;
    ctx.fillStyle = "#57606a";
    ctx.fillText(it.name ?? "", ix + sw + unit * 3.2, iy + m.rowH / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#1f2328";
    ctx.font = `600 ${unit}px ${FONT}`;
    ctx.fillText(`×${it.count}`, ix + m.colW - unit * 0.8, iy + m.rowH / 2);
  }
  ctx.restore();
  return m.height;
}

export function summaryLines(P, info) {
  const cm = (mm) => (mm / 10).toFixed(1);
  return [
    `${info.paletteName} · ${P.cols} × ${P.rows} 颗 beads · ${cm(info.widthMm)} × ${cm(info.heightMm)} cm @ ${info.pitchMm} mm`,
    `板 Boards ${info.board}×${info.board}: ${info.boardsX} × ${info.boardsY} = ${info.boards} · ${P.legend.length} 色 colors · 合计 Total ${P.total} 颗 beads`,
  ];
}

/** Full sheet as a single canvas (used for preview and PNG export). */
export function renderSheet(P, info, { cellPx = 24, showCodes = true } = {}) {
  const unit = Math.max(12, Math.round(cellPx * 0.6));
  const pad = unit * 2.5;
  const numW = unit * 2.2;
  const gridW = P.cols * cellPx, gridH = P.rows * cellPx;
  const width = Math.max(gridW + numW * 2 + pad * 2, unit * 46);
  const headerH = unit * 4.6;
  const lm = legendMetrics(P.legend.length, width - pad * 2, unit);
  const height = pad + headerH + numW + gridH + numW + unit * 2.5 + unit * 2 + lm.height + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#1f2328";
  ctx.font = `700 ${unit * 1.35}px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText("拼豆图纸 Bead Pattern", pad, pad);
  ctx.font = `400 ${unit * 0.9}px ${FONT}`;
  ctx.fillStyle = "#57606a";
  summaryLines(P, info).forEach((l, i) => ctx.fillText(l, pad, pad + unit * 1.9 + i * unit * 1.25));

  const gx = (width - gridW) / 2;
  const gy = pad + headerH + numW;
  drawGrid(ctx, P, { x: gx, y: gy, cell: cellPx, board: info.board, showCodes, numberSize: unit * 0.8, thin: Math.max(1, cellPx * 0.04) });

  let ly = gy + gridH + numW + unit * 2.5;
  ctx.fillStyle = "#1f2328";
  ctx.font = `700 ${unit * 1.1}px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText(`色号清单 Legend — ${P.legend.length} 色 colors · 合计 Total ${P.total} 颗 beads`, pad, ly);
  drawLegend(ctx, P.legend, { x: pad, y: ly + unit * 2, width: width - pad * 2, unit });
  return canvas;
}
