// renut_nx_ultimate_installer (blur-nx, 2026-11-18): a port recompiled from a title update's code needs that update
// from the player too (game.json "update"; blur-nx: Blur's title update 2). The player gives the update as the Xbox 360
// package they have (a LIVE, PIRS or CON file: lib/stfs.js reads it) or the folder it was extracted to. The build's
// "update" in release/manifest.json (tools/make_release.py --update) names it: the SHA-256 of its default.xexp and
// every file with its size. In the package, default.xexp goes next to default.xex in game_root/ (the runtime applies
// the patch itself) and every other file of the update to update/ (the port mounts it as the console does, UPDATE:).
import { readStfs } from './stfs.js';
import { sha256 } from './sources.js';

// The update's files from a package: [{ path, size, read(offset, length) }], each file read whole once (an update's
// files are small); null when it is not an Xbox 360 package. read(offset, length) -> Uint8Array reads the package.
export async function updateFromPackage(read, size) {
  const head = await read(0, 4);
  const magic = String.fromCharCode(...head);
  if (size < 0x1000 || (magic !== 'LIVE' && magic !== 'PIRS' && magic !== 'CON ')) return null;
  const pkg = await readStfs(read, size);
  return {
    name: pkg.name,
    titleId: pkg.titleId,
    files: pkg.files.map((f) => {
      let whole = null;
      return {
        path: f.path,
        size: f.size,
        read: async (offset, length) => {
          whole ??= await f.read();
          return whole.subarray(offset, offset + length);
        },
      };
    }),
  };
}

// Whether files ([{ path, size, read }]) are the update the build names (build.update). Returns '' when they are, or
// what is wrong, for the page.
export async function checkUpdate(build, files, title = 'the title update') {
  const want = build.update;
  if (!want) return '';
  const byPath = new Map(files.map((f) => [f.path.replace(/\\/g, '/').toLowerCase(), f]));
  const xexp = byPath.get('default.xexp');
  if (!xexp) return `No default.xexp: this is not ${title}. Choose its package (a file named like TU_...) or the folder it was extracted to.`;
  const hash = await sha256(await xexp.read(0, xexp.size));
  if (hash !== want.xexp_sha256) return `This default.xexp is not ${title}'s (its SHA-256: ${hash}).`;
  const missing = [], wrong = [];
  for (const [path, size] of Object.entries(want.files || {})) {
    const f = byPath.get(path.toLowerCase());
    if (!f) missing.push(path);
    else if (f.size !== size) wrong.push(path);
  }
  if (missing.length) return `${title} is not whole: ${missing.slice(0, 6).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`;
  if (wrong.length) return `${title} is damaged: ${wrong.slice(0, 6).join(', ')} ${wrong.length === 1 ? 'is not its' : 'are not their'} size.`;
  return '';
}

// Where each of the update's files goes in the package, under switch/<package>/: default.xexp to game_root/, the
// others to update/ (only the ones the build names: an extracted folder may hold more).
export function updatePlacement(build, files) {
  const named = new Set(Object.keys(build.update?.files || {}).map((p) => p.toLowerCase()));
  const out = [];
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    const key = path.toLowerCase();
    if (key === 'default.xexp') out.push({ file: f, to: 'game_root/default.xexp' });
    else if (named.has(key)) out.push({ file: f, to: `update/${path}` });
  }
  return out;
}
