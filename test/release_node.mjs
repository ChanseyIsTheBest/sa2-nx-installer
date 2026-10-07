// Updates the build's entry of release/manifest.json for a new release of sa2-nx: the NRO's SHA-256 and size, and
// the fingerprints of the game and of the shader library made from your package with the page's own code.
// The shader recipe ("shaders": templates and the places of Direct3D's shaders in default.xex) is kept as it is.
// Check first that the NRO was tested with that library (a PC run with SA2_SHADER_LIBRARY, see the sa2-nx docs).
// Usage: node test/release_node.mjs <game package or folder> <sa2.nro> [--version <x.y.z>] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chosenOnDisk, loadModules, root } from './node_files.mjs';
import { findGame, identifyGame, lzxStep } from '../lib/installer.js';
import { readXexImage } from '../lib/xex.js';
import { buildShaderLibrary, containersFingerprint, shaderContainers } from '../lib/shaders.js';
import { Fnv64, planPack } from '../lib/nxpack.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const versionAt = args.indexOf('--version');
const version = versionAt >= 0 ? args.splice(versionAt, 2)[1] : null;
const [input, nroPath] = args.filter((a) => a !== '--write');
if (!input || !nroPath) {
  console.error('usage: node test/release_node.mjs <game package or folder> <sa2.nro> [--version <x.y.z>] [--write]');
  process.exit(1);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifestPath = path.join(root, 'release/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const build = manifest.builds[0];
const before = JSON.stringify(build);

const { game } = await findGame(chosenOnDisk([input]));
if (!game) {
  throw new Error(`no game in ${input}`);
}
const modules = await loadModules();
const { xex, xexHash } = await identifyGame(game.files, { builds: [] });
const { image } = await readXexImage(xex, lzxStep(modules.lzx));
build.xex_sha256 = xexHash;
build.image_sha256 = sha(image);

const folder = build.shaders.folder.toLowerCase() + '/';
const gameShaders = new Map();
for (const f of game.files) {
  const p = f.path.toLowerCase();
  if (p.startsWith(folder) && /\.(wpu|wvu)$/.test(p) && !p.slice(folder.length).includes('/')) {
    gameShaders.set(p.slice(folder.length), await f.read(0, f.size));
  }
}
const containers = shaderContainers(build.shaders, gameShaders, image);
build.shaders.containers_sha256 = await containersFingerprint(containers);
const shaderCommon = new Uint8Array(fs.readFileSync(path.join(root, 'shader_common.h')));
const { library, index } = await buildShaderLibrary(containers, modules, shaderCommon);
build.library_sha256 = sha(library);
build.library_size = library.length;
build.index_sha256 = sha(index);
build.index_size = index.length;

const plan = planPack(game.files);
const fnv = new Fnv64();
for (const item of plan.items) {
  for (let offset = 0; offset < item.file.size; offset += 16 << 20) {
    fnv.update(await item.file.read(offset, Math.min(16 << 20, item.file.size - offset)));
  }
}
build.game_files = plan.items.length;
build.game_bytes = game.files.reduce((sum, f) => sum + f.size, 0);
build.game_data_fnv = fnv.value().toString(16).padStart(16, '0');

const nro = fs.readFileSync(nroPath);
build.nro_sha256 = sha(nro);
build.nro_size = nro.length;
if (version) {
  build.version = version;
}

const old = JSON.parse(before);
for (const key of Object.keys(build)) {
  const a = JSON.stringify(old[key]);
  const b = JSON.stringify(build[key]);
  if (a !== b) {
    console.log(`${key}: ${a} -> ${b}`);
  }
}
if (write) {
  // the same layout as the file in the repository: one line per shader entry
  const text = JSON.stringify(manifest, null, 2).replace(/\{\s+("stage"[^{}]*?)\s+\}/g,
    (_, body) => `{ ${body.replace(/\s*\n\s*/g, ' ')} }`).replace(/"templates": \{\s+([^{}]*?)\s+\}/,
    (_, body) => `"templates": { ${body.replace(/\s*\n\s*/g, ' ')} }`);
  fs.writeFileSync(manifestPath, text + '\n');
  fs.copyFileSync(nroPath, path.join(root, 'release', build.nro));
  console.log(`written: release/manifest.json, and ${nroPath} copied to release/${build.nro} for local tests`);
} else {
  console.log('(dry run: add --write to save)');
}
