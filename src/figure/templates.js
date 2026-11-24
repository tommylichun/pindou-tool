import { newPart, PITCH_MM } from "./model.js";

// Starter figures modelled on real articulated keychains. Pivots are bead cells
// [col, row] (0-based); each child hangs with its pivotSelf hole on the parent's pivotParent hole.
export const TEMPLATES = {
  squirrel: {
    label: "小飞鼠 Flying squirrel",
    build: () => ({
      name: "flying-squirrel",
      pitchMm: PITCH_MM,
      chain: { links: 3, linkMm: 7 },
      parts: [
        newPart({ id: "head", kind: "head", w: 36, h: 32, shape: "ears", color: "#ffffff", z: 4, parent: null, pivotSelf: [18, 8], limit: 180, connector: "jump-ring" }),
        newPart({ id: "body", kind: "body", w: 26, h: 28, shape: "roundrect", color: "#f5f5f5", z: 2, parent: "head", pivotParent: [18, 28], pivotSelf: [13, 2], limit: 22, connector: "rivet" }),
        newPart({ id: "armL", kind: "armL", w: 13, h: 5, shape: "capsule", color: "#f5f5f5", z: 3, parent: "body", pivotParent: [2, 7], pivotSelf: [11, 2], limit: 55 }),
        newPart({ id: "armR", kind: "armR", w: 13, h: 5, shape: "capsule", color: "#f5f5f5", z: 3, parent: "body", pivotParent: [23, 7], pivotSelf: [1, 2], limit: 55 }),
        newPart({ id: "tail", kind: "tail", w: 22, h: 30, shape: "oval", color: "#aecbef", z: 1, parent: "body", pivotParent: [13, 25], pivotSelf: [11, 2], limit: 35, connector: "rivet" }),
      ],
    }),
  },
  cat: {
    label: "小黑猫 Black cat",
    build: () => ({
      name: "black-cat",
      pitchMm: PITCH_MM,
      chain: { links: 3, linkMm: 7 },
      parts: [
        newPart({ id: "head", kind: "head", w: 44, h: 30, shape: "ears", color: "#48464e", z: 4, parent: null, pivotSelf: [22, 8], limit: 180 }),
        newPart({ id: "body", kind: "body", w: 22, h: 16, shape: "roundrect", color: "#2f2b2f", z: 2, parent: "head", pivotParent: [22, 27], pivotSelf: [11, 1], limit: 18, connector: "rivet" }),
        newPart({ id: "legL", kind: "legL", w: 7, h: 14, shape: "capsule", color: "#2f2b2f", z: 3, parent: "body", pivotParent: [6, 13], pivotSelf: [3, 1], limit: 30 }),
        newPart({ id: "legR", kind: "legR", w: 7, h: 14, shape: "capsule", color: "#2f2b2f", z: 3, parent: "body", pivotParent: [15, 13], pivotSelf: [3, 1], limit: 30 }),
        newPart({ id: "tail", kind: "tail", w: 7, h: 24, shape: "capsule", color: "#2f2b2f", z: 1, parent: "body", pivotParent: [19, 11], pivotSelf: [3, 1], limit: 45 }),
      ],
    }),
  },
  chibi: {
    label: "Q版小人 Chibi person",
    build: () => ({
      name: "chibi",
      pitchMm: PITCH_MM,
      chain: { links: 3, linkMm: 7 },
      parts: [
        newPart({ id: "head", kind: "head", w: 32, h: 30, shape: "oval", color: "#ffe2ce", z: 4, parent: null, pivotSelf: [16, 1], limit: 180 }),
        newPart({ id: "body", kind: "body", w: 22, h: 24, shape: "roundrect", color: "#3677d2", z: 2, parent: "head", pivotParent: [16, 28], pivotSelf: [11, 1], limit: 20, connector: "rivet" }),
        newPart({ id: "armL", kind: "armL", w: 6, h: 15, shape: "capsule", color: "#ffe2ce", z: 3, parent: "body", pivotParent: [1, 4], pivotSelf: [3, 1], limit: 45 }),
        newPart({ id: "armR", kind: "armR", w: 6, h: 15, shape: "capsule", color: "#ffe2ce", z: 3, parent: "body", pivotParent: [20, 4], pivotSelf: [2, 1], limit: 45 }),
        newPart({ id: "legL", kind: "legL", w: 7, h: 14, shape: "capsule", color: "#1c334d", z: 1, parent: "body", pivotParent: [6, 22], pivotSelf: [3, 1], limit: 25 }),
        newPart({ id: "legR", kind: "legR", w: 7, h: 14, shape: "capsule", color: "#1c334d", z: 1, parent: "body", pivotParent: [15, 22], pivotSelf: [3, 1], limit: 25 }),
      ],
    }),
  },
};
