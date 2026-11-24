# 拼豆图纸生成器 · Bead Pattern Maker

A static, in-browser tool that turns an AI-generated "fake pixel" image into a printable
拼豆 / fuse-bead (Perler, Hama, Artkal, MARD…) pattern.

1. **Grid snapping**: a JavaScript port of [Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper)
   (MIT) detects the implicit pixel grid of AI pixel art and resamples each cell to one clean pixel.
2. **Bead colour mapping**: every pixel maps to the nearest bead colour using CIEDE2000 in CIE Lab.
   The default palette is **MARD 221** (standard A–H + M series). You can exclude single colours or whole
   series, cap the colour count (the least-used colours fold into their nearest neighbours), and remove a
   solid background.
3. **Physical sizing**: choose the bead pitch (2.6 mm mini, 5 mm standard, or custom). Keep the snapped grid,
   or fit it to a maximum width/height in cm or in beads. The tool shows the finished size and how many
   pegboards you need (29×29, 52×52, 50×50, 26×26, or custom).
4. **Template output**: the pattern shows a colour code in every cell, board boundary lines, a line every
   5 beads, and row/column numbers. The legend lists swatch, code, name and count per colour, plus the total.
   Export as PNG, a fit-to-page A4 PDF, or a **1:1 real-scale A4 PDF** with one page per pegboard and a
   50 mm calibration ruler.

Everything runs locally in the browser. There is no build step and nothing is uploaded.

## Run

The app loads palettes with `fetch` and uses an ES-module worker, so serve it over HTTP instead of opening
the file directly:

```bash
cd bead-pattern
python3 -m http.server 8080
# open http://localhost:8080
```

Any static file server works (`npx serve .` and so on). Click **载入示例 Load sample** to try the bundled AI
image in `samples/`.

To print the 1:1 PDF, choose **Actual size / 100%** in the print dialog (not "Fit to page"), then check the
50 mm ruler at the bottom of each board page.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/styles.css`, `src/app.js` | UI and wiring |
| `src/snapper.js`, `src/snap-worker.js` | Pixel Snapper port (runs in a Web Worker) |
| `src/color.js` | sRGB → Lab, CIEDE2000 |
| `src/pattern.js` | palette mapping, resampling, background removal, colour limit, sizing and board maths |
| `src/render.js`, `src/pdf.js` | template drawing (unit-agnostic), PNG and PDF export |
| `palettes/` | palette data files + `index.json` registry |
| `scripts/build-palette.py`, `scripts/sources/` | raw palette sources and the generator |
| `vendor/jspdf.umd.min.js` | jsPDF 2.5.2 (MIT) |

## Palettes

| File | Colours | Source |
| --- | --- | --- |
| `palettes/mard-221.json` (default) | 221 | [HansBug/pindou-color-data `mard-221-alfonse-doudou`](https://github.com/HansBug/pindou-color-data/tree/main/mard-221-alfonse-doudou) (MIT), checked against that repo's `mard-221-github` set (same 221 codes; 3 colours differ by more than 24/255 in one channel). Chinese names come from the pindoupic MARD chart. |
| `palettes/mard-264.json` | 264 | [pindoupic MARD 264色全套装](https://www.pindoupic.com/seka/264) (adds the P/Q/R/T/Y extension series) |

Hex values are screen approximations of physical beads, and public charts disagree by a few units.

**Adding a brand** (Artkal, Perler, Hama…): create `palettes/<id>.json` with this shape and register it in
`palettes/index.json`:

```json
{
  "id": "perler-standard", "brand": "Perler",
  "name": { "zh": "Perler 标准色", "en": "Perler standard" },
  "source": "https://…",
  "series": { "P": { "zh": "标准", "en": "Standard" } },
  "colors": [ { "code": "P01", "hex": "#F1F1F1", "name": "White", "series": "P" } ]
}
```

Run `python3 scripts/build-palette.py` to regenerate the MARD files from `scripts/sources/`.

## Snapper port notes

`src/snapper.js` follows `src/lib.rs` v1.0.0 step for step: k-means++ quantisation, gradient profiles,
peak-based step estimate, elastic walker, two-axis stabilisation, and mode resampling. The one difference is
the k-means seeding RNG (mulberry32 instead of ChaCha8). On identical decoded input, the port produced the
same grid size as the Rust CLI (74×72 for the bundled sample, 189×115 for the upstream `details.png`), with
97–99 % of pixels within 12/255.

## Licenses

MIT. See `LICENSE` and `THIRD_PARTY_LICENSES.md`.
