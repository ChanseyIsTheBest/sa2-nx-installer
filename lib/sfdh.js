// rr6-nx-installer (2026-11-21, the user: "rencoding ... videos as h.265 copy what culdcept saga does"): one of the game's
// Sofdec movies (.sfd: an MPEG-1 program stream, MPEG-1 video and ADX audio) as NAME.hevc, the movie with its pictures
// as H.265 (rr6-nx's sdk/include/rex/filesystem/sfd_hevc.h has the format, app/src/cpu/rr6_hevc_movies.cpp plays it on
// the Switch's NVDEC; tools/hevc_sfd_pack.py makes the same with ffmpeg). As culdcept-nx-installer's lib/movies.js does
// for its WMV movies (credit culdcept-nx):
//   1. the SFD's video stream read out of its packs (every other byte kept as it is);
//   2. each picture decoded (wasm/mpeg1: FFmpeg's MPEG-1 decoder; out in display order) and encoded by the browser's
//      H.265 encoder (WebCodecs, the computer's video hardware) at `fraction` of the movie's own video bitrate, a keyframe
//      every `gop` frames, one picture out per picture in, no reordering;
//   3. NAME.hevc written: the SFD's bytes but each picture's slice data (a slice header, a 10-byte tag, zeros), and the
//      H.265 frames, each led by an access unit delimiter.
// Returns { bytes: null, why } (the SFD is kept as it is) when the browser has no H.265 encoder or something does not fit.
const MAGIC = 'RXSFDH01';
const TAG_BYTES = 10;
const QUANT_BYTE = 0x08;  // quantiser_scale 1, extra_bit_slice 0
const AUD = new Uint8Array([0, 0, 0, 1, 0x46, 0x01, 0x50]);  // an H.265 access unit delimiter

export function hevcConfig(width, height, kbps, fps) {
  return {
    codec: 'hvc1.1.6.L120.B0',  // Main profile, level 4
    width, height,
    bitrate: Math.round(kbps * 1000),
    bitrateMode: 'variable',
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    hevc: { format: 'annexb' },
  };
}

export async function canEncodeHevc() {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return !!(await VideoEncoder.isConfigSupported(hevcConfig(1280, 720, 1500, 30))).supported;
  } catch {
    return false;
  }
}

// ---- the program stream ------------------------------------------------------------------------------------------

// The video ES and where its bytes lie: { es: Uint8Array, runs: [[esOffset, fileOffset, length], ...] }.
export function demux(d) {
  const n = d.length;
  const runs = [], pts = [];  // pts: [esOffset, PTS in 90 kHz ticks] of each video packet that has one
  let total = 0, i = 0;
  while (i + 4 <= n) {
    if (!(d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1)) { i++; continue; }
    const sid = d[i + 3];
    if (sid === 0xBA) { i += (d[i + 4] >> 6) === 1 ? 14 + (d[i + 13] & 7) : 12; continue; }
    if (sid === 0xB9 || sid < 0xBB) { i += 4; continue; }
    const ln = ((d[i + 4] << 8) | d[i + 5]) + 6;
    if (sid >= 0xE0 && sid <= 0xEF) {
      let p = i + 6;
      while (d[p] === 0xFF) p++;
      if ((d[p] >> 6) === 1) p += 2;
      const f = d[p] >> 4;
      if (f === 2 || f === 3) {
        const t = ((d[p] >> 1) & 7) * 1073741824 + ((d[p + 1] << 7) | (d[p + 2] >> 1)) * 32768 +
                  ((d[p + 3] << 7) | (d[p + 4] >> 1));
        pts.push([total, t]);
      }
      if (f === 2) p += 5;
      else if (f === 3) p += 10;
      else if (d[p] === 0x0F) p += 1;
      else throw new Error(`a video packet header at ${i} this installer does not read`);
      if (i + ln > p) { runs.push([total, p, i + ln - p]); total += i + ln - p; }
    }
    i += ln;
  }
  const es = new Uint8Array(total);
  for (const [e, f, l] of runs) es.set(d.subarray(f, f + l), e);
  return { es, runs, pts };
}

