// blur-nx-installer (2026-11-18): a title update's XEX patch (default.xexp) applied to the image of default.xex, as the
// port's runtime applies it at load (blur-nx's sdk/src/system/xex_module.cpp, XexModule::ApplyPatch, from Xenia).
// blur-nx is recompiled from Blur with title update 2, and 519 of the game's shaders are in the patched image, which the
// patch changes: the page reads them from the image the console runs. In order, as ApplyPatch does:
//   1. the base header patched: the descriptor's move, then its delta record (LZX delta: wasm/xexp, the SDK's own
//      libmspack lzxd.c and lzx.cpp's record loop);
//   2. the keys: the base's session key again from the patched header, the patch's from it (checked with the
//      descriptor's image_key_source against the base's first key);
//   3. the patch's data decrypted, then each block (SHA-1 checked) applied to the image as delta records.
// The XEX2 layout (big-endian): header_size at 8, security_offset at 16, the optional headers at 24 (key, value: an
// offset for keys whose low byte is not 0 or 1); 0x3FF the file format (encryption and compression types at +4,
// window at +8, the first block's size and SHA-1 at +12); 0x5FF the delta descriptor; the security info's image_size
// at +4 and AES key at +0x150.
import { RETAIL_KEY, decryptNoPadding, sha1 } from './xex.js';

const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const u16 = (d, o) => (d[o] << 8) | d[o + 1];

function optHeader(x, key) {
  const count = u32(x, 20);
  for (let i = 0; i < count; i++) {
    if (u32(x, 24 + 8 * i) === key) return u32(x, 28 + 8 * i);
  }
  return 0;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// xex: default.xex's bytes; image: its image (lib/xex.js readXexImage); xexp: default.xexp's bytes; mod: wasm/xexp's
// module (createXexpModule). Returns the patched image.
export async function applyXexPatch(xex, image, xexp, mod) {
  if (u32(xexp, 0) !== 0x58455832) throw new Error('default.xexp is not an XEX2 patch');
  if (!(u32(xexp, 4) & 0x60)) throw new Error('default.xexp is not a patch (no delta or full patch flag)');
  const descOff = optHeader(xexp, 0x000005ff);
  const formatOff = optHeader(xexp, 0x000003ff);
  if (!descOff || !formatOff) throw new Error('default.xexp has no delta descriptor or file format');
  const encryption = u16(xexp, formatOff + 4);
  const window = u32(xexp, formatOff + 8);
  const desc = (o) => u32(xexp, descOff + o);

  // the LZX delta records applied to dest (a Uint8Array) in the module's memory
  const applyDelta = (records, dest) => {
    const pPatch = mod._malloc(records.length);
    const pDest = mod._malloc(dest.length);
    try {
      mod.HEAPU8.set(records, pPatch);
      mod.HEAPU8.set(dest, pDest);
      const rc = mod._xexp_apply_delta(pPatch, records.length, window, pDest);
      if (rc) throw new Error(`the title update's patch did not apply (LZX error ${rc})`);
      dest.set(mod.HEAPU8.subarray(pDest, pDest + dest.length));
    } finally {
      mod._free(pPatch);
      mod._free(pDest);
    }
  };

  // 1. the header
  const baseHeaderSize = u32(xex, 8);
  const baseSec = u32(xex, 16);
  const origSession = await decryptNoPadding(xex.slice(baseSec + 0x150, baseSec + 0x160), RETAIL_KEY);
  const originalImageSize = u32(xex, baseSec + 4);
  let targetSize = desc(0x30) || desc(0x3c) + desc(0x38);
  const header = new Uint8Array(Math.max(baseHeaderSize, targetSize));
  header.set(xex.subarray(0, baseHeaderSize));
  if (desc(0x34) > baseHeaderSize || desc(0x38) > baseHeaderSize - desc(0x34)) throw new Error('header patch outside the header');
  if (desc(0x34)) header.copyWithin(desc(0x3c), desc(0x34), desc(0x34) + desc(0x38));
  if (targetSize < header.length) header.fill(0, targetSize);
  const infoLen = 0xc + u16(xexp, descOff + 0x4c + 0xa);
  applyDelta(xexp.subarray(descOff + 0x4c, descOff + 0x4c + infoLen), header);
  const patched = header.subarray(0, targetSize);

  // 2. the keys
  const sec = u32(patched, 16);
  const newImageSize = u32(patched, sec + 4);
  const baseSession = await decryptNoPadding(patched.slice(sec + 0x150, sec + 0x160), RETAIL_KEY);
  const pSec = u32(xexp, 16);
  const patchSession = await decryptNoPadding(xexp.slice(pSec + 0x150, pSec + 0x160), baseSession);
  const check = await decryptNoPadding(xexp.slice(descOff + 0x20, descOff + 0x30), baseSession);
  if (!same(check, origSession)) throw new Error('this default.xexp is not a patch of this default.xex (its image key)');

  // 3. the image
  let data = xexp.slice(u32(xexp, 8));
  if (encryption === 1) data = await decryptNoPadding(data.slice(0, data.length - (data.length % 16)), patchSession);
  else if (encryption !== 0) throw new Error('default.xexp: unsupported encryption');
  const out = new Uint8Array(Math.max(originalImageSize, newImageSize));
  out.set(image.subarray(0, Math.min(image.length, out.length)));
  if (desc(0x40)) out.copyWithin(desc(0x48), desc(0x40), desc(0x40) + desc(0x44));
  const imageTarget = desc(0x48) + desc(0x44);
  if (imageTarget < originalImageSize) out.fill(0, imageTarget, originalImageSize);
  let blockSize = u32(xexp, formatOff + 12);
  let hash = xexp.slice(formatOff + 16, formatOff + 36);
  let p = 0;
  for (let n = 0; blockSize; n++) {
    if (p + blockSize > data.length || blockSize < 24) throw new Error(`default.xexp: block ${n} outside the patch`);
    if (!same(await sha1(data.subarray(p, p + blockSize)), hash)) {
      throw new Error(`default.xexp: wrong SHA-1 in block ${n} (the wrong key, or a damaged patch)`);
    }
    const next = u32(data, p);
    const nextHash = data.slice(p + 4, p + 24);
    applyDelta(data.subarray(p + 24, p + blockSize), out);
    p += blockSize;
    blockSize = next;
    hash = nextHash;
  }
  return out.subarray(0, newImageSize);
}
