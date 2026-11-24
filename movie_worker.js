// culdcept-nx-installer (2026-11-20): one movie re-encoded to H.265 on a worker of its own (lib/movies.js: the WMV3
// decoder in WebAssembly, the browser's H.265 encoder, the ASF remux). Answers { id, bytes, kind, fraction, gop } with
// { id, bytes, frames, kbps, why }: bytes null when the movie is kept as it is (why says why).
// sa2-nx-ult-installer (2026-11-21): SA2 has two kinds: its Sofdec movies (.sfd: kind 'sfd', rr6-nx-installer's
// lib/sfdh.js and wasm/mpeg1, written as NAME.hevc) and its two interviews (.wmv: kind 'wmv', culdcept's ASF rewrite).
import createWmv3Module from './wasm/wmv3.mjs';
import createMpeg1Module from './wasm/mpeg1.mjs';
import { canEncodeHevc, reencodeMovie } from './lib/movies.js';
import { reencodeSfd } from './lib/sfdh.js';

const wmv3 = await createWmv3Module({ print: () => {}, printErr: () => {} });
const mpeg1 = await createMpeg1Module({ print: () => {}, printErr: () => {} });
const hevc = await canEncodeHevc();

// One movie at a time: the pool (lib/pool.js) posts a worker its next job while one runs, and this handler awaits the
// encoder, so a second message would start while the first is decoding and reopen the one decoder under it (the
// full test of 2026-11-20: 34 of 39 movies kept as WMV, "frame N gave no picture"). The jobs wait in a chain.
let chain = Promise.resolve();
self.onmessage = ({ data }) => { chain = chain.then(() => job(data)); };
async function job(data) {
  const { id, bytes, kind, fraction, gop } = data;
  let r;
  try {
    if (!hevc) r = { bytes: null, why: 'this browser has no H.265 encoder' };
    else if (kind === 'sfd') r = await reencodeSfd(bytes, mpeg1, { fraction, gop });
    else r = await reencodeMovie(bytes, wmv3, { fraction, gop });
  } catch (e) {
    r = { bytes: null, why: e.message || String(e) };
  }
  // lib/sfdh.js gives a Blob (cloned, not transferred); lib/movies.js a Uint8Array (its buffer transferred)
  self.postMessage({ id, bytes: r.bytes, frames: r.frames, kbps: r.kbps, why: r.why },
                   r.bytes instanceof Uint8Array ? [r.bytes.buffer] : []);
}
self.postMessage({ ready: true, version: wmv3._wmv3_version(), hevc });