// The coded pictures: [{ s0 (first slice start code), end (end of its slices), disp (display index) }].
export function pictures(es) {
  const pics = [];
  let gopBase = 0, inGop = 0, cur = null;
  for (let p = 0; p + 3 < es.length; p++) {
    if (es[p] !== 0 || es[p + 1] !== 0 || es[p + 2] !== 1) continue;
    const c = es[p + 3];
    if (c === 0x00) {
      if (cur && cur.s0 !== null && cur.end === null) cur.end = p;
      const tref = (es[p + 4] << 2) | (es[p + 5] >> 6);
      cur = { at: p, tref, base: gopBase, s0: null, end: null };
      pics.push(cur);
      inGop++;
    } else if (c >= 0x01 && c <= 0xAF) {
      if (cur && cur.s0 === null) cur.s0 = p;
    } else {
      if (cur && cur.s0 !== null && cur.end === null) cur.end = p;
      if (c === 0xB8) { gopBase += inGop; inGop = 0; }
    }
    p += 2;
  }
  if (cur && cur.s0 !== null && cur.end === null) cur.end = es.length;
  // sa2-nx-ult-installer (2026-11-21): a picture's display index is its rank among the display times (GOP base +
  // temporal reference): three of SA2's movies end on a GOP whose last temporal references skip numbers (209 -> 211),
  // and the decoder still gives every coded picture, in display order (sa2-nx-ult's tools/hevc_sfd_pack.py the same).
  const times = pics.map((q) => q.base + q.tref);
  if (pics.some((q) => q.s0 === null)) throw new Error('a picture without slices');
  const order = times.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]);
  const disp = new Array(times.length);
  order.forEach(([t, i], rank) => {
    if (rank > 0 && order[rank - 1][0] === t) throw new Error('two pictures with the same display time');
    disp[i] = rank;
  });
  return pics.map((q, i) => ({ at: q.at, s0: q.s0, end: q.end, disp: disp[i] }));
}

// The file ranges of ES bytes [esOff, esOff + length).
function esToFile(runs, esOff, length) {
  let lo = 0, hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid][0] <= esOff) lo = mid; else hi = mid - 1;
  }
  const out = [];
  for (let k = lo; length > 0 && k < runs.length; k++) {
    const [e0, f0, ln] = runs[k];
    const a = Math.max(esOff, e0), b = Math.min(esOff + length, e0 + ln);
    if (a < b) { out.push([f0 + a - e0, b - a]); length -= b - a; esOff = b; }
  }
  return out;
}

// The pictures' rate from the video packets' timestamps (a packet's PTS is the display time of the first picture that
// starts in it): the sequence header's rate code says 59.94 for movies whose pictures come at 29.97. Snapped to the
// nearest usual rate; the header's when the timestamps say nothing.
function pictureRate(pics, pts, fallback) {
  const marks = [];
  let k = 0;
  const byAt = pics.map((q, i) => [q.at, i]).sort((a, b) => a[0] - b[0]);
  for (const [off, t] of pts) {
    while (k < byAt.length && byAt[k][0] < off) k++;
    if (k < byAt.length) marks.push([pics[byAt[k][1]].disp, t]);
  }
  if (marks.length < 2) return fallback;
  let lo = marks[0], hi = marks[0];
  for (const m of marks) { if (m[0] < lo[0]) lo = m; if (m[0] > hi[0]) hi = m; }
  if (hi[0] === lo[0] || hi[1] <= lo[1]) return fallback;
  const fps = (hi[0] - lo[0]) / ((hi[1] - lo[1]) / 90000);
  const usual = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  return usual.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
}

function sequenceSize(es) {
  for (let p = 0; p + 7 < es.length; p++) {
    if (es[p] === 0 && es[p + 1] === 0 && es[p + 2] === 1 && es[p + 3] === 0xB3) {
      const w = (es[p + 4] << 4) | (es[p + 5] >> 4), h = ((es[p + 5] & 15) << 8) | es[p + 6];
      const rate = [0, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60][es[p + 7] & 15] || 30;
      return { width: w, height: h, rate };
    }
  }
  throw new Error('no sequence header');
}

// ---- the .hevc file ------------------------------------------------------------------------------------------------

