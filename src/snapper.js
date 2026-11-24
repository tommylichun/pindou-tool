// JavaScript port of Sprite Fusion Pixel Snapper (src/lib.rs, v1.0.0)
// https://github.com/Hugo-Dz/spritefusion-pixel-snapper
// Copyright (c) 2025 Hugo Duprez — MIT License (see THIRD_PARTY_LICENSES.md).
//
// Pipeline (unchanged from the original): k-means quantize -> gradient
// profiles per axis -> estimate grid step from profile peaks -> elastic
// "walker" places cuts on strong edges -> cross-axis stabilization ->
// resample each cell to its most frequent color.
//
// The only intentional difference: the k-means seeding RNG is mulberry32 instead
// of ChaCha8, so cluster colors can differ marginally from the Rust build.

export const DEFAULT_CONFIG = Object.freeze({
  kColors: 16,
  kSeed: 42,
  maxKmeansIterations: 15,
  peakThresholdMultiplier: 0.2,
  peakDistanceFilter: 4,
  walkerSearchWindowRatio: 0.35,
  walkerMinSearchWindow: 2.0,
  walkerStrengthThreshold: 0.5,
  minCutsPerAxis: 4,
  fallbackTargetSegments: 64,
  maxStepRatio: 1.8,
  pixelSizeOverride: null,
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {ImageData|{width:number,height:number,data:Uint8ClampedArray}} img
 * @returns {{width:number,height:number,data:Uint8ClampedArray,stepX:number,stepY:number,colCuts:number[],rowCuts:number[]}}
 */
export function snapImage(img, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { width, height } = img;
  if (width === 0 || height === 0) throw new Error("Image dimensions cannot be zero");
  if (width > 10000 || height > 10000) throw new Error("Image dimensions too large (max 10000x10000)");
  const px = config.pixelSizeOverride;
  if (px != null) {
    if (!Number.isFinite(px) || px < 1 || px > Math.min(width, height) / 2) {
      throw new Error(`pixel size ${px} is out of valid range [1, ${Math.floor(Math.min(width, height) / 2)}]`);
    }
  }

  const analysis = quantizeImage(img, config);
  const [profileX, profileY] = computeProfiles(analysis);
  const sx = estimateStepSize(profileX, config);
  const sy = estimateStepSize(profileY, config);
  const [stepX, stepY] = resolveStepSizes(sx, sy, width, height, config);

  const rawCol = walk(profileX, stepX, width, config);
  const rawRow = walk(profileY, stepY, height, config);
  const [colCuts, rowCuts] = stabilizeBothAxes(profileX, profileY, rawCol, rawRow, width, height, config);
  const out = resample(analysis, colCuts, rowCuts);
  return { ...out, stepX, stepY, colCuts, rowCuts };
}

function quantizeImage(img, config) {
  const { width, height, data } = img;
  if (config.kColors <= 0) throw new Error("Number of colors must be greater than 0");

  const n = width * height;
  let nOpaque = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] !== 0) nOpaque++;
  const out = new Uint8ClampedArray(data);
  if (nOpaque === 0) return { width, height, data: out };

  const pts = new Float32Array(nOpaque * 3);
  for (let i = 0, j = 0; i < n; i++) {
    if (data[i * 4 + 3] === 0) continue;
    pts[j++] = data[i * 4];
    pts[j++] = data[i * 4 + 1];
    pts[j++] = data[i * 4 + 2];
  }

  const rng = mulberry32(config.kSeed);
  const k = Math.min(config.kColors, nOpaque);
  const sampleIndex = (upper) => Math.min(upper - 1, Math.floor(rng() * upper));
  const distSq = (a, ai, b, bi) => {
    const dr = a[ai] - b[bi], dg = a[ai + 1] - b[bi + 1], db = a[ai + 2] - b[bi + 2];
    return dr * dr + dg * dg + db * db;
  };

  // k-means++ seeding
  const cent = new Float32Array(k * 3);
  let first = sampleIndex(nOpaque);
  cent.set(pts.subarray(first * 3, first * 3 + 3), 0);
  const dists = new Float32Array(nOpaque).fill(Number.MAX_VALUE);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    const li = (c - 1) * 3;
    for (let i = 0; i < nOpaque; i++) {
      const d = distSq(pts, i * 3, cent, li);
      if (d < dists[i]) dists[i] = d;
      sum += dists[i];
    }
    let idx;
    if (sum <= 0) {
      idx = sampleIndex(nOpaque);
    } else {
      let r = rng() * sum;
      idx = nOpaque - 1;
      for (let i = 0; i < nOpaque; i++) {
        r -= dists[i];
        if (r < 0) { idx = i; break; }
      }
    }
    cent.set(pts.subarray(idx * 3, idx * 3 + 3), c * 3);
  }

  const prev = new Float32Array(cent);
  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);
  for (let it = 0; it < config.maxKmeansIterations; it++) {
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < nOpaque; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = distSq(pts, i * 3, cent, c * 3);
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best * 3] += pts[i * 3];
      sums[best * 3 + 1] += pts[i * 3 + 1];
      sums[best * 3 + 2] += pts[i * 3 + 2];
      counts[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        cent[c * 3] = sums[c * 3] / counts[c];
        cent[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        cent[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
    if (it > 0) {
      let maxMove = 0;
      for (let c = 0; c < k; c++) maxMove = Math.max(maxMove, distSq(cent, c * 3, prev, c * 3));
      if (maxMove < 0.01) break;
    }
    prev.set(cent);
  }

  const rounded = Array.from(cent, (v) => Math.round(v));
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue;
    let best = 0, bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = data[o] - cent[c * 3], dg = data[o + 1] - cent[c * 3 + 1], db = data[o + 2] - cent[c * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    out[o] = rounded[best * 3];
    out[o + 1] = rounded[best * 3 + 1];
    out[o + 2] = rounded[best * 3 + 2];
  }
  return { width, height, data: out };
}

function computeProfiles(img) {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) throw new Error("Image too small (minimum 3x3)");
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    gray[i] = data[o + 3] === 0 ? 0 : 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  const col = new Float64Array(w);
  const row = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) col[x] += Math.abs(gray[y * w + x + 1] - gray[y * w + x - 1]);
  }
  for (let x = 0; x < w; x++) {
    for (let y = 1; y < h - 1; y++) row[y] += Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
  }
  return [col, row];
}

