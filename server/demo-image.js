const zlib = require('zlib');
const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { tmpDir } = require('./config');

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110']
};

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function setPixel(image, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width) return;
  const offset = (y * width + x) * 4;
  if (offset < 0 || offset + 3 >= image.length) return;
  image[offset] = color[0];
  image[offset + 1] = color[1];
  image[offset + 2] = color[2];
  image[offset + 3] = color[3] ?? 255;
}

function drawText(image, width, x, y, text, color, scale = 2) {
  const chars = text.toUpperCase().slice(0, 64).split('');
  let cursor = x;
  chars.forEach((char) => {
    const pattern = FONT[char] || FONT[' '];
    pattern.forEach((row, rowIdx) => {
      row.split('').forEach((pixel, colIdx) => {
        if (pixel === '1') {
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              setPixel(image, width, cursor + colIdx * scale + sx, y + rowIdx * scale + sy, color);
            }
          }
        }
      });
    });
    cursor += 6 * scale;
  });
}

function buildPng(width, height, draw) {
  const image = Buffer.alloc(width * height * 4);
  draw(image, width, height);

  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    rawRows.push(Buffer.from([0]));
    rawRows.push(image.subarray(rowStart, rowStart + width * 4));
  }

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(Buffer.concat(rawRows), { level: 9 });
  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hashSeed(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 0x7fffffff;
  }
  return hash || 1;
}

function random(seed) {
  const next = (seed * 1103515245 + 12345) % 0x80000000;
  return [next, next / 0x80000000];
}

function promptDigest(prompt = '') {
  return (prompt || 'SMART VARIATION').toUpperCase().replace(/[^A-Z0-9 :\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'SMART VARIATION';
}

async function createDemoImage({ modeName, prompt, variantIndex, totalVariants }) {
  const width = 1280;
  const height = 768;
  const digest = promptDigest(prompt);
  const timestamp = new Date().toISOString().slice(11, 19);
  const seedBase = `${modeName}-${digest}-${variantIndex}`;
  let seed = hashSeed(seedBase);

  const buffer = buildPng(width, height, (image, w, h) => {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const gradient = x / w;
        const green = Math.floor(70 + gradient * 120);
        const blue = Math.floor(30 + (y / h) * 80);
        const red = Math.floor(18 + gradient * 40);

        [seed] = random(seed);
        const noise = (seed % 13) - 6;

        setPixel(image, w, x, y, [red + noise, green + noise, blue + noise, 255]);
      }
    }

    drawText(image, w, 56, 56, 'DRILL44 AI', [220, 255, 232, 255], 4);
    drawText(image, w, 56, 130, `${modeName.toUpperCase()}`, [165, 240, 196, 255], 2);
    drawText(image, w, 56, 170, `VARIANT ${variantIndex}/${totalVariants}`, [154, 233, 185, 255], 2);
    drawText(image, w, 56, 210, `TIME ${timestamp}`, [154, 233, 185, 255], 2);
    drawText(image, w, 56, 250, digest, [212, 255, 225, 255], 2);
  });

  const fileId = uuidv4();
  const fileName = `demo-${fileId}.png`;
  const filePath = path.join(tmpDir, fileName);
  await fs.writeFile(filePath, buffer);

  return {
    fileId,
    fileName,
    mimeType: 'image/png',
    source: 'file'
  };
}

module.exports = { createDemoImage };