function build(d, runs, pics, frames, width, height, fps) {
  // The special ranges: the quantiser byte, the tag bytes and the zeros of each picture, in file order.
  const special = [];  // [fileOffset, length, kind (1 zero, 2 tag, 3 the quantiser byte), picture, tagByte]
  pics.forEach((q, k) => {
    for (const [off, ln] of esToFile(runs, q.s0 + 4, 1)) special.push([off, ln, 3, k, 0]);
    let tb = 0;
    for (const [off, ln] of esToFile(runs, q.s0 + 5, TAG_BYTES)) { special.push([off, ln, 2, k, tb]); tb += ln; }
    const z = q.s0 + 5 + TAG_BYTES;
    for (const [off, ln] of esToFile(runs, z, q.end - z)) special.push([off, ln, 1, k, 0]);
  });
  special.sort((a, b) => a[0] - b[0]);
  const segs = [], stored = [];
  let storedLen = 0, at = 0;
  const QUANT = new Uint8Array([QUANT_BYTE]);
  const addStored = (bytes, off) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === 0 && last.src + last.len === storedLen && last.off + last.len === off) last.len += bytes.length;
    else segs.push({ off, len: bytes.length, kind: 0, pic: 0, src: storedLen });
    stored.push(bytes);
    storedLen += bytes.length;
  };
  for (const [off, ln, kind, pic, tb] of special) {
    if (off > at) addStored(d.subarray(at, off), at);
    if (kind === 3) addStored(QUANT, off);
    else {
      const last = segs[segs.length - 1];
      if (kind === 1 && last && last.kind === 1 && last.off + last.len === off) last.len += ln;
      else segs.push({ off, len: ln, kind, pic: kind === 2 ? pic : 0, src: kind === 2 ? tb : 0 });
    }
    at = off + ln;
  }
  if (at < d.length) addStored(d.subarray(at, d.length), at);
  const hdr = 96, segOff = hdr, storedOff = segOff + 32 * segs.length, picOff = storedOff + storedLen;
  const frameTab = picOff + 4 * pics.length, dataOff = frameTab + 16 * frames.length;
  const head = new Uint8Array(storedOff);
  const v = new DataView(head.buffer);
  const u64 = (dv, o, x) => { dv.setUint32(o, x % 0x100000000, true); dv.setUint32(o + 4, Math.floor(x / 0x100000000), true); };
  for (let i = 0; i < 8; i++) head[i] = MAGIC.charCodeAt(i);
  v.setUint32(8, 1, true);
  v.setUint32(12, segs.length, true);
  u64(v, 16, d.length);
  u64(v, 24, segOff);
  u64(v, 32, storedOff);
  u64(v, 40, storedLen);
  v.setUint32(48, pics.length, true);
  u64(v, 56, picOff);
  v.setUint32(64, width, true);
  v.setUint32(68, height, true);
  v.setUint32(72, frames.length, true);
  v.setUint32(76, Math.round(fps * 1000), true);
  u64(v, 80, frameTab);
  segs.forEach((s, i) => {
    const o = segOff + 32 * i;
    u64(v, o, s.off);
    u64(v, o + 8, s.len);
    v.setUint32(o + 16, s.kind, true);
    v.setUint32(o + 20, s.pic, true);
    u64(v, o + 24, s.src);
  });
  const tail = new Uint8Array(4 * pics.length + 16 * frames.length);
  const tv = new DataView(tail.buffer);
  pics.forEach((q, i) => tv.setUint32(4 * i, q.disp, true));
  let pos = dataOff;
  frames.forEach((f, i) => {
    const o = 4 * pics.length + 16 * i;
    u64(tv, o, pos);
    tv.setUint32(o + 8, f.data.length, true);
    tv.setUint32(o + 12, f.key ? 1 : 0, true);
    pos += f.data.length;
  });
  return new Blob([head, ...stored, tail, ...frames.map((f) => f.data)]);
}

