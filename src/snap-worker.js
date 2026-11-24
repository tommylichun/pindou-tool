import { snapImage } from "./snapper.js";
import { exactPixelScale, downsampleExact } from "./exact-scale.js";

self.onmessage = (e) => {
  const { id, width, height, data, options } = e.data;
  try {
    const img = { width, height, data };
    const k = options?.pixelSizeOverride ? 1 : exactPixelScale(img);
    const r = k > 1 ? { ...downsampleExact(img, k), stepX: k } : snapImage(img, options);
    self.postMessage({ id, ok: true, width: r.width, height: r.height, data: r.data, stepX: r.stepX }, [r.data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err.message || err) });
  }
};
