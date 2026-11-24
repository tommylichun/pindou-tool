// Detects images that are already clean pixel art upscaled by an integer factor
// (every same-colour run is a multiple of k). Pixel Snapper's peak-based step
// estimate is built for noisy AI art and misjudges such images, so they are
// downsampled directly instead.

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function exactPixelScale({ width, height, data }, maxK = 64) {
  const same = (i, j) =>
    data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2] && (data[i + 3] < 128) === (data[j + 3] < 128);
  let g = 0;
  const run = (n) => { g = gcd(g, n); return g === 1; };
  for (let y = 0; y < height; y++) {
    let len = 1;
    for (let x = 1; x < width; x++) {
      if (same((y * width + x) * 4, (y * width + x - 1) * 4)) len++;
      else { if (run(len)) return 1; len = 1; }
    }
    if (run(len)) return 1;
  }
  for (let x = 0; x < width; x++) {
    let len = 1;
    for (let y = 1; y < height; y++) {
      if (same((y * width + x) * 4, ((y - 1) * width + x) * 4)) len++;
      else { if (run(len)) return 1; len = 1; }
    }
    if (run(len)) return 1;
  }
  return g >= 2 && g <= maxK && width % g === 0 && height % g === 0 ? g : 1;
}

export function downsampleExact({ width, height, data }, k) {
  const w = width / k, h = height / k;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y * k) * width + x * k) * 4, d = (y * w + x) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}
