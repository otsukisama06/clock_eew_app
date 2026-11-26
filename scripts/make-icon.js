// build/icon.png (インストーラー・実行ファイル用のアイコン) を作る
// src/main.js の makeIcon と同じ絵柄 (黒い丸に金の縁と時計の針) を 512px で描く
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const size = 512;
const rgba = Buffer.alloc(size * size * 4);
const c = (size - 1) / 2, r = size / 2 - 8, rim = size * 0.07, hw = size * 0.035;
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const d = Math.hypot(x - c, y - c);
  const i = (y * size + x) * 4;
  // 縁をなめらかにする
  const a = Math.max(0, Math.min(1, r - d + 0.5));
  let col = d > r - rim ? [255, 215, 95] : [16, 16, 16];
  const hand1 = Math.abs(x - c) < hw && y < c + hw && y > c - r * 0.6;
  const hand2 = Math.abs(y - c) < hw && x > c - hw && x < c + r * 0.45;
  if (d <= r - rim && (hand1 || hand2)) col = [255, 255, 255];
  rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = Math.round(a * 255);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let v = n;
  for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  return v >>> 0;
});
const crc32 = (buf) => {
  let v = 0xffffffff;
  for (const b of buf) v = crcTable[(v ^ b) & 0xff] ^ (v >>> 8);
  return (v ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out);