function estimateStepSize(profile, config) {
  if (profile.length === 0) return null;
  let maxVal = -Infinity;
  for (const v of profile) if (v > maxVal) maxVal = v;
  if (maxVal === 0) return null;
  const threshold = maxVal * config.peakThresholdMultiplier;
  const peaks = [];
  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] > threshold && profile[i] > profile[i - 1] && profile[i] > profile[i + 1]) peaks.push(i);
  }
  if (peaks.length < 2) return null;
  const clean = [peaks[0]];
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i] - clean[clean.length - 1] > config.peakDistanceFilter - 1) clean.push(peaks[i]);
  }
  if (clean.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < clean.length; i++) diffs.push(clean[i] - clean[i - 1]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function resolveStepSizes(sx, sy, width, height, config) {
  if (config.pixelSizeOverride != null) return [config.pixelSizeOverride, config.pixelSizeOverride];
  if (sx != null && sy != null) {
    const ratio = sx > sy ? sx / sy : sy / sx;
    if (ratio > config.maxStepRatio) {
      const s = Math.min(sx, sy);
      return [s, s];
    }
    const avg = (sx + sy) / 2;
    return [avg, avg];
  }
  if (sx != null) return [sx, sx];
  if (sy != null) return [sy, sy];
  const fb = Math.max(1, Math.min(width, height) / config.fallbackTargetSegments);
  return [fb, fb];
}

function stabilizeBothAxes(profileX, profileY, rawCol, rawRow, width, height, config) {
  const col1 = stabilizeCuts(profileX, rawCol.slice(), width, rawRow, height, config);
  const row1 = stabilizeCuts(profileY, rawRow.slice(), height, rawCol, width, config);
  const colCells = Math.max(1, col1.length - 1);
  const rowCells = Math.max(1, row1.length - 1);
  const colStep = width / colCells;
  const rowStep = height / rowCells;
  const ratio = colStep > rowStep ? colStep / rowStep : rowStep / colStep;
  if (ratio > config.maxStepRatio) {
    const target = Math.min(colStep, rowStep);
    const c = colStep > target * 1.2 ? snapUniformCuts(profileX, width, target, config, config.minCutsPerAxis) : col1;
    const r = rowStep > target * 1.2 ? snapUniformCuts(profileY, height, target, config, config.minCutsPerAxis) : row1;
    return [c, r];
  }
  return [col1, row1];
}

function walk(profile, stepSize, limit, config) {
  if (profile.length === 0) throw new Error("Cannot walk on empty profile");
  const cuts = [0];
  let pos = 0;
  const window = Math.max(stepSize * config.walkerSearchWindowRatio, config.walkerMinSearchWindow);
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= profile.length;

  while (pos < limit) {
    const target = pos + stepSize;
    if (target >= limit) {
      cuts.push(limit);
      break;
    }
    const start = Math.max(Math.trunc(Math.max(0, target - window)), Math.trunc(pos + 1));
    const end = Math.min(Math.trunc(target + window), limit);
    if (end <= start) {
      pos = target;
      continue;
    }
    let maxVal = -1, maxIdx = start;
    for (let i = start; i < end && i < profile.length; i++) {
      if (profile[i] > maxVal) { maxVal = profile[i]; maxIdx = i; }
    }
    if (maxVal > mean * config.walkerStrengthThreshold) {
      cuts.push(maxIdx);
      pos = maxIdx;
    } else {
      cuts.push(Math.trunc(target));
      pos = target;
    }
  }
  return cuts;
}

function stabilizeCuts(profile, cuts, limit, siblingCuts, siblingLimit, config) {
  if (limit === 0) return [0];
  cuts = sanitizeCuts(cuts, limit);
  const minRequired = Math.min(Math.max(config.minCutsPerAxis, 2), limit + 1);
  const axisCells = Math.max(0, cuts.length - 1);
  const siblingCells = Math.max(0, siblingCuts.length - 1);
  const siblingHasGrid = siblingLimit > 0 && siblingCells >= Math.max(0, minRequired - 1) && siblingCells > 0;
  let skewed = false;
  if (siblingHasGrid && axisCells > 0) {
    const r = (limit / axisCells) / (siblingLimit / siblingCells);
    skewed = r > config.maxStepRatio || r < 1 / config.maxStepRatio;
  }
  if (cuts.length >= minRequired && !skewed) return cuts;

  let target;
  if (siblingHasGrid) target = siblingLimit / siblingCells;
  else if (config.fallbackTargetSegments > 1) target = limit / config.fallbackTargetSegments;
  else if (axisCells > 0) target = limit / axisCells;
  else target = limit;
  if (!Number.isFinite(target) || target <= 0) target = 1;
  return snapUniformCuts(profile, limit, target, config, minRequired);
}

function sanitizeCuts(cuts, limit) {
  if (limit === 0) return [0];
  const set = new Set(cuts.map((v) => (v >= limit ? limit : v)));
  set.add(0);
  set.add(limit);
  return [...set].sort((a, b) => a - b);
}

function snapUniformCuts(profile, limit, targetStep, config, minRequired) {
  if (limit === 0) return [0];
  if (limit === 1) return [0, 1];
  let desired = Number.isFinite(targetStep) && targetStep > 0 ? Math.round(limit / targetStep) : 0;
  desired = Math.min(Math.max(desired, minRequired - 1, 1), limit);
  const cellW = limit / desired;
  const window = Math.max(cellW * config.walkerSearchWindowRatio, config.walkerMinSearchWindow);
  let mean = 0;
  for (const v of profile) mean += v;
  mean = profile.length ? mean / profile.length : 0;

  const cuts = [0];
  for (let idx = 1; idx < desired; idx++) {
    const target = cellW * idx;
    const prev = cuts[cuts.length - 1];
    if (prev + 1 >= limit) break;
    let start = Math.max(Math.floor(target - window), prev + 1, 0);
    let end = Math.min(Math.ceil(target + window), limit - 1);
    if (end < start) {
      start = prev + 1;
      end = start;
    }
    const last = Math.max(0, profile.length - 1);
    let bestIdx = Math.min(start, last);
    let bestVal = -1;
    for (let i = start; i <= Math.min(end, last); i++) {
      const v = profile[i] ?? 0;
      if (v > bestVal) { bestVal = v; bestIdx = i; }
    }
    if (bestVal < mean * config.walkerStrengthThreshold) {
      let fb = Math.round(target);
      if (fb <= prev) fb = prev + 1;
      if (fb >= limit) fb = Math.max(limit - 1, prev + 1);
      bestIdx = fb;
    }
    cuts.push(bestIdx);
  }
  if (cuts[cuts.length - 1] !== limit) cuts.push(limit);
  return sanitizeCuts(cuts, limit);
}

function resample(img, cols, rows) {
  if (cols.length < 2 || rows.length < 2) throw new Error("Insufficient grid cuts for resampling");
  const { width: w, height: h, data } = img;
  const outW = cols.length - 1;
  const outH = rows.length - 1;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const counts = new Map();
  for (let yi = 0; yi < outH; yi++) {
    const ys = rows[yi], ye = rows[yi + 1];
    for (let xi = 0; xi < outW; xi++) {
      const xs = cols[xi], xe = cols[xi + 1];
      if (xe <= xs || ye <= ys) continue;
      counts.clear();
      for (let y = ys; y < ye && y < h; y++) {
        for (let x = xs; x < xe && x < w; x++) {
          const o = (y * w + x) * 4;
          // Big-endian RGBA key so numeric order == lexicographic [u8;4] order (Rust tie-break).
          const key = ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
      let bestKey = 0, bestCount = -1;
      for (const [key, c] of counts) {
        if (c > bestCount || (c === bestCount && key < bestKey)) { bestCount = c; bestKey = key; }
      }
      const o = (yi * outW + xi) * 4;
      out[o] = (bestKey >>> 24) & 255;
      out[o + 1] = (bestKey >>> 16) & 255;
      out[o + 2] = (bestKey >>> 8) & 255;
      out[o + 3] = bestKey & 255;
    }
  }
  return { width: outW, height: outH, data: out };
}
