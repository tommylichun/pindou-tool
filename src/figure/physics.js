import { EMPTY } from "../pattern.js";

// Small 2D rigid-body solver (sequential impulses, Box2D-lite style) for a hanging
// articulated figure. Units: mm, seconds; y points down. Parts are rigid plates;
// joints are pins (jump rings) with an optional symmetric angle limit and friction.

const GRAVITY = 9810;
const SUBSTEPS = 8;
const ITERATIONS = 10;
const BETA = 0.05;
const POS_ITERATIONS = 4;

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const rot = (a, x, y) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
};

/** Mass properties of a bead plate from its pattern (one unit of mass per bead). */
export function massProps(P, pitch) {
  let m = 0, sx = 0, sy = 0;
  for (let r = 0; r < P.rows; r++) {
    for (let c = 0; c < P.cols; c++) {
      if (P.cells[r * P.cols + c] === EMPTY) continue;
      m++;
      sx += (c + 0.5) * pitch;
      sy += (r + 0.5) * pitch;
    }
  }
  m = Math.max(m, 1);
  const cx = sx / m, cy = sy / m;
  let I = 0;
  for (let r = 0; r < P.rows; r++) {
    for (let c = 0; c < P.cols; c++) {
      if (P.cells[r * P.cols + c] === EMPTY) continue;
      I += ((c + 0.5) * pitch - cx) ** 2 + ((r + 0.5) * pitch - cy) ** 2 + (pitch * pitch) / 6;
    }
  }
  return { mass: m, I: Math.max(I, 1), com: [cx, cy] };
}

function makeBody(props) {
  return { x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, invM: 0, invI: 0, linDamp: 0.6, angDamp: 0.9, ...props };
}

export class FigureWorld {
  /**
   * @param fig figure model
   * @param patterns Map partId -> pattern
   */
  constructor(fig, patterns, anchor = [0, 0]) {
    this.pitch = fig.pitchMm;
    this.bodies = [];
    this.joints = [];
    this.hand = makeBody({ kind: "hand", x: anchor[0], y: anchor[1] });
    this.handTarget = [...anchor];
    this.drag = null;
    this.time = 0;
    this.shakeUntil = 0;
    this.shakeAmp = 0;
    this.shakeFreq = 0;
    this.shakeOrigin = null;
    this.build(fig, patterns);
  }

  build(fig, patterns) {
    const p = this.pitch;
    const byPart = new Map();
    const root = fig.parts.find((q) => !q.parent);
    const rootProps = root ? massProps(patterns.get(root.id), p) : { mass: 100 };

    // Ball chain: a few light links between the hand and the keyring hole.
    let prev = this.hand, prevAnchor = [0, 0];
    let y = this.hand.y;
    const links = fig.chain?.links ?? 3, L = fig.chain?.linkMm ?? 7;
    const linkMass = Math.max(rootProps.mass * 0.06, 1);
    for (let i = 0; i < links; i++) {
      const b = makeBody({ kind: "link", x: this.hand.x, y: y + L / 2, invM: 1 / linkMass, invI: 1 / ((linkMass * L * L) / 12 + linkMass), half: L / 2 });
      this.bodies.push(b);
      this.joints.push(this.makeJoint(prev, b, prevAnchor, [0, -L / 2], 180, 0.05, "chain"));
      prev = b;
      prevAnchor = [0, L / 2];
      y += L;
    }

    for (const part of fig.parts) {
      const P = patterns.get(part.id);
      const mp = massProps(P, p);
      const b = makeBody({ kind: "part", part, pattern: P, com: mp.com, invM: 1 / mp.mass, invI: 1 / mp.I, z: part.z ?? 0 });
      byPart.set(part.id, b);
    }
    const local = (b, [c, r]) => [(c + 0.5) * p - b.com[0], (r + 0.5) * p - b.com[1]];

    // Lay parts out at rest: each child's hole on its parent's hole, unrotated.
    const order = [];
    const visit = (part) => {
      if (order.includes(part)) return;
      const parent = fig.parts.find((q) => q.id === part.parent);
      if (parent) visit(parent);
      order.push(part);
    };
    fig.parts.forEach(visit);
    for (const part of order) {
      const b = byPart.get(part.id);
      const ls = local(b, part.pivotSelf);
      let px, py;
      if (!part.parent) {
        const end = rot(prev.a, ...prevAnchor);
        px = prev.x + end[0];
        py = prev.y + end[1];
        this.joints.push(this.makeJoint(prev, b, prevAnchor, ls, 180, 0.02, part.connector, part));
      } else {
        const pb = byPart.get(part.parent);
        const lp = local(pb, part.pivotParent);
        const wp = rot(pb.a, ...lp);
        px = pb.x + wp[0];
        py = pb.y + wp[1];
        this.joints.push(this.makeJoint(pb, b, lp, ls, part.limit ?? 30, part.connector === "rivet" ? 0.35 : 0.12, part.connector, part));
      }
      b.x = px - ls[0];
      b.y = py - ls[1];
      this.bodies.push(b);
    }
    this.partBodies = [...byPart.values()].sort((a, b) => a.z - b.z);
  }

