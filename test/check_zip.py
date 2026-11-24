#!/usr/bin/env python3
"""renut_nx_ultimate_installer: checks a zip the page (or test/full_node.mjs) made against the game folder it was made
from, game.json and release/: the zip's CRCs, the NRO and every release file by the manifest's SHA-256, the shader files
(against the build's reference SHA-256 when the manifest has them), every game_root file byte for byte (the ones
game.json "skip" names left out), and every .lz4b entry's blocks decompressed and compared with the original.

  python test/check_zip.py <zip> <game folder>

Needs the lz4 module (pip's lz4). Game data: never commit or share the zip.
blur-nx (2026-11-18): with a third argument, the title update's extracted folder (when the build names one): its
default.xexp in game_root/ and its other files in update/, each the update's own.
  python test/check_zip.py <zip> <game folder> [<title update folder>]
"""
import hashlib
import json
import os
import re
import struct
import sys
import zipfile

import lz4.block

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def file_sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for piece in iter(lambda: f.read(1 << 20), b''):
            h.update(piece)
    return h.hexdigest()


def entry_sha(z, name):
    h = hashlib.sha256()
    with z.open(name) as f:
        for piece in iter(lambda: f.read(1 << 20), b''):
            h.update(piece)
    return h.hexdigest()


def check_lz4b(z, info, original):
    with z.open(info) as f:
        magic, version, block, size, count, _ = struct.unpack('<8sIIQII', f.read(32))
        # culdcept-nx-installer (2026-11-20): version 2 is ZXC blocks (no ZXC decoder in Python: its header, index and
        # size are checked here; test/pack_node.mjs checks ZXC's round trip)
        assert magic == b'RXLZ4BLK' and version in (1, 2), 'header'
        assert size == os.path.getsize(original), f'holds {size} bytes, the original has {os.path.getsize(original)}'
        f.seek(info.file_size - 16)
        index_offset, end = struct.unpack('<Q8s', f.read(16))
        assert end == b'RXLZ4END', 'footer'
        f.seek(index_offset)
        sizes = struct.unpack(f'<{count}I', f.read(4 * count))
        assert 32 + sum(sizes) == index_offset, 'index'
        if version == 2:
            return size, info.file_size, count
        f.seek(32)
        with open(original, 'rb') as o:
            for i, stored in enumerate(sizes):
                length = block if i + 1 < count else size - i * block
                data = f.read(stored)
                raw = data if stored == length else lz4.block.decompress(data, uncompressed_size=length)
                if raw != o.read(length):
                    raise AssertionError(f'block {i} differs')
    return size, info.file_size, count


# sa2-nx-ult-installer (2026-11-24): game.json "pack": the game files are game_root.nxpack + game_root.nxidx (the
# port's version 3: lib/nxpack.js, sa2-nx-ult's pack_device.h). The pack's header and index are checked here (magic,
# version, ids, sizes, the index checksum, path order, bounds), and its entries are served as the zip entries
# game_root/<path> they stand for, so every check below runs on them as on a folder's. The zip stores its entries as
# they are, so the pack is read from the zip file at its data's offset.
FNV_BASIS = 1469598103934665603
FNV_PRIME = 1099511628211


def fnv(data, h=FNV_BASIS):
    for b in data:
        h = ((h ^ b) * FNV_PRIME) & 0xFFFFFFFFFFFFFFFF
    return h


class RangeFile:
    def __init__(self, f, base, size):
        self.f, self.base, self.size, self.pos = f, base, size, 0

    def read(self, n=-1):
        if n is None or n < 0 or self.pos + n > self.size:
            n = self.size - self.pos
        self.f.seek(self.base + self.pos)
        data = self.f.read(n)
        self.pos += len(data)
        return data

    def seek(self, pos, whence=0):
        self.pos = pos if whence == 0 else self.pos + pos if whence == 1 else self.size + pos
        return self.pos

    def tell(self):
        return self.pos

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class PackInfo:
    def __init__(self, filename, file_size, guest_size):
        self.filename, self.file_size, self.guest_size = filename, file_size, guest_size


