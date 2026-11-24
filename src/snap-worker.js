import { snapImage } from "./snapper.js";

self.onmessage = (e) => {
  const { id, width, height, data, options } = e.data;
  try {
    const r = snapImage({ width, height, data }, options);
    self.postMessage({ id, ok: true, width: r.width, height: r.height, data: r.data, stepX: r.stepX }, [r.data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err.message || err) });
  }
};