  makeJoint(A, B, la, lb, limitDeg, friction, connector, part = null) {
    return { A, B, la, lb, limit: (Math.min(180, limitDeg) * Math.PI) / 180, friction, connector, part, ref: B.a - A.a, acc: [0, 0], limitAcc: 0 };
  }

  shake(strength = 1) {
    this.shakeOrigin = [...this.handTarget];
    this.shakeStart = this.time;
    this.shakeUntil = this.time + 1.4;
    this.shakeAmp = 14 * strength;
    this.shakeFreq = 4.2;
  }

  setHand(x, y) {
    this.handTarget = [x, y];
    this.shakeUntil = 0;
  }

  /** Grab a part at world point (x, y); returns true if something was hit. */
  grab(x, y) {
    for (const b of [...this.partBodies].reverse()) {
      const [lx, ly] = rot(-b.a, x - b.x, y - b.y);
      const c = Math.floor((lx + b.com[0]) / this.pitch), r = Math.floor((ly + b.com[1]) / this.pitch);
      const P = b.pattern;
      if (c >= 0 && r >= 0 && c < P.cols && r < P.rows && P.cells[r * P.cols + c] !== EMPTY) {
        this.drag = { body: b, local: [lx, ly], target: [x, y] };
        return true;
      }
    }
    return false;
  }

  moveDrag(x, y) { if (this.drag) this.drag.target = [x, y]; }
  release() { this.drag = null; }

  /** Slow frames are split into ≤1/90 s chunks; larger steps blow up under a hard shake. */
  step(dt) {
    dt = Math.min(dt, 0.1);
    const n = Math.max(1, Math.ceil(dt * 90 - 1e-6));
    for (let i = 0; i < n; i++) this.advance(dt / n);
  }

  advance(dt) {
    const h = dt / SUBSTEPS;
    const start = [this.hand.x, this.hand.y];
    let target = this.handTarget;
    if (this.time < this.shakeUntil) {
      const t = this.time + dt - this.shakeStart;
      const env = Math.sin(Math.min(1, t / 0.15) * Math.PI / 2) * Math.max(0, 1 - t / 1.4);
      target = [
        this.shakeOrigin[0] + this.shakeAmp * env * Math.sin(2 * Math.PI * this.shakeFreq * t),
        this.shakeOrigin[1] + this.shakeAmp * 0.35 * env * Math.sin(2 * Math.PI * this.shakeFreq * 2 * t),
      ];
    }
    for (let s = 0; s < SUBSTEPS; s++) {
      const f = (s + 1) / SUBSTEPS;
      const nx = start[0] + (target[0] - start[0]) * f, ny = start[1] + (target[1] - start[1]) * f;
      this.hand.vx = (nx - this.hand.x) / h;
      this.hand.vy = (ny - this.hand.y) / h;
      this.hand.x = nx;
      this.hand.y = ny;
      this.substep(h);
    }
    this.hand.vx = this.hand.vy = 0;
    this.time += dt;
  }

