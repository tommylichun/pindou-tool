import { newPart, MAX_BEADS, PITCH_MM, PART_KINDS, SHAPES, serializeFigure } from "./model.js";
import { TEMPLATES } from "./templates.js";

// Rule-based "AI design" helper: turns a short zh/en description into part sizes
// and joint positions using chibi keychain proportions.
//
// Pluggable LLM hook: assign `window.figureDesignLLM = async (description, context) => figureJson`
// where figureJson follows serializeFigure()'s shape. When present and enabled in the UI,
// it is tried first and the rule-based result is the fallback.

const SPECIES = [
  { key: "squirrel", re: /松鼠|飞鼠|鼯鼠|squirrel/i, color: "#ffffff", tail: "big", ears: true, arms: true, legs: false },
  { key: "cat", re: /猫|喵|cat|kitty/i, color: "#48464e", tail: "thin", ears: true, arms: false, legs: true },
  { key: "dog", re: /狗|犬|柴|dog|puppy|shiba/i, color: "#feac4c", tail: "curl", ears: true, arms: true, legs: true },
  { key: "rabbit", re: /兔|rabbit|bunny/i, color: "#ffffff", tail: "pom", ears: "long", arms: true, legs: true },
  { key: "bear", re: /熊|bear/i, color: "#9d5b3e", tail: "pom", ears: true, arms: true, legs: true },
  { key: "fox", re: /狐|fox/i, color: "#f77c31", tail: "big", ears: true, arms: true, legs: false },
  { key: "bird", re: /鸟|鸡|鸭|企鹅|bird|chick|duck|penguin/i, color: "#fbed56", tail: "none", ears: false, arms: "wings", legs: true },
  { key: "person", re: /人|女孩|男孩|小孩|girl|boy|person|kid|chibi/i, color: "#ffe2ce", tail: "none", ears: false, arms: true, legs: true },
];

const COLORS = [
  [/黑|black/i, "#2f2b2f"], [/白|white/i, "#ffffff"], [/灰|gr[ae]y/i, "#89858c"], [/橙|橘|orange/i, "#feac4c"],
  [/黄|yellow/i, "#fbed56"], [/粉|pink/i, "#fec0df"], [/红|red/i, "#f74941"], [/蓝|blue/i, "#7cc4ff"],
  [/绿|green/i, "#9ef780"], [/紫|purple/i, "#ac7bde"], [/棕|咖啡|brown/i, "#9d5b3e"],
];

export function parseDescription(text) {
  const t = text || "";
  const sp = SPECIES.find((s) => s.re.test(t)) || SPECIES.find((s) => s.key === "person");
  const color = (COLORS.find(([re]) => re.test(t)) || [null, sp.color])[1];
  const no = (re) => new RegExp(`(没有|无|不要|不带|no|without)\\s*(${re.source})`, "i").test(t);
  const cmMatch = t.match(/(\d+(?:\.\d+)?)\s*(cm|厘米|公分)/i);
  const headCm = /头/.test(t.slice(Math.max(0, (cmMatch?.index ?? 0) - 4), cmMatch?.index ?? 0)) || /head/i.test(t) ? cmMatch && parseFloat(cmMatch[1]) : null;
  return {
    species: sp.key,
    color,
    accent: COLORS.filter(([re]) => re.test(t)).map((c) => c[1])[1] || null,
    tail: no(/尾巴?|tail/) ? "none" : /长尾|long tail|大尾巴|big tail/i.test(t) ? "big" : sp.tail,
    ears: sp.ears,
    arms: no(/手|手臂|arms?/) ? false : /手|arm/i.test(t) ? (sp.arms || true) : sp.arms,
    legs: no(/腿|脚|legs?/) ? false : /腿|脚|leg/i.test(t) ? true : sp.legs,
    bigHead: /大头|big head|q版|chibi/i.test(t) || sp.key !== "person",
    headCm: headCm || null,
    totalCm: !headCm && cmMatch ? parseFloat(cmMatch[1]) : null,
  };
}

const B = (cm) => Math.round((cm * 10) / PITCH_MM);
const cap = (v) => Math.max(3, Math.min(MAX_BEADS, Math.round(v)));

