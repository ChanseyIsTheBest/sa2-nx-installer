// renut_nx_ultimate_installer (2026-11-18): whether the player's copy of the game is whole. A build in
// release/manifest.json can carry "game_files" (path -> size), the files of the copy the release was made from
// (tools/game_files.py, or tools/make_release.py --game), the ones game.json's "skip" leaves out not among them. A copy
// missing any of them, or with one of another size, is refused, and what is wrong is named. Before this the page took
// any copy whose default.xex it knew, with only "needs" (game.json) checked: a port reported a copy accepted with
// default.xex and default.xexp alone, the rest of the game missing, which the game then failed on at the console.

// The disc's own extras, not the game's: never required.
const ALWAYS_OPTIONAL = [/^\$SystemUpdate\//i, /^\$TitleUpdate\//i, /^nxeart$/i, /^AvatarAssetPack$/i];

// game.json's "skip" (left out of the package) and "optional" (may be absent): case-insensitive regular expressions on
// whole paths in the game folder, as "lz4" and "needs" are.
// sa2-nx-ult-installer (2026-11-22): and "leave_out"'s files (the player may leave them out of the package)
export function optionalPaths(game = {}) {
  const res = [...ALWAYS_OPTIONAL, ...[...(game.skip || []), ...(game.optional || []),
                                       ...(game.leave_out || []).map((o) => o.match)]
    .map((p) => new RegExp(`^(?:${p})$`, 'i'))];
  return (path) => res.some((r) => r.test(path));
}

// files: [{ path, size }] (the player's copy); wanted: { path: size } (the build's "game_files").
// Returns { required: [[path, size]], missing: [path], wrong: [{ path, size, want }] }.
export function checkGameFiles(files, wanted, optional = () => false) {
  const have = new Map(files.map((f) => [f.path.replace(/\\/g, '/').toLowerCase(), f.size]));
  const required = Object.entries(wanted || {}).filter(([path]) => !optional(path));
  const missing = [];
  const wrong = [];
  for (const [path, size] of required) {
    const got = have.get(path.toLowerCase());
    if (got === undefined) missing.push(path);
    else if (got !== size) wrong.push({ path, size: got, want: size });
  }
  return { required, missing, wrong };
}

function list(names, most) {
  return names.length <= most ? names.join(', ') : `${names.slice(0, most).join(', ')} and ${names.length - most} more`;
}

const bytes = (n) => `${n.toLocaleString('en-US')} bytes`;

// What is wrong, for the page: the missing files grouped by their top folder ("data/ (all 1384 files)", "cse/ (12 of
// 40 files: a.cse, ...)"), the files at the top by name; then the files of another size. Empty when the copy is whole.
export function describeProblems({ required, missing, wrong }) {
  const parts = [];
  if (missing.length) {
    const inFolder = new Map();
    for (const [path] of required) {
      const i = path.indexOf('/');
      if (i > 0) inFolder.set(path.slice(0, i), (inFolder.get(path.slice(0, i)) || 0) + 1);
    }
    const top = [];
    const folders = new Map();
    for (const path of missing) {
      const i = path.indexOf('/');
      if (i < 0) {
        top.push(path);
        continue;
      }
      const folder = path.slice(0, i);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(path.slice(i + 1));
    }
    const names = [...top];
    for (const [folder, inside] of folders) {
      const all = inFolder.get(folder);
      names.push(inside.length === all ? `${folder}/ (all ${all} file${all === 1 ? '' : 's'})`
        : `${folder}/ (${inside.length} of ${all} files: ${list(inside, 3)})`);
    }
    parts.push(`${missing.length} of the game's ${required.length} files ${missing.length === 1 ? 'is' : 'are'} missing: ${list(names, 12)}`);
  }
  if (wrong.length) {
    const names = wrong.map((w) => `${w.path} (${bytes(w.size)}, the game's ${bytes(w.want)})`);
    parts.push(`${wrong.length} file${wrong.length === 1 ? ' is' : 's are'} not the size of the game's (damaged or cut short): ${list(names, 4)}`);
  }
  return parts.length ? `This copy of the game is not whole. ${parts.join('. ')}. Choose the whole extracted game, or the disc image.` : '';
}
