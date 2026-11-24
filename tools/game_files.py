#!/usr/bin/env python3
"""renut_nx_ultimate_installer (2026-11-18): the game's file list in release/manifest.json, which the page checks the
player's copy against (lib/game_check.js): a copy missing any of these files, or with one of another size, is refused,
and what is wrong is named. tools/make_release.py --game writes it with every build; this adds it to (or remakes it in)
the build of a manifest made before:

  python tools/game_files.py <game folder>

The build is the one whose default.xex is that folder's. The list is every file in the folder (path -> size, paths with
'/'), less those game.json's "skip" leaves out of the package. The disc's own extras ($SystemUpdate, $TitleUpdate,
nxeart, AvatarAssetPack) are listed if there, but the page never requires them, nor what game.json's "optional" names.
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(HERE, 'release', 'manifest.json')


def game_files(folder, skip=()):
    """{ path: size } of every file under 'folder', sorted, those a 'skip' pattern names left out."""
    res = [re.compile(p, re.IGNORECASE) for p in skip]
    out = {}
    for dirpath, _, names in os.walk(folder):
        for n in names:
            full = os.path.join(dirpath, n)
            rel = os.path.relpath(full, folder).replace(os.sep, '/')
            if any(r.fullmatch(rel) for r in res):
                continue
            out[rel] = os.path.getsize(full)
    return dict(sorted(out.items(), key=lambda kv: kv[0].lower()))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    game = json.load(open(os.path.join(HERE, 'game.json'), encoding='utf-8'))
    xex = os.path.join(folder, 'default.xex')
    if not os.path.isfile(xex):
        sys.exit(f'no default.xex in {folder}')
    xex_sha = hashlib.sha256(open(xex, 'rb').read()).hexdigest()
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    builds = [b for b in manifest['builds'] if b['xex_sha256'] == xex_sha]
    if not builds:
        sys.exit(f'no build in release/manifest.json has this default.xex (SHA-256 {xex_sha})')
    files = game_files(folder, game.get('skip', []))
    builds[0]['game_files'] = files
    with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'{builds[0]["edition"]}: {len(files)} game files, {sum(files.values()):,} bytes, in release/manifest.json')


if __name__ == '__main__':
    main()
