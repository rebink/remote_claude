// Generates the Patchwire VS Code extension icon (128×128 PNG) from the brand
// logo geometry — two squares joined by a dashed wire + a phosphor dot — on the
// brand ink background. Dependency-free: supersamples 4× and box-downsamples for
// clean edges, then PNG-encodes via node:zlib. Run: `node scripts/gen-icon.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = 128;
const SS = 4;            // supersample factor
const W = OUT * SS;      // 512
const LOGO = 22;         // logo viewBox units
const BOX = Math.round(W * 0.66); // logo occupies ~66% of the canvas
const SCALE = BOX / LOGO;
const OFF = (W - BOX) / 2;

const INK = [0x0e, 0x0e, 0x10];   // background
const PAPER = [0xec, 0xe7, 0xd6]; // marks
const PHOS = [0xc9, 0xf5, 0x64];  // accent dot

const buf = new Uint8Array(W * W * 3);
for (let i = 0; i < W * W; i++) { buf[i * 3] = INK[0]; buf[i * 3 + 1] = INK[1]; buf[i * 3 + 2] = INK[2]; }

const px = (u) => u * SCALE + OFF;
const set = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
};
// fill a rect given in LOGO units
const rect = (x0, y0, x1, y1, c) => {
  const ax = Math.round(px(x0)), ay = Math.round(px(y0));
  const bx = Math.round(px(x1)), by = Math.round(px(y1));
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) set(x, y, c);
};

// outline square at 0.5..9.5, stroke 1.8 centered on the path
const sw = 1.8 / 2;
rect(0.5 - sw, 0.5 - sw, 9.5 + sw, 0.5 + sw, PAPER); // top
rect(0.5 - sw, 9.5 - sw, 9.5 + sw, 9.5 + sw, PAPER); // bottom
rect(0.5 - sw, 0.5 - sw, 0.5 + sw, 9.5 + sw, PAPER); // left
rect(9.5 - sw, 0.5 - sw, 9.5 + sw, 9.5 + sw, PAPER); // right

// filled square at 12.5..21.5
rect(12.5, 12.5, 21.5, 21.5, PAPER);

// dashed wire from (6,11) to (16,11), stroke 1.4, dash 1.4 / gap 2
const ly = 11, lh = 1.4 / 2;
for (let x = 6; x < 16; x += 3.4) rect(x, ly - lh, Math.min(x + 1.4, 16), ly + lh, PAPER);

// phosphor dot at (11,11) r 1.6
const cx = px(11), cy = px(11), r = 1.6 * SCALE;
for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
  for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, PHOS);

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
