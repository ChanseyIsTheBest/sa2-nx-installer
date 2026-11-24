// lib/stfs.js against files extracted by another tool: every file of the package compared byte for byte with the
// folder's copy (both the player's own: local only). Tests only; writes nothing.
//   node test/stfs_node.mjs <package> <extracted folder>
import { openSync, readSync, fstatSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readStfs } from '../lib/stfs.js';

const fd = openSync(process.argv[2], 'r');
const size = fstatSync(fd).size;
const read = async (offset, length) => {
  const b = Buffer.alloc(length);
  readSync(fd, b, 0, length, offset);
  return new Uint8Array(b);
};
const pkg = await readStfs(read, size);
console.log(`${pkg.name}: content type ${pkg.contentType.toString(16)}, title ${pkg.titleId.toString(16)}, ${pkg.files.length} files`);
let same = 0, differ = 0, absent = 0;
for (const f of pkg.files) {
  const data = await f.read();
  const ref = join(process.argv[3], f.path);
  if (!existsSync(ref)) { console.log(`  ${f.path} (${f.size}): not in the folder`); absent++; continue; }
  const r = readFileSync(ref);
  if (Buffer.compare(Buffer.from(data), r) === 0) same++;
  else { differ++; console.log(`  ${f.path}: differs (${data.length} against ${r.length} bytes)`); }
}
console.log(`same ${same}, differ ${differ}, not in the folder ${absent}`);
