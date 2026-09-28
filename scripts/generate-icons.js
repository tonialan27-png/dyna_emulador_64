import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPng(width, height, drawFn) {
  // RGBA buffer
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const color = drawFn(x, y, width, height);
      buffer[idx] = color[0];
      buffer[idx + 1] = color[1];
      buffer[idx + 2] = color[2];
      buffer[idx + 3] = color[3];
    }
  }

  // Scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0; // Filter None
    buffer.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(scanlines);

  // PNG Header
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([typeBuf, data]);
    const crc = crc32(crcBuf);
    const crcOut = Buffer.alloc(4);
    crcOut.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcOut]);
  }

  // CRC32 table
  function crc32(buf) {
    let c = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      c = (c ^ buf[n]);
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Icon design: Retro NES gamepad / cartridge in deep crimson & slate
function retroIconDraw(isMaskable) {
  return (x, y, w, h) => {
    const nx = x / w;
    const ny = y / h;

    // Background: dark slate gradient
    let bgR = 26, bgG = 26, bgB = 36, bgA = 255;

    // Center cart/controller safe zone
    const pad = isMaskable ? 0.15 : 0.08;
    if (nx >= pad && nx <= 1 - pad && ny >= pad && ny <= 1 - pad) {
      // Inner card
      const cx = (nx - 0.5) / (0.5 - pad);
      const cy = (ny - 0.5) / (0.5 - pad);
      const dist = Math.sqrt(cx * cx + cy * cy);
      
      // Retro cartridge body
      if (Math.abs(cx) < 0.85 && Math.abs(cy) < 0.7) {
        // Red header banner
        if (cy < -0.3) {
          return [235, 35, 35, 255]; // Dyna red
        }
        // Cartridge body (dark charcoal)
        if (Math.abs(cx) < 0.75 && Math.abs(cy) < 0.55) {
          // Controller D-Pad or buttons
          if (cx < -0.2 && Math.abs(cx - -0.4) < 0.25 && Math.abs(cy - 0.1) < 0.25) {
            // D-Pad cross
            const dx = Math.abs(cx - -0.4);
            const dy = Math.abs(cy - 0.1);
            if ((dx < 0.07 && dy < 0.2) || (dy < 0.07 && dx < 0.2)) {
              return [240, 240, 240, 255];
            }
          }
          // Red Action Buttons A & B
          if (cx > 0.1) {
            const b1 = Math.sqrt(Math.pow(cx - 0.32, 2) + Math.pow(cy - 0.12, 2));
            const b2 = Math.sqrt(Math.pow(cx - 0.52, 2) + Math.pow(cy - 0.02, 2));
            if (b1 < 0.09 || b2 < 0.09) {
              return [255, 59, 59, 255];
            }
          }
          return [45, 45, 55, 255];
        }
        return [30, 30, 40, 255];
      }
    }
    return [bgR, bgG, bgB, bgA];
  };
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPng(192, 192, retroIconDraw(false)));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPng(512, 512, retroIconDraw(false)));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPng(512, 512, retroIconDraw(true)));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPng(180, 180, retroIconDraw(false)));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), createPng(64, 64, retroIconDraw(false)));

console.log('PWA icons successfully generated in /public!');
