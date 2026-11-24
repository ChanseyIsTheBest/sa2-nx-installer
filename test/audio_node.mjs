// culdcept-nx-installer (2026-11-20): the audio's Opus re-encode on a PC, as the installer does it (lib/xmo.js) but with
// ffmpeg's libopus for the encoder (Node has no WebCodecs). Writes NAME.xmo next to nothing of the game's: into OUT.
//   node test/audio_node.mjs <game folder> <out folder> [regex of paths, default data/SOUND/.*\.xma] [--wav]
// --wav also writes NAME.ref.wav (the XMA decoded as the port decodes it) and NAME.opus (the Opus stream in Ogg) for
// each file, to compare (tools/xmo_compare.py in culdcept-nx) or listen to.
// FFMPEG (env): ffmpeg with libopus (default C:/ffmpeg/ffmpeg.exe).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import createXmaModule from '../wasm/xma.mjs';
import { openXma, soundIds, writeXmo, xmoBitrate, xmoRefusal } from '../lib/xmo.js';

const [game, out, pattern = 'data/SOUND/.*\\.xma'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wav = process.argv.includes('--wav');
if (!game || !out) {
  console.error('usage: node test/audio_node.mjs <game folder> <out folder> [regex] [--wav]');
  process.exit(2);
}
const FFMPEG = process.env.FFMPEG || 'C:/ffmpeg/ffmpeg.exe';
const config = JSON.parse(readFileSync(new URL('../game.json', import.meta.url)));
const rules = config.audio?.bitrates || [{ match: '.*', stereo: 128000, mono: 64000 }];
const re = new RegExp(`^(?:${pattern})$`, 'i');

function walk(dir, list = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, list);
    else list.push(relative(game, p).replace(/\\/g, '/'));
  }
  return list;
}

// Ogg pages -> packets (RFC 3533): the first is OpusHead (its pre-skip), the second OpusTags.
function oggPackets(bytes) {
  const packets = [];
  let cur = [];
  for (let at = 0; at + 27 <= bytes.length;) {
    if (bytes[at] !== 0x4f || bytes[at + 1] !== 0x67 || bytes[at + 2] !== 0x67 || bytes[at + 3] !== 0x53) throw new Error('bad Ogg page');
    const segs = bytes[at + 26];
    let data = at + 27 + segs;
    for (let i = 0; i < segs; ++i) {
      const len = bytes[at + 27 + i];
      cur.push(bytes.subarray(data, data + len));
      data += len;
      if (len < 255) {
        const n = cur.reduce((s, c) => s + c.length, 0), p = new Uint8Array(n);
        let o = 0;
        for (const c of cur) { p.set(c, o); o += c.length; }
        packets.push(p);
        cur = [];
      }
    }
    at = data;
  }
  return packets;
}

function encodeOpus(pcm, channels, bitrate) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', '48000', '-ac', String(channels),
      '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', String(bitrate), '-vbr', 'on', '-application', 'audio',
      '-frame_duration', '20', '-compression_level', '10', '-f', 'ogg', 'pipe:1']);
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code) return reject(new Error(`ffmpeg ${code}: ${err}`));
      const ogg = new Uint8Array(Buffer.concat(chunks));
      const packets = oggPackets(ogg);
      const head = packets[0];
      if (!head || new TextDecoder().decode(head.subarray(0, 8)) !== 'OpusHead') return reject(new Error('no OpusHead'));
      resolve({ preSkip: head[10] | (head[11] << 8), packets: packets.slice(2), ogg });
    });
    ff.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

function wavFile(pcm, channels) {
  const s16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; ++i) s16[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
  const b = new Uint8Array(44 + s16.byteLength), v = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0); v.setUint32(4, 36 + s16.byteLength, true);
  b.set(new TextEncoder().encode('WAVEfmt '), 8); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, 48000, true); v.setUint32(28, 48000 * 2 * channels, true);
  v.setUint16(32, 2 * channels, true); v.setUint16(34, 16, true);
  b.set(new TextEncoder().encode('data'), 36); v.setUint32(40, s16.byteLength, true);
  b.set(new Uint8Array(s16.buffer), 44);
  return b;
}

const xma = await createXmaModule({ print: () => {}, printErr: () => {} });
const all = walk(game);
const ids = soundIds(all.filter((p) => /\.xma$/i.test(p)));
const files = all.filter((p) => re.test(p));
let before = 0, after = 0, kept = 0, made = 0;
const t0 = Date.now();
for (const path of files) {
  const bytes = new Uint8Array(readFileSync(join(game, path)));
  const x = openXma(xma, bytes);
  if (!x.info) { console.log(`keep ${path}: ${x.why}`); ++kept; continue; }
  const refusal = xmoRefusal(x.info);
  if (refusal) { x.close(); console.log(`keep ${path}: ${refusal}`); ++kept; continue; }
  const { info } = x;
  const pcm = new Float32Array((info.frames + 2) * 512 * info.channels);  // two frames of silence after: the encoder's tail
  for (let f = 0; f < info.frames;) {
    const part = x.decode(Math.min(1024, info.frames - f));
    pcm.set(part, f * 512 * info.channels);
    f += part.length / (512 * info.channels);
  }
  x.close();
  const bitrate = xmoBitrate(rules, path, info.channels);
  const opus = await encodeOpus(pcm, info.channels, bitrate);
  const xmo = writeXmo(bytes, info, ids.get(path), opus);
  if (xmo.length >= bytes.length) { console.log(`keep ${path}: not smaller as Opus (${xmo.length} bytes)`); ++kept; continue; }
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path + '.xmo'), xmo);
  if (wav) {
    writeFileSync(join(out, path + '.ref.wav'), wavFile(pcm.subarray(0, info.frames * 512 * info.channels), info.channels));
    writeFileSync(join(out, path + '.opus'), opus.ogg);
  }
  before += bytes.length; after += xmo.length; ++made;
  console.log(`${path}: ${info.frames} frames, ${info.channels} ch, ${bitrate / 1000}k: ${bytes.length} -> ${xmo.length} (${(100 * xmo.length / bytes.length).toFixed(1)} %), pre-skip ${opus.preSkip}`);
}
console.log(`${made} files as .xmo, ${kept} kept: ${(before / 2 ** 20).toFixed(1)} MB -> ${(after / 2 ** 20).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
