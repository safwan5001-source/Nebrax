// CUST-HV V8b — writes the synthetic photographs the slider proof paints (PNG, no dependency: zlib + a CRC table) and the
// exact per-channel min / max of their pixels (widened by a small encoding margin, like the server's evidence):
//   node scripts/slider-proof/make-pictures.mjs <dir>     →  <dir>/pics/*.png + <dir>/bounds.json
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const out = resolve(process.argv[2] ?? ".");
mkdirSync(join(out, "pics"), { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const min = [255, 255, 255], max = [0, 0, 0];
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const px = pixel(x / (w - 1), y / (h - 1), rnd).map((v) => Math.max(0, Math.min(255, Math.round(v))));
      for (let k = 0; k < 3; k++) {
        raw[y * (w * 3 + 1) + 1 + x * 3 + k] = px[k];
        if (px[k] < min[k]) min[k] = px[k];
        if (px[k] > max[k]) max[k] = px[k];
      }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { file, min, max };
}

const grain = (rnd, amp) => (rnd() - 0.5) * amp;
const PICTURES = {
  // a dusk photograph: dark teal gradient, film grain, a few bright specks (lamps) — still ≤ 90 on every channel
  dark: { w: 1200, h: 675, px: (u, v, r) => [22 + 40 * u + grain(r, 12) + (r() > 0.9993 ? 40 : 0), 34 + 30 * v + grain(r, 12), 52 + 20 * u + grain(r, 12)] },
  // a snow photograph: light everywhere
  light: { w: 1200, h: 675, px: (u, v, r) => [226 + 24 * v + grain(r, 8), 232 + 18 * u + grain(r, 8), 236 + 14 * v + grain(r, 8)] },
  // the worst case: a hard black | white split — no single text colour reads on it without a wash
  wide: { w: 1200, h: 675, px: (u, _v, r) => { const s = u < 0.5 ? 0 : 255; return [s + grain(r, 4), s + grain(r, 4), s + grain(r, 4)]; } },
  // a different crop for phones: portrait, dark blue
  phone: { w: 720, h: 900, px: (u, v, r) => [20 + 20 * v + grain(r, 10), 24 + 28 * u + grain(r, 10), 60 + 40 * v + grain(r, 10)] },
  // a second dark one so a slider does not repeat a single picture
  dark2: { w: 1200, h: 675, px: (u, v, r) => [60 + 20 * v + grain(r, 12), 30 + 24 * u + grain(r, 12), 34 + 20 * v + grain(r, 12)] },
};

const MARGIN = 4; // the evidence is widened for encoding error
const bounds = {};
for (const [name, p] of Object.entries(PICTURES)) {
  const { file, min, max } = png(p.w, p.h, p.px);
  writeFileSync(join(out, "pics", `${name}.png`), file);
  bounds[name] = { width: p.w, height: p.h, min: min.map((v) => Math.max(0, v - MARGIN)), max: max.map((v) => Math.min(255, v + MARGIN)) };
}
writeFileSync(join(out, "bounds.json"), JSON.stringify(bounds, null, 2));
console.log(JSON.stringify(bounds));
