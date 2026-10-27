import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const bg = [42, 36, 30, 255];
const sand = [231, 201, 160, 255];
const ink = [42, 36, 30, 255];

function create(w, h) {
  const data = new Uint8Array(w * h * 4);
  return {
    w,
    h,
    data,
    fill(r, g, b, a = 255) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      }
    },
    set(x, y, r, g, b, a = 255) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
      const i = (y * w + x) * 4;
      const src = a / 255;
      const dst = data[i + 3] / 255;
      const out = src + dst * (1 - src);
      data[i] = (r * src + data[i] * dst * (1 - src)) / out;
      data[i + 1] = (g * src + data[i + 1] * dst * (1 - src)) / out;
      data[i + 2] = (b * src + data[i + 2] * dst * (1 - src)) / out;
      data[i + 3] = out * 255;
    },
    circle(cx, cy, rad, color) {
      const [r, g, b, a] = color;
      const minX = Math.floor(cx - rad - 1);
      const maxX = Math.ceil(cx + rad + 1);
      const minY = Math.floor(cy - rad - 1);
      const maxY = Math.ceil(cy + rad + 1);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const edge = rad - dist;
          if (edge <= 0) continue;
          this.set(x, y, r, g, b, Math.min(a, edge * 255));
        }
      }
    },
    rect(x, y, rw, rh, color) {
      const [r, g, b, a] = color;
      for (let yy = Math.floor(y); yy < y + rh; yy += 1) {
        for (let xx = Math.floor(x); xx < x + rw; xx += 1) this.set(xx, yy, r, g, b, a);
      }
    },
  };
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(canvas) {
  const raw = Buffer.alloc(canvas.h * (1 + canvas.w * 4));
  for (let y = 0; y < canvas.h; y += 1) {
    const row = y * (1 + canvas.w * 4);
    raw[row] = 0;
    Buffer.from(canvas.data.buffer, canvas.data.byteOffset + y * canvas.w * 4, canvas.w * 4).copy(raw, row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.w, 0);
  ihdr.writeUInt32BE(canvas.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mark(size, maskable) {
  const canvas = create(size, size);
  canvas.fill(...bg);
  const radius = size * (maskable ? 0.16 : 0.2);
  canvas.circle(size / 2, size * 0.46, radius, sand);
  const lineW = size * 0.28;
  const lineH = Math.max(2, size * 0.025);
  canvas.rect((size - lineW) / 2, size * 0.7, lineW, lineH, sand);
  canvas.circle(size * 0.36, size * 0.7 + lineH / 2, lineH / 2, sand);
  canvas.circle(size * 0.64, size * 0.7 + lineH / 2, lineH / 2, sand);
  return canvas;
}

function plus(size) {
  const canvas = create(size, size);
  canvas.fill(...bg);
  const t = Math.max(6, size * 0.1);
  const len = size * 0.42;
  canvas.rect((size - len) / 2, (size - t) / 2, len, t, sand);
  canvas.rect((size - t) / 2, (size - len) / 2, t, len, sand);
  canvas.circle(size / 2, (size - len) / 2, t / 2, sand);
  canvas.circle(size / 2, (size + len) / 2, t / 2, sand);
  canvas.circle((size - len) / 2, size / 2, t / 2, sand);
  canvas.circle((size + len) / 2, size / 2, t / 2, sand);
  return canvas;
}

function mic(size) {
  const canvas = create(size, size);
  canvas.fill(...bg);
  canvas.circle(size / 2, size * 0.4, size * 0.16, sand);
  canvas.circle(size / 2, size * 0.4, size * 0.08, ink);
  const stem = Math.max(4, size * 0.045);
  canvas.rect(size / 2 - stem / 2, size * 0.52, stem, size * 0.16, sand);
  canvas.rect(size * 0.34, size * 0.66, size * 0.32, stem, sand);
  return canvas;
}

const out = path.resolve("public/icons");
fs.mkdirSync(out, { recursive: true });
const files = [
  ["icon-32.png", mark(32, false)],
  ["icon-192.png", mark(192, false)],
  ["icon-512.png", mark(512, false)],
  ["icon-maskable-192.png", mark(192, true)],
  ["icon-maskable-512.png", mark(512, true)],
  ["shortcut-add.png", plus(96)],
  ["shortcut-speak.png", mic(96)],
];
for (const [name, canvas] of files) fs.writeFileSync(path.join(out, name), png(canvas));
console.log(files.map(([name]) => name).join("\n"));
