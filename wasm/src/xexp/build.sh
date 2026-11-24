#!/usr/bin/env bash
# Builds wasm/xexp.mjs + .wasm (blur-nx-installer, 2026-11-18): the LZX delta step of an XEX patch (xexp_wasm.c, the
# SDK's lzx.cpp in C) over the libmspack lzxd.c the port's SDK links, for lib/xexp.js.
#   BANJO_NX   the base's or a port's checkout              (default: ../base next to the installer)
#   EMSDK      an emsdk folder with Emscripten 6.0.11       (default: D:/sonic adventure 2/_tools/emsdk)
#   OUT        output folder                                (default: the installer's wasm/)
set -eu
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER=$(cd "$HERE/../../.." && pwd)
BANJO_NX=${BANJO_NX:-$INSTALLER/../base}
BANJO_NX=$(cd "$BANJO_NX" && pwd)
OUT=${OUT:-$INSTALLER/wasm}
mkdir -p "$OUT"
if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-"D:/sonic adventure 2/_tools/emsdk"}
  command -v cygpath >/dev/null 2>&1 && EMSDK=$(cygpath -u "$EMSDK")
  [ -f "$EMSDK/.emscripten" ] || { echo "emcc not found and no emsdk at $EMSDK: set EMSDK" >&2; exit 1; }
  export EM_CONFIG="$EMSDK/.emscripten"
  for d in "$EMSDK"/python/*/ "$EMSDK"/node/*/; do PATH="$d:$PATH"; done
  PATH="$EMSDK/upstream/emscripten:$PATH"
fi
echo "emcc: $(emcc --version | head -1)"
MSPACK=$BANJO_NX/sdk/thirdparty/libmspack/cabextract/mspack
emcc -O2 -w -I"$MSPACK" "$HERE/xexp_wasm.c" "$MSPACK/lzxd.c" -o "$OUT/xexp.mjs" \
  -sEXPORT_NAME=createXexpModule -sEXPORT_ES6=1 -sMODULARIZE=1 -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_xexp_apply_delta,_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
  -sENVIRONMENT=web,worker,node
ls -la "$OUT/xexp.mjs" "$OUT/xexp.wasm"
