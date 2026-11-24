// culdcept-nx-installer (2026-11-20, the user: re-encode the game's audio to Opus, music at 128 kbit/s): one of the
// game's XMA files NAME as NAME.xmo, the port's XMA file with Opus in its frames (culdcept-nx's
// sdk/include/rex/filesystem/xmo.h has the format; the port synthesizes NAME from it and its XMA emulation plays each
// frame from the Opus). Used by lib/audio.js (the browser: WebCodecs' Opus encoder) and test/audio_node.mjs (a PC:
// ffmpeg's libopus).
//   1. the XMA file's packets and frames walked, and its frames decoded in order, by wasm/xma (FFmpeg's xmaframes
//      decoder, the port's own): frame k is samples [512 k, 512 k + 512) of the sound;
//   2. those samples encoded as Opus, 20 ms packets at 48 kHz;
//   3. the .xmo written: the XMA file's RIFF header, packet headers, frame table and trailer, and the Opus packets.
// A file is kept as XMA (why says why) when it is not one the port can play this way: not 48 kHz, a packet without room
// for its tag, or more than one stream.

export const XMO_SUFFIX = '.xmo';
const TAG_BITS = 16 + 32 + 24;  // a packet's tag: magic, sound id, packet index
const SAMPLES_PER_FRAME = 512;
const PACKET_SAMPLES = 960;
const XMA_ERRORS = {
  '-1': 'not a RIFF WAVE file', '-2': 'no fmt or data chunk', '-3': 'not XMA1', '-4': 'more than one stream',
  '-5': 'not mono or stereo', '-6': 'its data is not whole packets', '-7': 'the XMA decoder did not open',
  '-8': 'a frame runs past the data', '-9': 'out of memory', '-10': 'a frame did not decode',
  '-11': 'a frame is not 512 samples',
};

// The sound id the tags name: CRC-32 of the file's path in the game folder, lowercased with '/' separators (the
// installer makes the ids of one game unique: soundIds).
export function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; ++i) {
    c ^= bytes[i];
    for (let k = 0; k < 8; ++k) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
export function soundIds(paths) {
  const ids = new Map(), used = new Set();
  for (const p of [...paths].sort()) {
    let id = crc32(new TextEncoder().encode(p.toLowerCase().replace(/\\/g, '/')));
    while (used.has(id) || id === 0) id = (id + 1) >>> 0;
    used.add(id);
    ids.set(p, id);
  }
  return ids;
}

// An Opus packet's samples at 48 kHz (RFC 6716 3.1: the TOC byte's configuration and frame count).
export function opusPacketSamples(p) {
  if (!p.length) return 0;
  const config = p[0] >> 3, code = p[0] & 3;
  const size = config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1]
    : [120, 240, 480, 960][config & 3];
  const frames = code === 0 ? 1 : code < 3 ? 2 : (p.length > 1 ? p[1] & 0x3f : 0);
  return size * frames;
}

// The XMA file walked by wasm/xma (`xma`, an instance of it): { info } or { why }. The module holds the file until
// close(); decode(count) gives the next frames' samples (interleaved floats).
export function openXma(xma, bytes) {
  const file = xma._xma_malloc(bytes.length);
  xma.HEAPU8.set(bytes, file);
  const r = xma._xma_open(file, bytes.length);
  const close = () => { xma._xma_close(); xma._xma_free(file); };
  if (r < 0) {
    const why = XMA_ERRORS[String(r)] || `error ${r}`;
    close();
    return { why };
  }
  const info = {
    dataOffset: xma._xma_info(0), packets: xma._xma_info(1), frames: xma._xma_info(2), rate: xma._xma_info(3),
    channels: xma._xma_info(4), trailer: xma._xma_info(5), mismatches: xma._xma_info(6), tagRoom: xma._xma_info(8),
  };
  const tablePtr = xma._xma_frames();
  info.table = xma.HEAPU8.slice(tablePtr, tablePtr + info.frames * 8);
  let out = 0, outFrames = 0;
  const decode = (count) => {
    if (count > outFrames) {
      if (out) xma._xma_free(out);
      out = xma._xma_malloc(count * SAMPLES_PER_FRAME * info.channels * 4);
      outFrames = count;
    }
    const n = xma._xma_decode(count, out);
    if (n < 0) throw new Error(`${XMA_ERRORS[String(n)] || `error ${n}`} (frame ${xma._xma_info(7)})`);
    return new Float32Array(xma.HEAPU8.buffer, out, n * SAMPLES_PER_FRAME * info.channels).slice();
  };
  return {
    info, decode,
    close: () => { if (out) xma._xma_free(out); out = 0; close(); },
  };
}

// Whether the port can play this file from Opus (null) or why not.
export function xmoRefusal(info) {
  if (info.rate !== 48000) return `${info.rate} Hz (Opus is 48 kHz: kept as XMA)`;
  if (!info.frames) return 'no frames';
  if (info.packets >= 1 << 24) return 'too many packets';
  if (info.tagRoom < TAG_BITS) return `a packet with room for ${info.tagRoom} tag bits (${TAG_BITS} needed)`;
  if (info.mismatches) return `${info.mismatches} frames end where the next packet does not start its first one`;
  return null;
}

// The .xmo file: `xma` the XMA file's bytes, `info` openXma's, `opus` { packets: Uint8Array[], preSkip }.
export function writeXmo(xma, info, id, opus) {
  const { packets, preSkip } = opus;
  for (let i = 0; i < packets.length; ++i) {
    if (packets[i].length > 0xffff) throw new Error(`Opus packet ${i} is ${packets[i].length} bytes`);
    if (opusPacketSamples(packets[i]) !== PACKET_SAMPLES) throw new Error(`Opus packet ${i} is not 20 ms`);
  }
  const need = preSkip + info.frames * SAMPLES_PER_FRAME;
  if (packets.length * PACKET_SAMPLES < need) throw new Error(`the Opus stream is short (${packets.length} packets)`);
  const head = 64, riff = info.dataOffset, heads = info.packets * 4, table = info.frames * 8, trailer = info.trailer;
  const tableAt = head + riff + heads + table + trailer;
  const opusBytes = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(tableAt + packets.length * 2 + opusBytes);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode('RXXMAOP1'), 0);
  v.setUint32(8, 1, true);
  v.setUint32(12, id, true);
  v.setBigUint64(16, BigInt(xma.length), true);
  v.setUint32(24, info.dataOffset, true);
  v.setUint32(28, info.packets, true);
  v.setUint32(32, info.frames, true);
  v.setUint32(36, 48000, true);
  v.setUint16(40, info.channels, true);
  v.setUint16(42, preSkip, true);
  v.setUint32(44, packets.length, true);
  v.setBigUint64(48, BigInt(tableAt), true);
  v.setUint32(56, trailer, true);
  let at = head;
  out.set(xma.subarray(0, riff), at);
  at += riff;
  for (let p = 0; p < info.packets; ++p, at += 4) out.set(xma.subarray(riff + p * 2048, riff + p * 2048 + 4), at);
  out.set(info.table, at);
  at += table;
  out.set(xma.subarray(xma.length - trailer), at);
  at += trailer;
  for (const p of packets) { v.setUint16(at, p.length, true); at += 2; }
  for (const p of packets) { out.set(p, at); at += p.length; }
  return out;
}

// The Opus bitrate for a file: the first of `rules` ({ match (a RegExp source), stereo, mono }) whose match the path
// fits.
export function xmoBitrate(rules, path, channels) {
  const r = rules.find((x) => new RegExp(`^(?:${x.match})$`, 'i').test(path));
  return r ? (channels === 2 ? r.stereo : r.mono) : null;
}