class PackArchive:
    """The zip with its pack's entries as game_root/<path> entries (open, getinfo, names)."""

    def __init__(self, z, zip_path, root):
        self.z, self.root = z, root
        idx = z.read(root + 'game_root.nxidx')
        magic, version, count, pack_id, pack_size, paths_size, checksum, data_checksum = struct.unpack(
            '<8sIIQQQQQ', idx[:56])
        assert magic == b'SSNXIDX1' and version == 3, 'the index is not version 3'
        entries, paths = idx[56:56 + 32 * count], idx[56 + 32 * count:]
        assert len(paths) == paths_size, 'the index size'
        assert fnv(paths, fnv(entries)) == checksum, 'the index checksum'
        info = z.getinfo(root + 'game_root.nxpack')
        assert info.compress_type == zipfile.ZIP_STORED and info.file_size == pack_size, 'the pack entry'
        self.raw = open(zip_path, 'rb')
        self.raw.seek(info.header_offset)
        local = self.raw.read(30)
        assert local[:4] == b'PK\x03\x04', 'the pack entry header'
        name_len, extra_len = struct.unpack('<HH', local[26:30])
        self.base = info.header_offset + 30 + name_len + extra_len
        self.raw.seek(self.base)
        pmagic, pversion, _, ppid, fsize, pdata = struct.unpack('<8sIIQQQ', self.raw.read(40))
        assert pmagic == b'SSNXPAK1' and pversion == 3, 'the pack header'
        assert ppid == pack_id and fsize == pack_size and pdata == data_checksum, 'the pack and its index disagree'
        self.files = {}
        prev = None
        for i in range(count):
            off, size, po, pl, guest = struct.unpack_from('<QQIIQ', entries, i * 32)
            name = paths[po:po + pl]
            assert paths[po + pl] == 0 and (prev is None or prev < name), f'entry {i}: its path'
            assert off >= 40 and off + size <= pack_size, f'{name}: out of the pack'
            self.files[root + 'game_root/' + name.decode()] = PackInfo(root + 'game_root/' + name.decode(), size, guest)
            prev = name
        self.count, self.pack_size, self.data_checksum = count, pack_size, data_checksum
        self.offsets = {root + 'game_root/' + paths[po:po + pl].decode(): off for off, _, po, pl, _ in
                        (struct.unpack_from('<QQIIQ', entries, i * 32) for i in range(count))}

    def names(self):
        return set(i.filename for i in self.z.infolist()) | set(self.files)

    def getinfo(self, name):
        return self.files[name] if name in self.files else self.z.getinfo(name)

    def open(self, x):
        name = x if isinstance(x, str) else x.filename
        if name in self.files:
            return RangeFile(self.raw, self.base + self.offsets[name], self.files[name].file_size)
        return self.z.open(x)

    def guest_problems(self):
        """Each entry's guest size against what its own header says (an .lz4b's, an .adxo's)."""
        bad = []
        for name, info in self.files.items():
            low = name.lower()
            with self.open(name) as f:
                head = f.read(32)
            if low.endswith('.hevc.lz4b'):
                continue  # ZXC blocks of the movie: its size is checked against the SFD below
            if low.endswith('.lz4b'):
                if head[:8] != b'RXLZ4BLK' or struct.unpack('<Q', head[16:24])[0] != info.guest_size:
                    bad.append(name)
            elif low.endswith('.adxo'):
                if head[:8] != b'RXADXOP1' or struct.unpack('<Q', head[16:24])[0] != info.guest_size:
                    bad.append(name)
            elif not low.endswith('.hevc') and info.guest_size != info.file_size:
                bad.append(name)
        return bad