// bytes: the .sfd; mpeg1: an instance of wasm/mpeg1.mjs. -> { bytes: Blob, frames, kbps } or { bytes: null, why }.
export async function reencodeSfd(bytes, mpeg1, { fraction = 0.35, gop = 120, minKbps = 200 } = {}) {
  let es, runs, pts, pics, seq;
  try {
    ({ es, runs, pts } = demux(bytes));
    pics = pictures(es);
    seq = sequenceSize(es);
  } catch (e) {
    return { bytes: null, why: e.message || String(e) };
  }
  const { width, height, rate } = seq;
  if (pics.some((q) => q.end - (q.s0 + 4) < 1 + TAG_BYTES)) return { bytes: null, why: 'a picture too small for a tag' };
  const fps = pictureRate(pics, pts, rate);
  const seconds = pics.length / fps;
  const kbps = Math.max(minKbps, es.length * 8 / seconds / 1000 * fraction);
  const config = hevcConfig(width, height, kbps, Math.round(fps));
  if (!(await VideoEncoder.isConfigSupported(config)).supported) return { bytes: null, why: 'this browser has no H.265 encoder' };
  if (mpeg1._mpeg1_open(width, height) < 0) return { bytes: null, why: 'the MPEG-1 decoder did not open' };
  const frameBytes = width * height * 3 / 2;
  let input = mpeg1._mpeg1_malloc(1 << 20), inputSize = 1 << 20;
  const chunks = [];
  let failure = null, shown = 0;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  const encodePicture = async () => {
    const p = mpeg1._mpeg1_picture();
    const frame = new VideoFrame(mpeg1.HEAPU8.slice(p, p + frameBytes), {
      format: 'I420', codedWidth: width, codedHeight: height,
      timestamp: Math.round(shown * 1e6 / fps), duration: Math.round(1e6 / fps),
    });
    encoder.encode(frame, { keyFrame: shown % gop === 0 });
    frame.close();
    shown++;
    while (encoder.encodeQueueSize > 8 && !failure) await new Promise((r) => setTimeout(r, 1));
  };
  try {
    for (let k = 0; k < pics.length && !failure; k++) {
      // picture k with the headers before it: from the end of picture k-1's slices to the end of its own
      const a = k ? pics[k - 1].end : 0, b = pics[k].end;
      const len = b - a;
      if (len > inputSize) {
        mpeg1._mpeg1_free(input);
        inputSize = len;
        input = mpeg1._mpeg1_malloc(inputSize);
      }
      mpeg1.HEAPU8.set(es.subarray(a, b), input);
      const r = mpeg1._mpeg1_decode(input, len);
      if (r < 0) return { bytes: null, why: `MPEG-1 picture ${k} did not decode` };
      if (r === 1) await encodePicture();
    }
    while (!failure && mpeg1._mpeg1_decode(input, 0) === 1) await encodePicture();
    await encoder.flush();
  } catch (e) {
    failure = failure || e;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    mpeg1._mpeg1_free(input);
    mpeg1._mpeg1_close();
  }
  if (failure) return { bytes: null, why: `the encoder failed: ${failure.message || failure}` };
  if (shown !== pics.length) return { bytes: null, why: `${shown} pictures decoded of ${pics.length}` };
  if (chunks.length !== pics.length) return { bytes: null, why: `${chunks.length} H.265 frames for ${pics.length}` };
  for (let i = 1; i < chunks.length; ++i)
    if (chunks[i].timestamp <= chunks[i - 1].timestamp) return { bytes: null, why: 'the encoder reordered frames' };
  if (!chunks[0].key) return { bytes: null, why: 'the first H.265 frame is not a keyframe' };
  const startsWithAud = (c) => {
    const i = c[2] === 1 ? 3 : c[3] === 1 ? 4 : -1;
    return c[0] === 0 && c[1] === 0 && i > 0 && ((c[i] >> 1) & 0x3f) === 35;
  };
  const frames = chunks.map((c) => {
    if (startsWithAud(c.data)) return c;
    const data = new Uint8Array(AUD.length + c.data.length);
    data.set(AUD);
    data.set(c.data, AUD.length);
    return { data, key: c.key };
  });
  return { bytes: build(bytes, runs, pics, frames, width, height, fps), frames: frames.length, kbps: Math.round(kbps),
           why: null };
}

// For test/sfdh_node.mjs: the parts that need no browser.
export const __test = { build, pictureRate, sequenceSize };
