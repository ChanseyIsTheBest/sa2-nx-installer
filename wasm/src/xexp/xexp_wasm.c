/* blur-nx-installer (2026-11-18): the LZX delta step of an XEX patch (a title update's default.xexp), for lib/xexp.js.
 * blur-nx is recompiled from Blur with title update 2 applied: the runtime applies default.xexp to default.xex at
 * load (blur-nx's sdk/src/system/xex_module.cpp, XexModule::ApplyPatch, from Xenia), and 519 of the game's shaders
 * are in that patched image. The page needs the same image, so it applies the patch the same way: this is the SDK's
 * sdk/src/system/lzx.cpp (lzx_decompress and lzxdelta_apply_patch, Xenia's, BSD) in C, over the same libmspack
 * lzxd.c the SDK links (sdk/thirdparty/libmspack/cabextract/mspack, LGPL-2.1). The patch records are big-endian:
 *   u32 old_addr, u32 new_addr, u16 uncompressed_len, u16 compressed_len, then compressed_len bytes when it is 2 or
 *   more (0: fill with zeros, 1: copy from old_addr).
 * Exported: xexp_apply_delta(patch, patch_len, window_size, dest) -> 0, or libmspack's error code. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <sys/types.h> /* off_t, which lzx.h uses */

#include "lzx.h"
#include "mspack.h"

typedef struct {
  struct mspack_system sys;
} mem_system;

typedef struct {
  unsigned char* buffer;
  size_t size;
  size_t offset;
} mem_file;

static int mem_read(struct mspack_file* file, void* buffer, int chars) {
  mem_file* f = (mem_file*)file;
  size_t remaining = f->size - f->offset;
  size_t total = (size_t)chars < remaining ? (size_t)chars : remaining;
  memcpy(buffer, f->buffer + f->offset, total);
  f->offset += total;
  return (int)total;
}

static int mem_write(struct mspack_file* file, void* buffer, int chars) {
  mem_file* f = (mem_file*)file;
  size_t remaining = f->size - f->offset;
  size_t total = (size_t)chars < remaining ? (size_t)chars : remaining;
  memcpy(f->buffer + f->offset, buffer, total);
  f->offset += total;
  return (int)total;
}

static void* mem_alloc(struct mspack_system* sys, size_t chars) {
  (void)sys;
  return calloc(chars, 1);
}

static void mem_free(void* ptr) { free(ptr); }

static void mem_copy(void* src, void* dest, size_t chars) { memcpy(dest, src, chars); }

/* lzx.cpp's lzx_decompress: window_data, when given, is the reference the delta's matches reach back into (the window
 * padded with zeros in front of it, ref_data_size the whole window). */
static int lzx_decompress(const void* lzx_data, size_t lzx_len, void* dest, size_t dest_len, uint32_t window_size,
                          void* window_data, size_t window_data_len) {
  int result_code = 1;
  int window_bits = -1;
  for (int b = 0; b < 32; b++) {
    if (window_size & (1u << b)) {
      window_bits = b;
      break;
    }
  }
  if (window_bits < 0) return result_code;

  struct mspack_system sys;
  memset(&sys, 0, sizeof(sys));
  sys.read = mem_read;
  sys.write = mem_write;
  sys.alloc = mem_alloc;
  sys.free = mem_free;
  sys.copy = mem_copy;
  mem_file src = {(unsigned char*)lzx_data, lzx_len, 0};
  mem_file dst = {(unsigned char*)dest, dest_len, 0};
  struct lzxd_stream* lzxd = lzxd_init(&sys, (struct mspack_file*)&src, (struct mspack_file*)&dst, window_bits, 0,
                                       0x8000, (off_t)dest_len, 0);
  if (lzxd) {
    if (window_data) {
      size_t padding_len = window_size - window_data_len;
      memset(&lzxd->window[0], 0, padding_len);
      memcpy(&lzxd->window[padding_len], window_data, window_data_len);
      lzxd->ref_data_size = window_size;
    }
    result_code = lzxd_decompress(lzxd, (off_t)dest_len);
    lzxd_free(lzxd);
  }
  return result_code;
}

static uint32_t be32(const unsigned char* p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}
static uint32_t be16(const unsigned char* p) { return ((uint32_t)p[0] << 8) | p[1]; }

/* lzx.cpp's lzxdelta_apply_patch: each record 12 bytes, and its data when compressed_len is 2 or more. */
int xexp_apply_delta(const unsigned char* patch, uint32_t patch_len, uint32_t window_size, unsigned char* dest) {
  const unsigned char* p = patch;
  const unsigned char* end = patch + patch_len;
  while (p + 12 <= end) {
    uint32_t old_addr = be32(p), new_addr = be32(p + 4), uncompressed_len = be16(p + 8), compressed_len = be16(p + 10);
    if (!compressed_len && !uncompressed_len && !new_addr && !old_addr) break;
    if (compressed_len == 0) {
      memset(dest + new_addr, 0, uncompressed_len);
    } else if (compressed_len == 1) {
      memmove(dest + new_addr, dest + old_addr, uncompressed_len);
    } else {
      int result = lzx_decompress(p + 12, compressed_len, dest + new_addr, uncompressed_len, window_size,
                                  dest + old_addr, uncompressed_len);
      if (result) return result;
    }
    p += 12 + (compressed_len >= 2 ? compressed_len : 0);
  }
  return 0;
}
