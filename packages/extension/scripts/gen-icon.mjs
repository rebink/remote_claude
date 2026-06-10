// Generates the Patchwire VS Code extension icon (128×128 PNG) from the brand
// logo geometry — an open outline square + a phosphor connector dot + a filled
// square with a notch where the dot nestles — on the brand ink background.
// Dependency-free: evaluates the mark as signed-distance fields at 4× supersample
// and box-downsamples for clean anti-aliased edges, then PNG-encodes via node:zlib.
// Geometry is the canonical 24-unit mark (matches favicon.svg / the inline marks).
// Run: `node scripts/gen-icon.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = 128;
const SS = 4;            // supersample factor
const W = OUT * SS;      // 512
const LOGO = 24;         // logo viewBox units
const BOX = Math.round(W * 0.66); // logo occupies ~66% of the canvas
const SCALE = BOX / LOGO;
const OFF = (W - BOX) / 2;

const INK = [0x0e, 0x0e, 0x10];   // background
const PAPER = [0xec, 0xe7, 0xd6]; // marks
const PHOS = [0xc9, 0xf5, 0x64];  // accent dot

// ── signed-distance helpers, evaluated in LOGO units ──
const sdRoundBox = (px, py, cx, cy, hx, hy, r) => {
  const dx = Math.abs(px - cx) - hx + r;
  const dy = Math.abs(py - cy) - hy + r;
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

// outline: ring of a rounded square (center 7.5,7.5 half 4.5 r 2.5, stroke 2),
// opened at the bottom-right by subtracting the dot's disc so the right + bottom
// edges end near the connector dot.
const inOutline = (x, y) => {
  const ring = Math.abs(sdRoundBox(x, y, 7.5, 7.5, 4.5, 4.5, 2.5)) - 1.0;
  const cut = sdCircle(x, y, 12.5, 12.5, 3.0);
  return Math.max(ring, -cut) < 0;
};
// filled rounded square (center 17,17 half 4 r 2.5) with a concave notch
// carved out of its top-left corner for the dot.
const inFilled = (x, y) => {
  const box = sdRoundBox(x, y, 17, 17, 4, 4, 2.5);
  const notch = sdCircle(x, y, 13, 13, 3.0);
  return Math.max(box, -notch) < 0;
};
const inDot = (x, y) => sdCircle(x, y, 12.5, 12.5, 2.4) < 0;

// ── render at SS resolution: ink bg, then paper marks, then phosphor dot ──
const buf = new Uint8Array(W * W * 3);
for (let py = 0; py < W; py++) {
  for (let px = 0; px < W; px++) {
    const u = (px - OFF) / SCALE, v = (py - OFF) / SCALE; // pixel → logo units
    let c = INK;
    if (inOutline(u, v) || inFilled(u, v)) c = PAPER;
    if (inDot(u, v)) c = PHOS;
    const i = (py * W + px) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
}

// box-downsample SS× → OUT×OUT (RGBA)
const out = Buffer.alloc(OUT * OUT * 4);
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  let r0 = 0, g0 = 0, b0 = 0;
  for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
    const i = ((y * SS + dy) * W + (x * SS + dx)) * 3;
    r0 += buf[i]; g0 += buf[i + 1]; b0 += buf[i + 2];
  }
  const n = SS * SS, o = (y * OUT + x) * 4;
  out[o] = Math.round(r0 / n); out[o + 1] = Math.round(g0 / n); out[o + 2] = Math.round(b0 / n); out[o + 3] = 255;
}

// ── minimal PNG encoder (RGBA, filter 0) ──
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(OUT * (OUT * 4 + 1));
for (let y = 0; y < OUT; y++) { raw[y * (OUT * 4 + 1)] = 0; out.copy(raw, y * (OUT * 4 + 1) + 1, y * OUT * 4, (y + 1) * OUT * 4); }
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'media');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'icon.png'), png);
console.log(`wrote media/icon.png (${png.length} bytes, ${OUT}×${OUT})`);
