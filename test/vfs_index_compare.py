#!/usr/bin/env python3
"""sa2-nx-ult-installer (2026-11-24): two VFS index files (version 4, sa2-nx-ult's host_path_index.cpp) compared entry by
entry, the host path and the timestamps aside (the installer's are the zip's date, the port's the card's): the tree, each
entry's type, name, SD size, kinds and a stand-in's guest size and name, in order.

  python test/vfs_index_compare.py <index A> <index B>
"""
import struct
import sys


def parse(path):
    data = open(path, 'rb').read()
    magic, version, flags, count, body, _ = struct.unpack('<8sIIQQQ', data[:40])
    assert magic == b'RXVFSIDX' and version == 4, f'{path}: not a version 4 index'
    at = 40

    def u8():
        nonlocal at
        at += 1
        return data[at - 1]

    def u32():
        nonlocal at
        at += 4
        return struct.unpack_from('<I', data, at - 4)[0]

    def u64():
        nonlocal at
        at += 8
        return struct.unpack_from('<Q', data, at - 8)[0]

    def s():
        n = u32()
        nonlocal at
        at += n
        return data[at - n:at].decode('utf-8')

    host = s()
    out = []

    def directory(prefix):
        complete = u8()
        n = u32()
        out.append((prefix, 'dir', complete, n))
        for _ in range(n):
            kind = u8()
            name = s()
            size = u64()
            kinds = u8()
            guest = (u64(), s()) if kinds else None
            u64(); u64(); u64()
            out.append((prefix + '/' + name, 'dir' if kind else 'file', size if not kind else 0, kinds, guest))
            if kind:
                directory(prefix + '/' + name)

    directory('')
    assert at == len(data), f'{path}: {len(data) - at} bytes left over'
    return host, flags, count, out


ha, fa, ca, a = parse(sys.argv[1])
hb, fb, cb, b = parse(sys.argv[2])
print(f'A: {ca} entries, host path {ha}, flags {fa}')
print(f'B: {cb} entries, host path {hb}, flags {fb}')
kinds = {}
for e in a:
    if e[1] == 'file' and e[3]:
        kinds[e[3]] = kinds.get(e[3], 0) + 1
print('A stand-ins by kind:', dict(sorted(kinds.items())))
if a == b:
    print('SAME: every entry equal (type, name, size, kinds, guest size and name, order)')
elif sorted(a) == sorted(b):
    # The order of a directory's children is the scan's (the card's listing: the extraction's order on the console), so
    # two folders listed differently differ only there; the port sorts both sides before it validates.
    print('SAME but for the order of the entries: every entry equal (type, name, size, kinds, guest size and name)')
else:
    diffs = [(x, y) for x, y in zip(a, b) if x != y]
    print(f'DIFFERENT: {len(a)} / {len(b)} records, {len(diffs)} differ; the first:')
    for x, y in diffs[:5]:
        print('  A', x)
        print('  B', y)
    sys.exit(1)