  substep(h) {
    for (const b of this.bodies) {
      b.vy += GRAVITY * h;
      const ld = Math.exp(-b.linDamp * h), ad = Math.exp(-b.angDamp * h);
      b.vx *= ld; b.vy *= ld; b.w *= ad;
    }
    for (const j of this.joints) this.prepare(j, h);
    if (this.drag) this.prepareDrag(h);
    for (let it = 0; it < ITERATIONS; it++) {
      for (const j of this.joints) this.solve(j);
      if (this.drag) this.solveDrag();
    }
    for (const b of this.bodies) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
    }
    for (let it = 0; it < POS_ITERATIONS; it++) for (const j of this.joints) this.solvePosition(j);
  }

  /** Non-linear Gauss-Seidel position fix: removes drift without adding energy. */
  solvePosition(j) {
    const { A, B } = j;
    const [rax, ray] = rot(A.a, ...j.la), [rbx, rby] = rot(B.a, ...j.lb);
    const cx = B.x + rbx - (A.x + rax), cy = B.y + rby - (A.y + ray);
    const mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    const k11 = mA + mB + iA * ray * ray + iB * rby * rby;
    const k12 = -iA * rax * ray - iB * rbx * rby;
    const k22 = mA + mB + iA * rax * rax + iB * rbx * rbx;
    const det = k11 * k22 - k12 * k12 || 1e-9;
    const px = -(k22 * cx - k12 * cy) / det, py = -(-k12 * cx + k11 * cy) / det;
    A.x -= mA * px; A.y -= mA * py; A.a -= iA * cross(rax, ray, px, py);
    B.x += mB * px; B.y += mB * py; B.a += iB * cross(rbx, rby, px, py);
    if (j.limit < Math.PI && iA + iB > 0) {
      const rel = B.a - A.a - j.ref;
      const over = rel > j.limit ? rel - j.limit : rel < -j.limit ? rel + j.limit : 0;
      if (over) {
        const k = (over * 0.5) / (iA + iB);
        A.a += iA * k;
        B.a -= iB * k;
      }
    }
  }

  prepare(j, h) {
    const { A, B } = j;
    j.rA = rot(A.a, ...j.la);
    j.rB = rot(B.a, ...j.lb);
    const [rax, ray] = j.rA, [rbx, rby] = j.rB;
    const mA = A.invM, mB = B.invM, iA = A.invI, iB = B.invI;
    const k11 = mA + mB + iA * ray * ray + iB * rby * rby;
    const k12 = -iA * rax * ray - iB * rbx * rby;
    const k22 = mA + mB + iA * rax * rax + iB * rbx * rbx;
    const det = k11 * k22 - k12 * k12 || 1e-9;
    j.Kinv = [k22 / det, -k12 / det, k11 / det];
    const cx = B.x + rbx - (A.x + rax), cy = B.y + rby - (A.y + ray);
    j.bias = [(-BETA / h) * cx, (-BETA / h) * cy];
    j.angMass = iA + iB > 0 ? 1 / (iA + iB) : 0;
    const rel = B.a - A.a - j.ref;
    j.limitState = 0;
    if (j.limit < Math.PI) {
      if (rel > j.limit) { j.limitState = 1; j.limitBias = (-BETA / h) * (rel - j.limit); }
      else if (rel < -j.limit) { j.limitState = -1; j.limitBias = (-BETA / h) * (rel + j.limit); }
    }
    if (j.limitState === 0) j.limitAcc = 0;
    // Warm start with last substep's impulses: much better convergence on chains.
    const [wx, wy] = j.acc;
    A.vx -= A.invM * wx; A.vy -= A.invM * wy; A.w -= A.invI * cross(rax, ray, wx, wy) + A.invI * j.limitAcc;
    B.vx += B.invM * wx; B.vy += B.invM * wy; B.w += B.invI * cross(rbx, rby, wx, wy) + B.invI * j.limitAcc;
    // Friction in the ring: bleed off relative spin a little each substep.
    const relW = B.w - A.w;
    const imp = -relW * j.angMass * (1 - Math.exp(-j.friction * 60 * h));
    A.w -= A.invI * imp;
    B.w += B.invI * imp;
  }

  solve(j) {
    const { A, B } = j;
    const [rax, ray] = j.rA, [rbx, rby] = j.rB;
    if (j.limitState !== 0) {
      const relW = B.w - A.w;
      let lambda = -j.angMass * (relW - j.limitBias);
      const old = j.limitAcc;
      j.limitAcc = j.limitState > 0 ? Math.min(0, old + lambda) : Math.max(0, old + lambda);
      lambda = j.limitAcc - old;
      A.w -= A.invI * lambda;
      B.w += B.invI * lambda;
    }
    const dvx = B.vx - B.w * rby - (A.vx - A.w * ray) - j.bias[0];
    const dvy = B.vy + B.w * rbx - (A.vy + A.w * rax) - j.bias[1];
    const px = -(j.Kinv[0] * dvx + j.Kinv[1] * dvy);
    const py = -(j.Kinv[1] * dvx + j.Kinv[2] * dvy);
    j.acc[0] += px;
    j.acc[1] += py;
    A.vx -= A.invM * px; A.vy -= A.invM * py; A.w -= A.invI * cross(rax, ray, px, py);
    B.vx += B.invM * px; B.vy += B.invM * py; B.w += B.invI * cross(rbx, rby, px, py);
  }

  prepareDrag(h) {
    const d = this.drag, b = d.body;
    d.r = rot(b.a, ...d.local);
    const [rx, ry] = d.r;
    const k11 = b.invM + b.invI * ry * ry, k12 = -b.invI * rx * ry, k22 = b.invM + b.invI * rx * rx;
    const det = k11 * k22 - k12 * k12 || 1e-9;
    d.Kinv = [k22 / det, -k12 / det, k11 / det];
    const soft = 0.08;
    d.bias = [(soft / h) * (d.target[0] - (b.x + rx)), (soft / h) * (d.target[1] - (b.y + ry))];
  }

  solveDrag() {
    const d = this.drag, b = d.body;
    const [rx, ry] = d.r;
    const dvx = b.vx - b.w * ry - d.bias[0], dvy = b.vy + b.w * rx - d.bias[1];
    const px = -0.5 * (d.Kinv[0] * dvx + d.Kinv[1] * dvy), py = -0.5 * (d.Kinv[1] * dvx + d.Kinv[2] * dvy);
    b.vx += b.invM * px; b.vy += b.invM * py; b.w += b.invI * cross(rx, ry, px, py);
  }

  /** World position of a joint (midpoint of the two anchors). */
  jointPos(j) {
    const a = rot(j.A.a, ...j.la), b = rot(j.B.a, ...j.lb);
    return [(j.A.x + a[0] + j.B.x + b[0]) / 2, (j.A.y + a[1] + j.B.y + b[1]) / 2];
  }

  kineticEnergy() {
    let e = 0;
    for (const b of this.bodies) {
      if (!b.invM) continue;
      e += 0.5 * ((b.vx * b.vx + b.vy * b.vy) / b.invM + (b.w * b.w) / b.invI);
    }
    return e;
  }

  /** Largest gap between joined anchors (mm); should stay ~0 if the solver is stable. */
  maxJointError() {
    let m = 0;
    for (const j of this.joints) {
      const a = rot(j.A.a, ...j.la), b = rot(j.B.a, ...j.lb);
      m = Math.max(m, Math.hypot(j.B.x + b[0] - j.A.x - a[0], j.B.y + b[1] - j.A.y - a[1]));
    }
    return m;
  }
}
