import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const size = 128;
const pixels = Buffer.alloc(size * size * 4);

function blendPixel(x, y, red, green, blue, alpha = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
  const offset = (y * size + x) * 4;
  const sourceAlpha = alpha / 255;
  const destinationAlpha = pixels[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;

  pixels[offset] = Math.round(
    (red * sourceAlpha +
      pixels[offset] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  pixels[offset + 1] = Math.round(
    (green * sourceAlpha +
      pixels[offset + 1] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  pixels[offset + 2] = Math.round(
    (blue * sourceAlpha +
      pixels[offset + 2] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  pixels[offset + 3] = Math.round(outputAlpha * 255);
}

function fillEllipse(cx, cy, radiusX, radiusY, color, feather = 1.5) {
  const [red, green, blue, opacity = 255] = color;
  const minX = Math.floor(cx - radiusX - feather);
  const maxX = Math.ceil(cx + radiusX + feather);
  const minY = Math.floor(cy - radiusY - feather);
  const maxY = Math.ceil(cy + radiusY + feather);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x + 0.5 - cx) / radiusX;
      const dy = (y + 0.5 - cy) / radiusY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 1 + feather / Math.max(radiusX, radiusY)) continue;
      const coverage = Math.max(
        0,
        Math.min(
          1,
          (1 - distance) * (Math.max(radiusX, radiusY) / feather) + 1,
        ),
      );
      blendPixel(x, y, red, green, blue, Math.round(opacity * coverage));
    }
  }
}

fillEllipse(68, 76, 49, 28, [0, 0, 0, 78], 3);
fillEllipse(64, 66, 51, 51, [91, 48, 10, 255], 2);
fillEllipse(64, 61, 45, 45, [255, 207, 60, 255], 2);
fillEllipse(64, 61, 36, 36, [230, 159, 35, 255], 1.5);
fillEllipse(64, 58, 31, 31, [255, 218, 74, 255], 1.5);
fillEllipse(49, 43, 11, 8, [255, 248, 190, 218], 2.5);
fillEllipse(45, 39, 5, 4, [255, 255, 238, 245], 1.5);

for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
  const x = 64 + Math.cos(angle) * 39;
  const y = 61 + Math.sin(angle) * 39;
  fillEllipse(x, y, 2.2, 2.2, [117, 66, 13, 180], 1);
}

const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  const rowOffset = y * (size * 4 + 1);
  raw[rowOffset] = 0;
  pixels.copy(raw, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync("public/game/textures/coin.png", png);