def main():
    zip_path, game = sys.argv[1], sys.argv[2]
    update = sys.argv[3] if len(sys.argv) > 3 else None
    cfg = json.load(open(os.path.join(HERE, 'game.json'), encoding='utf-8'))
    manifest = json.load(open(os.path.join(HERE, 'release', 'manifest.json'), encoding='utf-8'))
    xex_sha = file_sha(os.path.join(game, 'default.xex'))
    build = next(b for b in manifest['builds'] if b['xex_sha256'] == xex_sha)
    root = f'switch/{cfg["package"]}/'
    lz4_res = [re.compile(f'^(?:{p})$', re.I) for p in cfg.get('lz4', [])]
    skip_res = [re.compile(f'^(?:{p})$', re.I) for p in cfg.get('skip', [])]
    # sa2-nx-ult-installer (2026-11-22): game.json "leave_out" groups the player may leave out (the page's boxes): a file
    # of one with no entry in any form is counted as left out
    leave_res = [re.compile(f'^(?:{o["match"]})$', re.I) for o in cfg.get('leave_out', [])]
    left_out = left_out_size = 0
    with zipfile.ZipFile(zip_path) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f'FAIL: {bad} has a wrong CRC')
        print(f'{len(z.infolist())} entries, all CRCs right')
        if root + 'game_root.nxpack' in set(i.filename for i in z.infolist()):
            try:
                z = PackArchive(z, zip_path, root)
            except AssertionError as e:
                raise SystemExit(f'FAIL: game_root.nxpack: {e}')
            print(f'game_root.nxpack: version 3, {z.count} files, {z.pack_size:,} bytes, its index right '
                  f'(data checksum {z.data_checksum:016x})')
            wrong = z.guest_problems()
            if wrong:
                raise SystemExit(f'FAIL: {len(wrong)} pack entries with a wrong guest size, the first {wrong[0]}')
            if any(n.startswith(root + 'game_root/') for n in (i.filename for i in z.z.infolist())):
                raise SystemExit('FAIL: game_root/ files in the zip beside the pack')
        names = z.names() if isinstance(z, PackArchive) else set(i.filename for i in z.infolist())
        release = {root + cfg['nro']: build['nro_sha256'], **{root + f['path']: f['sha256'] for f in build['files']
                                                              if not f.get('with_cache') or root + f['path'] in names}}
        for name, want in release.items():
            if entry_sha(z, name) != want:
                raise SystemExit(f'FAIL: {name} is not the release file')
        print(f'release files: {len(release)} as the manifest names them')
        if cfg.get('shaders'):
            for name, key in (('deko3d_glsl.bin', 'deko3d_glsl_sha256'), ('deko3d_shaders.bin', 'deko3d_shaders_sha256')):
                if root + name not in names:
                    if name == 'deko3d_glsl.bin':
                        raise SystemExit('FAIL: no deko3d_glsl.bin')
                    print(f'{name}: not in the zip (made without the cache)')
                    continue
                got = entry_sha(z, root + name)
                want = build.get(key)
                print(f'{name}: {z.getinfo(root + name).file_size:,} bytes' +
                      ('' if not want else ', the reference build\'s' if got == want else ' (not the reference build\'s)'))
                if want and got != want:
                    raise SystemExit(f'FAIL: {name} differs from the reference')
        placed = set()  # the title update's entries, which the game folder's "skip" does not concern
        if build.get('update'):
            if not update:
                raise SystemExit('FAIL: the build names a title update: pass its extracted folder as the third argument')
            want = {'default.xexp': root + 'game_root/default.xexp',
                    **{p: root + 'update/' + p for p in build['update']['files']}}
            for rel, entry in want.items():
                if entry not in names:
                    raise SystemExit(f'FAIL: no {entry} (the title update file {rel})')
                if entry_sha(z, entry) != file_sha(os.path.join(update, rel)):
                    raise SystemExit(f'FAIL: {entry} is not the title update file {rel}')
                placed.add(entry)
            print(f'title update: {len(want)} files right (default.xexp in game_root/, {len(want) - 1} in update/)')
        count = packed_in = packed_out = 0
        # culdcept-nx-installer (2026-11-20): game.json "movies" may be re-encoded (H.265 in the same ASF file) and
        # "audio" may be NAME.xmo in place of NAME (lib/xmo.js; culdcept-nx's out/test_xmo.exe checks one deeply)
        movie_res = [re.compile(f'^(?:{cfg["movies"]["match"]})$', re.I)] if cfg.get("movies") else []
        audio_res = [re.compile(f'^(?:{cfg["audio"]["match"]})$', re.I)] if cfg.get("audio") else []
        movies_in = movies_out = audio_files = audio_in = audio_out = 0
        for dirpath, _, files in os.walk(game):
            for f in sorted(files):
                original = os.path.join(dirpath, f)
                rel = os.path.relpath(original, game).replace(os.sep, '/')
                if any(r.match(rel) for r in skip_res):
                    if root + 'game_root/' + rel in names and root + 'game_root/' + rel not in placed:
                        raise SystemExit(f'FAIL: {rel} should have been left out')
                    continue
                entry = root + 'game_root/' + rel
                if any(r.match(rel) for r in leave_res) and not any(
                        entry + s in names for s in ('', '.lz4b', '.hevc', '.hevc.lz4b', '.adxo', '.xmo')):
                    left_out += 1
                    left_out_size += os.path.getsize(original)
                    continue
                count += 1
                if any(r.match(rel) for r in lz4_res):
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip unpacked too')
                    size, packed, blocks = check_lz4b(z, z.getinfo(entry + '.lz4b'), original)
                    packed_in += size
                    packed_out += packed
                    print(f'{entry}.lz4b: {blocks} blocks equal {rel} ({packed / size * 100:.1f} %)')
                # sa2-nx-ult-installer (2026-11-22): SA2's re-encodes: a Sofdec movie as NAME.hevc.lz4b (ZXC blocks
                # of rr6-nx's RXSFDH01), an interview as NAME.lz4b (ZXC blocks of the ASF with H.265), the music as
                # NAME.adxo (RXADXOP1): each one's header names the original's size (their contents are checked by
                # the port playing them: sa2-nx-ult's docs/opus-h265.md)
                elif any(r.match(rel) for r in movie_res) and (entry + '.hevc.lz4b' in names or entry + '.lz4b' in names):
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip as it was and re-encoded')
                    name = entry + '.hevc.lz4b' if entry + '.hevc.lz4b' in names else entry + '.lz4b'
                    with z.open(name) as x:
                        head = x.read(32)
                    if head[:8] != b'RXLZ4BLK':
                        raise SystemExit(f'FAIL: {name} is not a block file')
                    info = z.getinfo(name)
                    if isinstance(info, PackInfo) and name.lower().endswith('.hevc.lz4b') and \
                            info.guest_size != os.path.getsize(original):
                        raise SystemExit(f'FAIL: {name} stands for {info.guest_size} bytes, {rel} has '
                                         f'{os.path.getsize(original)}')
                    movies_in += os.path.getsize(original)
                    movies_out += info.file_size
                elif any(r.match(rel) for r in audio_res) and entry + '.adxo' in names:
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip as ADX and as .adxo')
                    with z.open(entry + '.adxo') as x:
                        head = x.read(96)
                    size = os.path.getsize(original)
                    if head[:8] != b'RXADXOP1' or struct.unpack('<Q', head[16:24])[0] != size:
                        raise SystemExit(f'FAIL: {entry}.adxo is not an .adxo of {rel}')
                    audio_files += 1
                    audio_in += size
                    audio_out += z.getinfo(entry + '.adxo').file_size
                elif any(r.match(rel) for r in audio_res) and entry + '.xmo' in names:
                    if entry in names:
                        raise SystemExit(f'FAIL: {rel} is in the zip as XMA and as .xmo')
                    with z.open(entry + '.xmo') as x:
                        head = x.read(64)
                    size = os.path.getsize(original)
                    if head[:8] != b'RXXMAOP1' or struct.unpack('<Q', head[16:24])[0] != size:
                        raise SystemExit(f'FAIL: {entry}.xmo is not an .xmo of {rel}')
                    audio_files += 1
                    audio_in += size
                    audio_out += z.getinfo(entry + '.xmo').file_size
                elif entry_sha(z, entry) != file_sha(original):
                    if any(r.match(rel) for r in movie_res):
                        with z.open(entry) as m, open(original, 'rb') as o:
                            if m.read(16) != o.read(16):
                                raise SystemExit(f'FAIL: {entry} is not an ASF file like {rel}')
                        movies_in += os.path.getsize(original)
                        movies_out += z.getinfo(entry).file_size
                        continue
                    raise SystemExit(f'FAIL: {entry} differs from {rel}')
        print(f'game_root: {count} files right' +
              (f'; packed {packed_in / 1048576:.0f} MB -> {packed_out / 1048576:.0f} MB' if packed_in else ''))
        if left_out:
            print(f'left out (game.json "leave_out"): {left_out} files, {left_out_size / 1048576:.0f} MB')
        if movies_in:
            print(f'movies re-encoded: {movies_in / 1048576:.0f} MB -> {movies_out / 1048576:.0f} MB')
        if audio_files:
            print(f'audio re-encoded: {audio_files} files, {audio_in / 1048576:.1f} MB -> {audio_out / 1048576:.1f} MB')
    print('OK')


if __name__ == '__main__':
    main()
