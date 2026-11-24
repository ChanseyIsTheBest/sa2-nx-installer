// sa2-nx-ult-installer (2026-11-24): lib/vfs_index.js's index of an extracted game_root/ folder (the files as the zip
// wrote them), for checking it against the one the port writes itself (test/vfs_index_compare.py) and for an emulator
// run with no scan. A stand-in's guest size is read from its header (.lz4b, .adxo), or for NAME.hevc.lz4b taken from
// the original NAME in the game folder (its ZXC blocks are not read here). Game data: never commit what it writes.
//   node test/vfs_index_folder.mjs <extracted game_root> <original game folder> <out.bin> [host path]
import fs from 'node:fs';
import path from 'node:path';
import { standIn, VfsIndex } from '../lib/vfs_index.js';

const [folder, original, out, hostPath = '/switch/sa2-nx/game_root'] = process.argv.slice(2);
const files = fs.readdirSync(folder, { recursive: true }).map(String).filter((p) => fs.statSync(path.join(folder, p)).isFile())
  .map((p) => p.split(path.sep).join('/'));
const header = (p, n) => { const fd = fs.openSync(p, 'r'); try { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, 0); return b; } finally { fs.closeSync(fd); } };
const index = new VfsIndex();
let standIns = 0;
for (const rel of files.sort()) {
  const full = path.join(folder, rel);
  const size = fs.statSync(full).size;
  const s = standIn(rel.split('/').pop());
  let guest = null;
  if (s) {
    const low = rel.toLowerCase();
    if (low.endsWith('.hevc.lz4b')) guest = fs.statSync(path.join(original, s.guestName.length ? rel.slice(0, -'.hevc.lz4b'.length) : rel)).size;
    else guest = Number(header(full, 24).readBigUInt64LE(16));  // .lz4b and .adxo: the u64 at 16
    standIns++;
  }
  index.add(rel, size, guest);
}
const bytes = index.bytes(hostPath);
fs.writeFileSync(out, bytes);
console.log(`${files.length} files (${standIns} stand-ins): ${out}, ${bytes.length} bytes, host path ${hostPath}`);
