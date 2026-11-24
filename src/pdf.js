import { drawGrid, drawLegend, legendMetrics, summaryLines, FONT } from "./render.js";

// Pages are drawn on a canvas in millimetres and placed at exact page size, so
// CJK text works without embedding fonts and 1:1 pages keep their real scale.
export const PX_PER_MM = 10;
export const PAGE = { w: 210, h: 297 };
export const M = 10;

export function newPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w * PX_PER_MM;
  canvas.height = PAGE.h * PX_PER_MM;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(PX_PER_MM, PX_PER_MM);
  return { canvas, ctx };
}

export function header(ctx, title, lines) {
  ctx.fillStyle = "#1f2328";
  ctx.textBaseline = "top";
  ctx.font = `700 5px ${FONT}`;
  ctx.fillText(title, M, M);
  ctx.font = `400 3px ${FONT}`;
  ctx.fillStyle = "#57606a";
  lines.forEach((l, i) => ctx.fillText(l, M, M + 7 + i * 4.2));
  return M + 7 + lines.length * 4.2 + 2;
}

export function footer(ctx, text, page) {
  ctx.font = `400 2.6px ${FONT}`;
  ctx.fillStyle = "#8c959f";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText(text, M, PAGE.h - 5);
  ctx.textAlign = "right";
  ctx.fillText(`${page}`, PAGE.w - M, PAGE.h - 5);
  ctx.textAlign = "left";
}

/** 50 mm calibration ruler: check it with a real ruler after printing at 100%. */
export function ruler(ctx, x, y) {
  ctx.strokeStyle = "#1f2328";
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + 50, y);
  for (let i = 0; i <= 50; i += 5) { ctx.moveTo(x + i, y); ctx.lineTo(x + i, y - (i % 10 === 0 ? 2.5 : 1.3)); }
  ctx.stroke();
  ctx.font = `400 2.4px ${FONT}`;
  ctx.fillStyle = "#1f2328";
  ctx.textBaseline = "top";
  ctx.fillText("50 mm — 打印请选「实际大小 / 100%」Print at Actual size / 100%", x, y + 1);
}

function fitGrid(ctx, P, info, top, bottom) {
  const lab = 6;
  const availW = PAGE.w - 2 * M - 2 * lab, availH = bottom - top - 2 * lab;
  const cell = Math.min(availW / P.cols, availH / P.rows);
  const gw = cell * P.cols, gh = cell * P.rows;
  const x = (PAGE.w - gw) / 2, y = top + lab;
  drawGrid(ctx, P, { x, y, cell, board: info.board, showCodes: cell >= 2.2, numberSize: Math.min(2.4, cell * 0.9), thin: Math.min(0.1, cell * 0.04) });
  return { x, y, cell, gh };
}

function legendPages(P, info, pages, title) {
  const unit = 3.2;
  const width = PAGE.w - 2 * M;
  let i = 0;
  while (i < P.legend.length) {
    const { canvas, ctx } = newPage();
    const top = header(ctx, title, [`色号清单 Legend — ${P.legend.length} 色 colors · 合计 Total ${P.total} 颗 beads`]);
    const m = legendMetrics(P.legend.length, width, unit);
    const rowsFit = Math.floor((PAGE.h - top - 14) / m.rowH);
    const end = Math.min(P.legend.length, i + rowsFit * m.perRow);
    drawLegend(ctx, P.legend, { x: M, y: top + 2, width, unit, start: i, end });
    pages.push(canvas);
    i = end;
  }
}

/**
 * mode "fit": overview scaled to one A4 page + legend.
 * mode "real": overview + one 1:1 page per pegboard (split further if a board
 * is larger than the printable area) + legend.
 */
export async function exportPdf(P, info, mode, filename) {
  const { jsPDF } = window.jspdf;
  const pages = [];
  const title = "拼豆图纸 Bead Pattern";
  const lines = summaryLines(P, info);

  {
    const { canvas, ctx } = newPage();
    const top = header(ctx, title, lines);
    const lm = legendMetrics(P.legend.length, PAGE.w - 2 * M, 3.2);
    const legendOnPage = mode === "fit" && lm.height < 90;
    const bottom = legendOnPage ? PAGE.h - 18 - lm.height - 8 : PAGE.h - 16;
    const g = fitGrid(ctx, P, info, top, bottom);
    if (legendOnPage) {
      const ly = g.y + g.gh + 9;
      ctx.font = `700 3.4px ${FONT}`;
      ctx.fillStyle = "#1f2328";
      ctx.textBaseline = "top";
      ctx.fillText(`色号清单 Legend — 合计 Total ${P.total} 颗 beads`, M, ly);
      drawLegend(ctx, P.legend, { x: M, y: ly + 5, width: PAGE.w - 2 * M, unit: 3.2 });
    }
    pages.push(canvas);
    if (!legendOnPage && mode === "fit") legendPages(P, info, pages, title);
  }

  if (mode === "real") {
    const pitch = info.pitchMm;
    const lab = 5;
    const top0 = M + 16;
    const maxCols = Math.floor((PAGE.w - 2 * M - 2 * lab) / pitch);
    const maxRows = Math.floor((PAGE.h - top0 - 22 - 2 * lab) / pitch);
    for (let br = 0; br < info.boardsY; br++) {
      for (let bc = 0; bc < info.boardsX; bc++) {
        const bc0 = bc * info.board, bc1 = Math.min(P.cols, bc0 + info.board);
        const br0 = br * info.board, br1 = Math.min(P.rows, br0 + info.board);
        for (let r0 = br0; r0 < br1; r0 += maxRows) {
          for (let c0 = bc0; c0 < bc1; c0 += maxCols) {
            const c1 = Math.min(bc1, c0 + maxCols), r1 = Math.min(br1, r0 + maxRows);
            const { canvas, ctx } = newPage();
            const split = bc1 - bc0 > maxCols || br1 - br0 > maxRows;
            header(ctx, `板 Board ${br + 1}-${bc + 1}${split ? " (部分 part)" : ""} · 1:1`, [
              `列 Cols ${c0 + 1}–${c1} · 行 Rows ${r0 + 1}–${r1} · 豆径 Bead pitch ${pitch} mm · ${info.paletteName}`,
            ]);
            const x = (PAGE.w - (c1 - c0) * pitch) / 2;
            drawGrid(ctx, P, { x, y: top0 + lab, cell: pitch, c0, c1, r0, r1, board: info.board, numberSize: Math.min(2.4, pitch * 0.7), thin: 0.08 });
            ruler(ctx, M, PAGE.h - 16);
            pages.push(canvas);
          }
        }
      }
    }
    legendPages(P, info, pages, title);
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pages.forEach((canvas, i) => {
    if (i > 0) doc.addPage("a4", "portrait");
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(PX_PER_MM, PX_PER_MM);
    footer(ctx, `${filename} · ${mode === "real" ? "1:1 实际尺寸 real scale" : "适应页面 fit to page"}`, `${i + 1} / ${pages.length}`);
    doc.addImage(canvas, "PNG", 0, 0, PAGE.w, PAGE.h, undefined, "FAST");
  });
  doc.save(`${filename}-${mode === "real" ? "1to1" : "fit"}.pdf`);
  return pages.length;
}
