// An Xbox 360 STFS package (LIVE, PIRS or CON), read only: the files in it (blur-nx's title update, a LIVE package of
// content type 0x000B0000). The layout is the console's (Free60's STFS notes, xenia's stfs_container_device):
//   0x340  the header's size (BE32); the data starts at it rounded up to 4 KB
//   0x344  the content type (BE32); 0x360 the title ID (BE32); 0x411 the display name (UTF-16 BE)
//   0x379  the volume descriptor: 0x37B flags (bit 0: read-only format, one hash table per level), 0x37C the file
//          table's block count (LE16), 0x37E its first block (LE24), 0x395 the allocated blocks (BE32)
//   4 KB blocks, with a hash table before every 170 data blocks (and one per 28,900, and per 4,913,000); two of each
//   in a writable package (flags bit 0 clear)
//   the file table: 64-byte entries: the name (40 bytes), flags (0x3F the name's length, 0x40 the blocks are
//   consecutive, 0x80 a folder), the valid and allocated block counts (LE24 each), the first block (LE24), the parent
//   folder's entry (BE16, 0xFFFF the root), the size (BE32)
// readStfs(read, size) with read(offset, length) -> Promise<Uint8Array>: { contentType, titleId, name,
// files: [{ path, size, read() }] }. A file whose blocks are not consecutive is followed through the level-0 hash
// table's next-block entries.

const PER_LEVEL = [170, 28900, 4913000];

function be16(d, o) { return (d[o] << 8) | d[o + 1]; }
function be32(d, o) { return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0; }
function le16(d, o) { return d[o] | (d[o + 1] << 8); }
function le24(d, o) { return d[o] | (d[o + 1] << 8) | (d[o + 2] << 16); }
function be24(d, o) { return (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; }

export async function readStfs(read, size) {
  const h = await read(0, 0x1000);
  const magic = String.fromCharCode(h[0], h[1], h[2], h[3]);
  if (magic !== 'LIVE' && magic !== 'PIRS' && magic !== 'CON ') throw new Error('not an Xbox 360 package');
  const headerSize = (be32(h, 0x340) + 0xfff) & ~0xfff;
  const contentType = be32(h, 0x344);
  const titleId = be32(h, 0x360);
  let name = '';
  for (let o = 0x411; o < 0x411 + 128; o += 2) {
    const c = be16(h, o);
    if (!c) break;
    name += String.fromCharCode(c);
  }
  const shift = (h[0x37b] & 1) ? 0 : 1;  // read-only format: one hash table per level
  const tableBlocks = le16(h, 0x37c);
  const tableFirst = le24(h, 0x37e);

  // the raw (4 KB) block of data block n, as the console counts them
  const dataBlockOffset = (n) => {
    let block = n;
    let base = PER_LEVEL[0];
    for (let level = 0; level < 3; level++) {
      block += Math.floor((n + base) / base) * (1 << shift);
      if (n < base) break;
      base *= PER_LEVEL[0];
    }
    return headerSize + block * 0x1000;
  };
  // the level-0 hash table that covers data block n
  const hashTableOffset = (n) => {
    const group = Math.floor(n / PER_LEVEL[0]);
    // the table sits just before the group's first data block, after any higher-level tables there
    let first = group * PER_LEVEL[0];
    let raw = dataBlockOffset(first) - 0x1000 * (1 << shift);
    if (first > 0 && first % PER_LEVEL[1] === 0) raw -= 0x1000 * (1 << shift);
    return raw;
  };
  const nextBlock = async (n) => {
    const t = await read(hashTableOffset(n) + (n % PER_LEVEL[0]) * 24, 24);
    return be24(t, 21);
  };
  const blocksOf = async (first, count, consecutive) => {
    const out = [];
    let n = first;
    for (let i = 0; i < count; i++) {
      out.push(n);
      if (i + 1 < count) n = consecutive ? n + 1 : await nextBlock(n);
    }
    return out;
  };
  const readBlocks = async (blocks, length) => {
    const out = new Uint8Array(length);
    let at = 0;
    for (const b of blocks) {
      if (at >= length) break;
      const n = Math.min(0x1000, length - at);
      out.set(await read(dataBlockOffset(b), n), at);
      at += n;
    }
    return out;
  };

  const table = await readBlocks(await blocksOf(tableFirst, tableBlocks, false), tableBlocks * 0x1000);
  const entries = [];
  for (let o = 0; o + 64 <= table.length; o += 64) {
    const flags = table[o + 0x28];
    const len = flags & 0x3f;
    if (!len) break;
    let nm = '';
    for (let i = 0; i < len; i++) nm += String.fromCharCode(table[o + i]);
    entries.push({
      name: nm, folder: (flags & 0x80) !== 0, consecutive: (flags & 0x40) !== 0,
      blocks: le24(table, o + 0x29), first: le24(table, o + 0x2f), parent: be16(table, o + 0x32), size: be32(table, o + 0x34),
    });
  }
  const pathOf = (e) => {
    const parts = [e.name];
    let p = e.parent;
    for (let guard = 0; p !== 0xffff && guard < 64; guard++) {
      const parent = entries[p];
      if (!parent) break;
      parts.unshift(parent.name);
      p = parent.parent;
    }
    return parts.join('/');
  };
  // sa2-nx-ult-installer (2026-11-21): SA2's game is a LIVE package (2.3 GB): its files are read in place, a range at a
  // time (read(offset, length)), as lib/install.js reads the game's files; read() with no arguments is the whole file
  // (the title update's use). A file's block list is found once; consecutive blocks are read in one request.
  const files = entries.filter((e) => !e.folder).map((e) => {
    let list = null;
    const blocks = async () => (list ??= await blocksOf(e.first, Math.ceil(e.size / 0x1000), e.consecutive));
    return {
      path: pathOf(e),
      size: e.size,
      read: async (offset = 0, length = e.size - offset) => {
        if (offset < 0 || offset + length > e.size) throw new Error(`${pathOf(e)}: a read past its end`);
        const all = await blocks();
        const out = new Uint8Array(length);
        let at = 0;
        while (at < length) {
          const pos = offset + at, k = Math.floor(pos / 0x1000), inside = pos % 0x1000;
          // a run of blocks that lie one after another in the package
          let run = 1;
          while (k + run < all.length && at + run * 0x1000 - inside < length &&
                 dataBlockOffset(all[k + run]) === dataBlockOffset(all[k]) + run * 0x1000) run++;
          const n = Math.min(length - at, run * 0x1000 - inside);
          out.set(await read(dataBlockOffset(all[k]) + inside, n), at);
          at += n;
        }
        return out;
      },
    };
  });
  return { contentType, titleId, name, files };
}
