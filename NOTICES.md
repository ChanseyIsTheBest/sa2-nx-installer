# Third-party notices

sa2-nx-installer (from 1.0.7) is a copy of culdcept-nx-installer, which is renut_nx_ultimate_installer, built from
kameo-nx-installer, rr6-nx-installer and katamari-nx-installer, themselves built on
[renut-nx-webinstaller](https://github.com/ChanseyIsTheBest/renut-nx-webinstaller) (GPL-3.0).

| Component | Where | License |
|---|---|---|
| [kameo-nx-installer](https://github.com/ChanseyIsTheBest/kameo-nx-installer), [rr6-nx-installer](https://github.com/ChanseyIsTheBest/rr6-nx-installer), [katamari-nx-installer](https://github.com/ChanseyIsTheBest/katamari-nx-installer), [bejeweled3-nx-installer](https://github.com/ChanseyIsTheBest/bejeweled3-nx-installer), [culdcept-nx-installer](https://github.com/ChanseyIsTheBest/culdcept-nx-installer) and [sa2-nx-installer](https://github.com/ChanseyIsTheBest/sa2-nx-installer) by ChanseyIsTheBest: the page, the worker, the shader chain, the zip writer, the disc image, XEX and CPDB readers, the worker pools, the LZ4 block files, the test server; for SA2 the Xbox Live package reader, the ADX to Opus and Sofdec to H.265 writers and the asset pack writer | throughout | GPL-3.0 |
| [nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) by StevensND: the download service worker and the worker's download stream, the zip writer | `sw.js`, `worker.js`, `lib/zip.js` | GPL-3.0 |
| The ultimate base's shader tools (from banjo-nx and katamari-nx), run unchanged in Pyodide: `tools/deko3d_glsl.py`, `tools/deko3d_glsl_opt.py` (and its shader lists), `tools/early_alpha.py`, `tools/renut_early_alpha.py` | `py/` | GPL-3.0 |
| [reNut](https://github.com/masterspike52/reNut) by masterspike52: the renderer whose shader chain this page runs, reused with its author's permission | throughout the chain | as its repository states |
| XenosRecomp ([hedge-dev](https://github.com/hedge-dev/XenosRecomp) and contributors), in reNut's version as the ultimate base carries it | `wasm/renut_hlsl.*`, `release/shader_common.h` | MIT |
| [uam](https://github.com/devkitPro/uam) by fincs (with Mesa's GLSL compiler and the nouveau codegen), with SwitchWakerHD's patches and banjo-nx's passes, as the ultimate base's `app/thirdparty/uam` | `wasm/uam.*`, `wasm/src/uam/` | uam: zlib License; Mesa: MIT and others (see its sources) |
| [DirectXShaderCompiler](https://github.com/microsoft/DirectXShaderCompiler) v2025.1 with SPIRV-Tools and SPIRV-Headers, and the `dxc_web.cpp` wrapper, as built by nfsmw-nx-installer (from bejeweled3-nx-installer) | `wasm/dxc_web.*` | NCSA (LLVM); SPIRV-Tools: Apache-2.0; SPIRV-Headers: MIT; the wrapper: GPL-3.0 |
| [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) (commit `22b22f56`), unmodified | `wasm/spirv_cross.*` | Apache-2.0 |
| [Pyodide](https://pyodide.org) 0.27.7 (CPython 3.12 for WebAssembly) and its numpy 2.0.2 wheel, unmodified | `vendor/pyodide/` | Pyodide: MPL-2.0; CPython: PSF License; numpy: BSD-3-Clause |
| [LZ4](https://github.com/lz4/lz4) 1.10.0 by Yann Collet: `lz4.c`, `lz4.h`, `lz4hc.c`, `lz4hc.h`, unmodified | `wasm/src/lz4/`, `wasm/lz4.*` | BSD 2-Clause (`wasm/src/lz4/LICENSE`) |
| [ZXC](https://github.com/hellobertrand/zxc) 0.15.0 by Bertrand Lebonnois: its library, unmodified but for `zxc_driver.c` left out (from rr6-nx-installer, with its `rr6_zxc.c` exports) | `wasm/src/zxc/`, `wasm/zxc.*` | BSD 3-Clause (`wasm/src/zxc/LICENSE`) |
| [FFmpeg](https://ffmpeg.org) 4.4's WMV3 / VC-1 decoder (libavcodec and libavutil, configured with that decoder only; the copy in culdcept-nx's `sdk/thirdparty/FFmpeg`), with the `wmv3_wasm.c` exports (culdcept-nx-installer, 2026-11-20) | `wasm/src/wmv3/`, `wasm/wmv3.*` | LGPL-2.1-or-later |
| [FFmpeg](https://ffmpeg.org) 4.4's xmaframes decoder (WMA Pro's; libavcodec and libavutil, configured with that decoder only; the copy in culdcept-nx's `sdk/thirdparty/FFmpeg`), with the `xma_wasm.c` exports and XMA frame walk (culdcept-nx-installer, 2026-11-20) | `wasm/src/xma/`, `wasm/xma.*` | LGPL-2.1-or-later |
| [rapidhash](https://github.com/Nicoshev/rapidhash) by Nicolas De Carli, bundled with ZXC | `wasm/src/zxc/src/lib/vendors/rapidhash.h`, `wasm/zxc.*` | MIT (`wasm/src/zxc/THIRD_PARTY_NOTICES`) |
| [libmspack](https://www.cabextract.org.uk/libmspack/) by Stuart Caie: the LZX decoder (through katamari-nx-installer; `lzxd.c` from the base's SDK in `wasm/xexp`) | `wasm/lzx.*`, `wasm/xexp.*` | LGPL-2.1 |
| The title update's reader and patch (`lib/stfs.js`, `lib/update.js`, `lib/xexp.js`, `wasm/src/xexp/xexp_wasm.c`), from blur-nx-installer (ChanseyIsTheBest, 2026-11-18); `lib/xexp.js` and `xexp_wasm.c` follow [Xenia](https://github.com/xenia-project/xenia)'s XexModule::ApplyPatch and LZX delta records as the base's SDK has them | `lib/`, `wasm/src/xexp/` | GPL-3.0 (Xenia's parts: BSD-3-Clause) |
| [xxHash](https://github.com/Cyan4973/xxHash) and [{fmt}](https://github.com/fmtlib/fmt), in the translator | `wasm/renut_hlsl.*` | BSD-2-Clause; MIT |
| [Emscripten](https://emscripten.org) 6.0.11 runtime and the musl libc it links | `wasm/*.mjs`, `wasm/*.wasm` | MIT and NCSA |

`wasm/renut_hlsl.*` is built by `wasm/src/translator/build_wasm_translator.sh`, `wasm/uam.*` by
`wasm/src/uam/build_wasm_uam.sh` (both from the ultimate base's sources), `wasm/lz4.*` by `wasm/src/lz4/build.sh` and
`wasm/zxc.*` by `wasm/src/zxc/build.sh`, `wasm/wmv3.*` by `wasm/src/wmv3/build.sh` and `wasm/xma.*` by
`wasm/src/xma/build.sh` (Emscripten 6.0.11). The Opus encoder is the browser's own (WebCodecs): the page ships none.

The licenses of the software in the package (the NRO and its libraries) are in
[release/LICENSES.txt](release/LICENSES.txt), which the zip carries beside the NRO, and the source code with its
license is at https://github.com/ChanseyIsTheBest/sa2-nx. `icon.png` is the Sonic Adventure 2 artwork, © SEGA.
