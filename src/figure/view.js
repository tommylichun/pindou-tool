import { EMPTY } from "../pattern.js";

// Canvas renderer for the hanging figure. Each part's bead plate is cached to an
// offscreen canvas at the current zoom, then drawn rotated at its rigid-body pose.

const BEAD_GAP = 0.08;

export function plateCanvas(P, pitchPx, { holes = [], outlineOnly = false } = {}) {
  const c = document.createElement("canvas");
  c.width = Math.ceil(P.cols * pitchPx) + 2;
  c.height = Math.ceil(P.rows * pitchPx) + 2;
  const ctx = c.getContext("2d");
  const g = pitchPx * BEAD_GAP;
  const rad = pitchPx * 0.28;
  for (let r = 0; r < P.rows; r++) {
    for (let col = 0; col < P.cols; col++) {
      const v = P.cells[r * P.cols + col];
      if (v === EMPTY) continue;
      const x = 1 + col * pitchPx, y = 1 + r * pitchPx;
      ctx.fillStyle = P.entries[v].hex;
      if (pitchPx >= 5) {
        ctx.beginPath();
        ctx.roundRect(x + g / 2, y + g / 2, pitchPx - g, pitchPx - g, rad);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, pitchPx + 0.5, pitchPx + 0.5);
      }
    }
  }
  if (pitchPx >= 6 && !outlineOnly) {
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    for (let r = 0; r < P.rows; r++) {
      for (let col = 0; col < P.cols; col++) {
        if (P.cells[r * P.cols + col] === EMPTY) continue;
        ctx.beginPath();
        ctx.arc(1 + (col + 0.5) * pitchPx, 1 + (r + 0.5) * pitchPx, pitchPx * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  for (const [hc, hr] of holes) {
    ctx.beginPath();
    ctx.arc(1 + (hc + 0.5) * pitchPx, 1 + (hr + 0.5) * pitchPx, pitchPx * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(1, pitchPx * 0.12);
    ctx.strokeStyle = "#1f2328";
    ctx.stroke();
  }
  return c;
}

export class FigureView {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.world = world;
    this.scale = 3; // px per mm
    this.origin = [0, 0]; // screen px of world (0,0)
    this.cache = new Map();
    this.showJoints = true;
    this.showGrid = true;
  }

  setWorld(world) { this.world = world; this.cache.clear(); }

  toWorld(sx, sy) { return [(sx - this.origin[0]) / this.scale, (sy - this.origin[1]) / this.scale]; }

  holesFor(part) {
    const holes = [part.pivotSelf];
    for (const j of this.world.joints) if (j.A.part === part && j.part) holes.push(j.part.pivotParent);
    return holes;
  }

  plate(b) {
    const dpr = window.devicePixelRatio || 1;
    const pitchPx = this.world.pitch * this.scale * dpr;
    const key = b.part.id;
    const hit = this.cache.get(key);
    if (hit && hit.pitchPx === pitchPx && hit.P === b.pattern) return hit;
    const entry = { pitchPx, P: b.pattern, canvas: plateCanvas(b.pattern, pitchPx, { holes: this.showJoints ? this.holesFor(b.part) : [] }) };
    this.cache.set(key, entry);
    return entry;
  }

  draw() {
    const { ctx, canvas, world, scale } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = canvas.width / dpr, H = canvas.height / dpr;

    if (this.showGrid) {
      const cm = 10 * scale;
      ctx.strokeStyle = "rgba(31,35,40,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = this.origin[0] % cm; x < W; x += cm) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = this.origin[1] % cm; y < H; y += cm) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.fillStyle = "#8c959f";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText("1 cm", 10 + cm / 2 - 12, H - 22);
      ctx.fillRect(10, H - 16, cm, 2);
    }

    const S = (x, y) => [this.origin[0] + x * scale, this.origin[1] + y * scale];

    // Ball chain from the hand down the links.
    const links = world.bodies.filter((b) => b.kind === "link");
    let pts = [[world.hand.x, world.hand.y]];
    for (const l of links) pts.push([l.x - Math.sin(l.a) * l.half, l.y + Math.cos(l.a) * l.half]);
    ctx.fillStyle = "#b8bec6";
    ctx.strokeStyle = "#8a929c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = S(...p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    for (let i = 0; i < pts.length - 1; i++) {
      for (let t = 0; t < 1; t += 0.34) {
        const [x, y] = S(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, 0.9 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Key ring held at the hand.
    const [hx, hy] = S(world.hand.x, world.hand.y);
    ctx.lineWidth = Math.max(2, 1.4 * scale);
    ctx.strokeStyle = "#9aa3ad";
    ctx.beginPath();
    ctx.arc(hx, hy - 9 * scale, 9 * scale, 0, Math.PI * 2);
    ctx.stroke();

    for (const b of world.partBodies) {
      const plate = this.plate(b);
      const [x, y] = S(b.x, b.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.a);
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;
      ctx.drawImage(plate.canvas, -b.com[0] * scale - 1 / dpr, -b.com[1] * scale - 1 / dpr, plate.canvas.width / dpr, plate.canvas.height / dpr);
      ctx.restore();
    }

    if (this.showJoints) {
      for (const j of world.joints) {
        if (j.connector === "chain") continue;
        const [x, y] = S(...world.jointPos(j));
        ctx.lineWidth = Math.max(1.5, 0.5 * scale);
        ctx.strokeStyle = j.connector === "rivet" ? "rgba(120,160,200,0.95)" : "#a7afb8";
        ctx.fillStyle = j.connector === "rivet" ? "rgba(220,235,250,0.6)" : "transparent";
        ctx.beginPath();
        ctx.arc(x, y, (j.connector === "rivet" ? 2.6 : 2.0) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (world.drag) {
      const d = world.drag, b = d.body;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const [ax, ay] = S(b.x + c * d.local[0] - s * d.local[1], b.y + s * d.local[0] + c * d.local[1]);
      const [tx, ty] = S(...d.target);
      ctx.strokeStyle = "rgba(239,91,91,0.8)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
