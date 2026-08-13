/* =========================================================
   Photobooth+ — minimal, dependency-free animated GIF encoder
   Pure JS, no external libraries, works fully offline.

   Trade-off by design: instead of an adaptive palette (NeuQuant/
   median-cut), this uses a fixed 256-color cube (8 levels of red,
   8 of green, 4 of blue — eyes are least sensitive to blue) so
   encoding is a single fast pass over pixels with no palette
   search. Photos come out slightly posterized but this keeps the
   whole thing small, fast, and simple to reason about.
   ========================================================= */
(function (root) {
  "use strict";

  // ---- Fixed palette ----------------------------------------------------
  function buildFixedPalette() {
    const palette = new Uint8Array(256 * 3);
    for (let k = 0; k < 256; k++) {
      const ri = (k >> 5) & 7;
      const gi = (k >> 2) & 7;
      const bi = k & 3;
      palette[k * 3 + 0] = Math.round((ri * 255) / 7);
      palette[k * 3 + 1] = Math.round((gi * 255) / 7);
      palette[k * 3 + 2] = Math.round((bi * 255) / 3);
    }
    return palette;
  }

  // rgba: Uint8ClampedArray/Uint8Array of length width*height*4
  function quantizeFrame(rgba, width, height) {
    const out = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const ri = (r >> 5) & 7;
      const gi = (g >> 5) & 7;
      const bi = (b >> 6) & 3;
      out[p] = (ri << 5) | (gi << 2) | bi;
    }
    return out;
  }

  // ---- LZW (GIF-flavoured, variable code width) --------------------------
  function lzwEncode(pixels, minCodeSize) {
    const clearCode = 1 << minCodeSize; // 256
    const eoiCode = clearCode + 1;      // 257
    let codeSize = minCodeSize + 1;     // starts at 9
    let nextCode = eoiCode + 1;         // 258
    let dict;

    const bytes = [];
    let bitBuffer = 0;
    let bitCount = 0;

    function emit(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        bytes.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    }

    function resetDict() {
      dict = new Map();
      for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }

    resetDict();
    emit(clearCode);

    let w = String.fromCharCode(pixels[0]);
    for (let i = 1; i < pixels.length; i++) {
      const k = String.fromCharCode(pixels[i]);
      const wk = w + k;
      if (dict.has(wk)) {
        w = wk;
        continue;
      }
      emit(dict.get(w));
      if (nextCode < 4096) {
        dict.set(wk, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        resetDict();
      }
      w = k;
    }
    emit(dict.get(w));
    emit(eoiCode);
    if (bitCount > 0) bytes.push(bitBuffer & 0xff);

    return bytes;
  }

  // ---- GIF container ------------------------------------------------------
  // frames: array of { indices: Uint8Array(width*height), delayCs: number }
  function encodeGIF({ width, height, palette, frames, loop = 0 }) {
    const out = [];
    const push = (...b) => { for (const x of b) out.push(x & 0xff); };
    const pushU16 = (v) => push(v & 0xff, (v >> 8) & 0xff);
    const pushStr = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
    const pushBytes = (arr) => { for (let i = 0; i < arr.length; i++) out.push(arr[i]); };

    pushStr("GIF89a");
    pushU16(width);
    pushU16(height);
    push(0xf7); // global color table, 8-bit color resolution, 256 entries
    push(0x00); // background color index
    push(0x00); // pixel aspect ratio
    pushBytes(palette);

    // NETSCAPE2.0 application extension → loop count (0 = forever)
    push(0x21, 0xff, 0x0b);
    pushStr("NETSCAPE2.0");
    push(0x03, 0x01);
    pushU16(loop);
    push(0x00);

    for (const frame of frames) {
      // Graphic Control Extension
      push(0x21, 0xf9, 0x04);
      push(0x04); // disposal = do not dispose, no transparency
      pushU16(Math.max(2, Math.round(frame.delayCs)));
      push(0x00); // transparent color index (unused)
      push(0x00); // block terminator

      // Image Descriptor
      push(0x2c);
      pushU16(0); pushU16(0);
      pushU16(width); pushU16(height);
      push(0x00); // no local color table, not interlaced

      const minCodeSize = 8;
      push(minCodeSize);
      const compressed = lzwEncode(frame.indices, minCodeSize);
      let idx = 0;
      while (idx < compressed.length) {
        const chunk = compressed.slice(idx, idx + 255);
        push(chunk.length);
        pushBytes(chunk);
        idx += 255;
      }
      push(0x00); // block terminator
    }

    push(0x3b); // trailer
    return new Uint8Array(out);
  }

  const api = { buildFixedPalette, quantizeFrame, encodeGIF };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PhotoboothGIF = api;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
