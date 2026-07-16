import fs from "node:fs";
import zlib from "node:zlib";

const outDir = new URL("../public/icons/", import.meta.url);

for (const size of [192, 512]) {
  fs.writeFileSync(new URL(`icon-${size}.png`, outDir), createIcon(size));
}

function createIcon(size) {
  const radius = size * 0.22;
  const center = size / 2;
  const circleRadius = size * 0.32;
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = 1 + x * 4;
      const rounded = insideRoundedRect(x, y, size, radius);
      const inCircle = Math.hypot(x - center, y - center) <= circleRadius;
      const inLetter = drawLetterP(x, y, size);
      const color = !rounded ? [0, 0, 0, 0] : inLetter ? [17, 18, 17, 255] : inCircle ? [182, 227, 22, 255] : [17, 18, 17, 255];
      row[index] = color[0];
      row[index + 1] = color[1];
      row[index + 2] = color[2];
      row[index + 3] = color[3];
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function insideRoundedRect(x, y, size, radius) {
  const max = size - 1;
  const cx = x < radius ? radius : x > max - radius ? max - radius : x;
  const cy = y < radius ? radius : y > max - radius ? max - radius : y;
  return Math.hypot(x - cx, y - cy) <= radius;
}

function drawLetterP(x, y, size) {
  const left = size * 0.34;
  const top = size * 0.29;
  const stemWidth = size * 0.09;
  const bowlWidth = size * 0.29;
  const bowlHeight = size * 0.23;
  const stroke = size * 0.075;
  const stem = x >= left && x <= left + stemWidth && y >= top && y <= size * 0.72;
  const bowlTop = x >= left && x <= left + bowlWidth && y >= top && y <= top + stroke;
  const bowlRight = x >= left + bowlWidth - stroke && x <= left + bowlWidth && y >= top && y <= top + bowlHeight;
  const bowlBottom = x >= left && x <= left + bowlWidth && y >= top + bowlHeight - stroke && y <= top + bowlHeight;
  return stem || bowlTop || bowlRight || bowlBottom;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pack(_format, ...values) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(values[0], 0);
  buffer.writeUInt32BE(values[1], 4);
  for (let i = 2; i < values.length; i += 1) buffer[8 + i - 2] = values[i];
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
