"""Checks every release file the page fetches against the SHA-256 that release/manifest.json names for it, as the page
does (worker.js fetchRelease), in what is published rather than in the working copy.

    python test/check_release.py                 the files as git stores them at HEAD (what GitHub Pages serves)
    python test/check_release.py URL             the files as URL serves them (the live page, or serve.py's)

From blur-nx-installer (2026-11-19): its page refused release/README.txt for players. make_release.py hashed the copy
on disk (CRLF), git stored it with LF (core.autocrlf), and the tests read the working copy, so nothing saw it before the
players did. .gitattributes keeps release/ byte for byte; this test reads the published bytes, so a change of that kind
cannot pass it. Run it before a push (on the commit) and after (on the page).
"""
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def from_git(name):
    r = subprocess.run(['git', '-C', str(ROOT), 'show', f'HEAD:release/{name}'], capture_output=True)
    return r.stdout if r.returncode == 0 else RuntimeError(f'not in HEAD ({r.stderr.decode(errors="replace").strip()})')


def from_url(base):
    def read(name):
        request = urllib.request.Request(f'{base.rstrip("/")}/release/{name}', headers={'Cache-Control': 'no-cache'})
        try:
            with urllib.request.urlopen(request) as response:
                return response.read()
        except urllib.error.HTTPError as e:
            return e  # reported as that file's failure
    return read


def main():
    read = from_url(sys.argv[1]) if len(sys.argv) > 1 else from_git
    raw = read('manifest.json')
    if isinstance(raw, Exception):
        sys.exit(f'release/manifest.json: {raw}')
    manifest = json.loads(raw)
    wanted = []  # (name, sha256), as lib/install.js fetches them
    if manifest.get('shader_common_sha256'):
        wanted.append(('shader_common.h', manifest['shader_common_sha256']))
    for build in manifest['builds']:
        wanted.append((build['nro'], build['nro_sha256']))
        if build.get('variants_sha256'):
            wanted.append(('variants.txt', build['variants_sha256']))
        wanted += [(f['source'], f['sha256']) for f in build.get('files', []) if f.get('sha256')]
    wanted = list(dict.fromkeys(wanted))
    bad = 0
    for name, sha in wanted:
        data = read(name)
        if isinstance(data, Exception):
            bad += 1
            print(f'BAD release/{name}: {data}')
            continue
        got = hashlib.sha256(data).hexdigest()
        ok = got == sha
        bad += not ok
        print(f'{"OK " if ok else "BAD"} release/{name}' + ('' if ok else f': {got}, the manifest names {sha}'))
    where = sys.argv[1] if len(sys.argv) > 1 else 'git HEAD'
    print(f'{where}: {len(wanted) - bad} of {len(wanted)} release files are the ones the manifest names')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
