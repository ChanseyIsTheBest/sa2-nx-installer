// culdcept-nx-installer (2026-11-20): checks of the movies' re-encode parts that run without a browser. Node 24:
//   node test/movies_node.mjs <original.wmv> [<H.265 copy made by culdcept-nx's tools/hevc_movie.py>] [<first frame.yuv>]
// 1. wasm/wmv3.mjs decodes every video frame of the original (and, given FFmpeg's first frame as raw yuv420p, the first
//    picture is compared with it byte for byte);
// 2. lib/asf.js reads the original and, given an H.265 copy, writes the original again with the copy's video frames: the
//    result must equal the copy byte for byte (the same remux in JavaScript as in Python).
// Game data: never commit or share what it reads or writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Asf } from '../lib/asf.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [original, copy, firstFrame] = process.argv.slice(2);
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

const src = new Asf(new Uint8Array(fs.readFileSync(original)));
const objs = src.mediaObjects();
const video = objs.filter((o) => o.stream === src.videoStream);
console.log(`${path.basename(original)}: ${src.width}x${src.height}, ${objs.length} objects (${video.length} video), ` +
            `packets of ${src.packetSize} bytes, sequence header ${Buffer.from(src.codecData).toString('hex')}`);

const { default: createWmv3Module } = await import(pathToFileURL(path.join(root, 'wasm', 'wmv3.mjs')).href);
const m = await createWmv3Module();
const seq = m._wmv3_malloc(src.codecData.length);
m.HEAPU8.set(src.codecData, seq);
if (m._wmv3_open(seq, src.codecData.length, src.width, src.height) < 0) throw new Error('wmv3_open failed');
const frameBytes = src.width * src.height * 3 / 2;
let pictures = 0, first = null;
const t0 = performance.now();
const buf = m._wmv3_malloc(1 << 22);
for (const o of video) {
  m.HEAPU8.set(o.data, buf);
  const r = m._wmv3_decode(buf, o.data.length);
  if (r < 0) throw new Error(`frame ${pictures}: wmv3_decode ${r}`);
  if (r === 1) {
    if (!first) first = m.HEAPU8.slice(m._wmv3_picture(), m._wmv3_picture() + frameBytes);
    ++pictures;
  }
}
const s = (performance.now() - t0) / 1000;
console.log(`wasm WMV3: ${pictures} pictures of ${video.length} frames in ${s.toFixed(2)} s (${(pictures / s).toFixed(0)} fps)` +
            (firstFrame ? `; first picture ${md5(first) === md5(fs.readFileSync(firstFrame).subarray(0, frameBytes)) ? 'EQUAL to' : 'DIFFERS from'} FFmpeg's` : ''));

if (copy) {
  const hevc = new Asf(new Uint8Array(fs.readFileSync(copy)));
  const hv = hevc.mediaObjects().filter((o) => o.stream === hevc.videoStream);
  if (hv.length !== video.length) throw new Error(`${hv.length} frames in the copy, ${video.length} in the original`);
  video.forEach((o, i) => { o.data = hv[i].data; o.key = hv[i].key; });
  const out = src.write(objs);
  const want = fs.readFileSync(copy);
  console.log(`remux: ${out.length} bytes, ${md5(out) === md5(want) ? 'EQUAL to' : 'DIFFERENT from'} the Python remux (${want.length} bytes)`);
}
