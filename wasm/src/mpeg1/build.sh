#!/usr/bin/env bash
# rr6-nx-installer (2026-11-21; culdcept-nx-installer's wasm/src/wmv3/build.sh, credit culdcept-nx): builds wasm/mpeg1.mjs + wasm/mpeg1.wasm, FFmpeg's MPEG-1 video decoder for the movies' H.265
# re-encode (lib/sfdh.js), from:
#   mpeg1_wasm.c  this folder: the exports (mpeg1_open, mpeg1_decode, mpeg1_picture, mpeg1_close, mpeg1_malloc, mpeg1_free,
#                 mpeg1_version)
#   FFmpeg 4.4    rr6-nx's sdk/thirdparty/FFmpeg (FFMPEG_SRC), configured out of its tree (BUILD) with the MPEG-1
#                 video decoder only: no assembly, no threads, no programs (LGPL-2.1-or-later)
#
#   EMSDK       an emsdk folder (used when emcc is not on PATH; default: D:/sonic adventure 2/_tools/emsdk)
#   FFMPEG_SRC  FFmpeg's source (default: D:/ridge racer 6/rr6-nx/sdk/thirdparty/FFmpeg)
#   BUILD       the build folder (default: C:/rr6_wasm_ffmpeg; no spaces)
#   MAKE        make (default: devkitPro's MSYS2 make)
#   OUT         output folder (default: the installer's wasm/)
# usage: wasm/src/mpeg1/build.sh   (Git Bash)
set -eu
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER=$(cd "$HERE/../../.." && pwd)
OUT=${OUT:-$INSTALLER/wasm}
FFMPEG_SRC=${FFMPEG_SRC:-"/d/ridge racer 6/rr6-nx/sdk/thirdparty/FFmpeg"}
BUILD=${BUILD:-/c/rr6_wasm_ffmpeg}
MAKE=${MAKE:-/c/devkitPro/msys2/usr/bin/make}

if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-"D:/sonic adventure 2/_tools/emsdk"}
  command -v cygpath >/dev/null 2>&1 && EMSDK=$(cygpath -u "$EMSDK")
  [ -f "$EMSDK/.emscripten" ] || { echo "emcc not found and no emsdk at $EMSDK: set EMSDK" >&2; exit 1; }
  export EM_CONFIG="$EMSDK/.emscripten"
  for d in "$EMSDK"/python/*/ "$EMSDK"/node/*/; do PATH="$d:$PATH"; done
  PATH="$EMSDK/upstream/emscripten:$PATH"
  export PATH
fi
echo "emcc: $(emcc --version | head -1)"

# rr6-nx's FFmpeg folder holds the SDK's own config.h, so configure will not build out of its tree: a copy of the
# source in $BUILD/src without it, configured in place.
if [ ! -f "$BUILD/src/configure" ]; then
  mkdir -p "$BUILD"
  cp -r "$FFMPEG_SRC" "$BUILD/src"
  rm -f "$BUILD/src/config.h"
fi
mkdir -p "$BUILD/tmp"
export TMPDIR="$BUILD/tmp"  # configure's own test files (Windows' %TEMP% loses its backslashes in Git Bash)
cd "$BUILD/src"
FFMPEG_SRC="$BUILD/src"
BUILD="$BUILD/src"
if [ ! -f ffbuild/config.mak ]; then
  ./configure --target-os=none --arch=x86_32 --enable-cross-compile --cc=emcc --cxx=em++ \
    --ar=emar --ranlib=emranlib --nm=emnm --dep-cc=emcc \
    --disable-x86asm --disable-inline-asm --disable-asm --disable-stripping --disable-programs --disable-doc \
    --disable-debug --disable-runtime-cpudetect --disable-autodetect --disable-network --disable-pthreads \
    --disable-w32threads --disable-os2threads --disable-everything --enable-decoder=mpeg1video \
    --disable-avdevice --disable-avformat --disable-swresample --disable-swscale --disable-postproc \
    --disable-avfilter --extra-cflags="-O3"
fi
"$MAKE" -j8 libavcodec/libavcodec.a libavutil/libavutil.a

emcc -O3 -I"$BUILD" -I"$FFMPEG_SRC" "$HERE/mpeg1_wasm.c" "$BUILD/libavcodec/libavcodec.a" "$BUILD/libavutil/libavutil.a" \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS=HEAPU8 -s EXPORT_NAME=createMpeg1Module -o "$OUT/mpeg1.mjs"
ls -la "$OUT/mpeg1.mjs" "$OUT/mpeg1.wasm"
