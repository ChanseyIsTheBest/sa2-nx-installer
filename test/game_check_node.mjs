// renut_nx_ultimate_installer (2026-11-18): lib/game_check.js, the check that the player's copy of the game is whole.
//   node test/game_check_node.mjs [<game folder>]
// Made-up copies first; with a game folder, also that folder against its build's "game_files" in release/manifest.json
// (tools/game_files.py), and the same folder with parts of it left out. Exits 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkGameFiles, describeProblems, optionalPaths } from '../lib/game_check.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function expect(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failed++;
}
const check = (files, wanted, game) => describeProblems(checkGameFiles(files, wanted, optionalPaths(game)));

// A made-up game: default.xex, default.xexp, afs/ (3), cse/ (2), fs/ (1), shader/ (2), and the disc's extras.
const wanted = {
  'default.xex': 100, 'default.xexp': 50, 'afs/a.afs': 1000, 'afs/b.afs': 1000, 'afs/c.afs': 1000,
  'cse/x.cse': 10, 'cse/y.cse': 20, 'fs/root.fs': 30, 'shader/one.fxo': 5, 'shader/two.fxo': 6,
  '$SystemUpdate/su20076000_00000000': 999, 'nxeart': 7,
};
const all = Object.entries(wanted).map(([p, size]) => ({ path: p, size }));
expect('a whole copy passes', check(all, wanted, {}) === '');
expect('a copy without the disc extras passes', check(all.filter((f) => !f.path.startsWith('$') && f.path !== 'nxeart'), wanted, {}) === '');
expect('paths compare without case, and with backslashes', check(all.map((f) => ({ path: f.path.toUpperCase().replace(/\//g, '\\'), size: f.size })), wanted, {}) === '');
const xexOnly = all.filter((f) => f.path.startsWith('default.'));
const m1 = check(xexOnly, wanted, {});
expect('default.xex and default.xexp alone are refused', m1 !== '', m1);
for (const folder of ['afs/ (all 3 files)', 'cse/ (all 2 files)', 'fs/ (all 1 file)', 'shader/ (all 2 files)'])
  expect(`  and the message names ${folder}`, m1.includes(folder));
expect('  and counts 8 of 10 missing', m1.includes('8 of the game\'s 10 files are missing'));
const m2 = check(all.filter((f) => f.path !== 'cse/y.cse'), wanted, {});
expect('one file missing in a folder is named', m2.includes('cse/ (1 of 2 files: y.cse)'), m2);
const m3 = check(all.map((f) => (f.path === 'afs/b.afs' ? { ...f, size: 400 } : f)), wanted, {});
expect('a file cut short is refused', m3.includes('afs/b.afs (400 bytes, the game\'s 1,000 bytes)'), m3);
expect('game.json "optional" may be absent', check(all.filter((f) => f.path !== 'fs/root.fs'), wanted, { optional: ['fs/.*'] }) === '');
expect('game.json "skip" may be absent', check(all.filter((f) => !f.path.startsWith('shader/')), wanted, { skip: ['shader/.*'] }) === '');
expect('a build without "game_files" checks nothing (manifests made before)', check(xexOnly, undefined, {}) === '');

// A real game folder against its build.
const gameDir = process.argv[2];
if (gameDir) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files.push({ path: path.relative(gameDir, full).split(path.sep).join('/'), size: fs.statSync(full).size });
    }
  };
  walk(gameDir);
  const game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'manifest.json'), 'utf8'));
  const xex = createHash('sha256').update(fs.readFileSync(path.join(gameDir, 'default.xex'))).digest('hex');
  const build = manifest.builds.find((b) => b.xex_sha256 === xex);
  expect('the folder\'s default.xex is a build of the manifest', !!build);
  expect('  which has "game_files"', !!build?.game_files, build?.game_files ? `${Object.keys(build.game_files).length} files` : '');
  if (build?.game_files) {
    expect('the folder passes', check(files, build.game_files, game) === '');
    const top = files.filter((f) => !f.path.includes('/'));
    const r1 = check(top, build.game_files, game);
    expect('its top-level files alone are refused', r1 !== '', r1);
    const r2 = check(files.filter((f) => !/^d0[2-5]\.dat$/i.test(f.path)), build.game_files, game);
    expect('without d02.dat-d05.dat it is refused, naming them', ['d02.dat', 'd03.dat', 'd04.dat', 'd05.dat'].every((n) => r2.includes(n)), r2);
  }
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