export function designFromParams(p) {
  // Head width drives everything; the default reads well on a keychain (~9 cm).
  let headW = p.headCm ? B(p.headCm) : 36;
  const estimateTotal = (hw) => hw * (p.bigHead ? 0.9 : 1) + hw * 0.75 + (p.tail !== "none" ? hw * 0.6 : p.legs ? hw * 0.35 : 0);
  if (p.totalCm) headW = Math.round(headW * Math.min(2, B(p.totalCm) / estimateTotal(headW)));
  headW = cap(headW);

  const headH = cap(headW * (p.ears === "long" ? 1.25 : p.bigHead ? 0.88 : 1));
  const bodyW = cap(headW * (p.bigHead ? 0.68 : 0.8));
  const bodyH = cap(headW * (p.bigHead ? 0.72 : 0.9));
  const parts = [];
  const head = newPart({
    id: "head", kind: "head", w: headW, h: headH, shape: p.ears ? "ears" : "oval", color: p.color, z: 4,
    parent: null, limit: 180,
    pivotSelf: [Math.floor(headW / 2), p.ears ? Math.ceil(headH * 0.22) + 1 : 1],
  });
  parts.push(head);
  const body = newPart({
    id: "body", kind: "body", w: bodyW, h: bodyH, shape: "roundrect", color: p.accent || p.color, z: 2,
    parent: "head", pivotParent: [Math.floor(headW / 2), headH - 4], pivotSelf: [Math.floor(bodyW / 2), 2],
    limit: 20, connector: "rivet",
  });
  parts.push(body);

  if (p.arms) {
    const wings = p.arms === "wings";
    const aw = cap(wings ? bodyW * 0.35 : bodyW * 0.5), ah = cap(wings ? bodyH * 0.55 : Math.max(5, bodyW * 0.2));
    const row = Math.round(bodyH * 0.25);
    parts.push(newPart({ id: "armL", kind: wings ? "wing" : "armL", label: wings ? "左翅 Left wing" : "", w: aw, h: ah, shape: "capsule", color: p.color, z: 3, parent: "body", pivotParent: [2, row], pivotSelf: [aw - 2, Math.floor(ah / 2)], limit: 55 }));
    parts.push(newPart({ id: "armR", kind: wings ? "wing" : "armR", label: wings ? "右翅 Right wing" : "", w: aw, h: ah, shape: "capsule", color: p.color, z: 3, parent: "body", pivotParent: [bodyW - 3, row], pivotSelf: [1, Math.floor(ah / 2)], limit: 55 }));
  }
  if (p.legs) {
    const lw = cap(Math.max(5, bodyW * 0.3)), lh = cap(bodyH * 0.55);
    parts.push(newPart({ id: "legL", kind: "legL", w: lw, h: lh, shape: "capsule", color: p.accent || p.color, z: 1, parent: "body", pivotParent: [Math.round(bodyW * 0.28), bodyH - 3], pivotSelf: [Math.floor(lw / 2), 1], limit: 25 }));
    parts.push(newPart({ id: "legR", kind: "legR", w: lw, h: lh, shape: "capsule", color: p.accent || p.color, z: 1, parent: "body", pivotParent: [Math.round(bodyW * 0.72), bodyH - 3], pivotSelf: [Math.floor(lw / 2), 1], limit: 25 }));
  }
  if (p.tail !== "none") {
    const dims = { big: [0.85, 1.15, "oval"], thin: [0.3, 1.1, "capsule"], curl: [0.55, 0.7, "oval"], pom: [0.4, 0.4, "oval"] }[p.tail] || [0.6, 0.9, "oval"];
    const tw = cap(bodyW * dims[0]), th = cap(bodyH * dims[1]);
    const offset = p.tail === "thin" || p.tail === "curl" ? 0.78 : 0.5;
    parts.push(newPart({ id: "tail", kind: "tail", w: tw, h: th, shape: dims[2], color: p.tail === "big" && p.accent ? p.accent : p.color, z: 0, parent: "body", pivotParent: [Math.round(bodyW * offset), bodyH - 4], pivotSelf: [Math.floor(tw / 2), 2], limit: p.tail === "thin" ? 45 : 35, connector: p.tail === "big" ? "rivet" : "jump-ring" }));
  }
  return { name: p.species, pitchMm: PITCH_MM, chain: { links: 3, linkMm: 7 }, parts };
}

export async function designFigure(text, { useLLM = true } = {}) {
  if (useLLM && typeof window !== "undefined" && typeof window.figureDesignLLM === "function") {
    try {
      const json = await window.figureDesignLLM(text, {
        partKinds: Object.keys(PART_KINDS), shapes: Object.keys(SHAPES), maxBeads: MAX_BEADS, pitchMm: PITCH_MM,
        example: serializeFigure(TEMPLATES.squirrel.build()),
      });
      if (json?.parts?.length) return { source: "llm", json };
    } catch (err) {
      console.warn("figureDesignLLM failed, using rules", err);
    }
  }
  const params = parseDescription(text);
  return { source: "rules", params, figure: designFromParams(params) };
}
