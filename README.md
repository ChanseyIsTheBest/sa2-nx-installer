<div align=center>

<img src="icons/icon-192.png" alt="Sonic Adventure 2" width="20%">

</div>
<h1 align=center>sa2-nx installer</h1>

The installer page of [sa2-nx](https://github.com/ChanseyIsTheBest/sa2-nx), the native Nintendo Switch port of
Sonic Adventure 2: **https://chanseyisthebest.github.io/sa2-nx-installer/**

You give it your own copy of the Xbox Live Arcade game (its content package, or a folder you extracted it into) and it
gives you a zip ready to extract into `sdmc:/switch/`. Everything runs in your browser: the game files never leave
your computer.

## What it does

1. Finds the game in what you chose: the content package `525E7BB1E72A2DB99AB79281BA24938048198FAD58` (read in
   place, nothing is extracted to disk), the `58411202` folder of an Xbox 360's `Content` folder, or an extracted
   game with its `default.xex`. The **Battle** DLC package, `SonicAdventure2Battle`, is picked up too when you choose
   it.
2. Identifies the game by the SHA-256 of `default.xex` (or of its decompressed image, for an executable another tool
   rebuilt) and picks its build from `release/manifest.json`.
3. Downloads that build's NRO and checks its SHA-256.
4. Makes the shader library from the game's own files: the shader containers of `Shader/xbox360/obj`, and Direct3D's
   built-in shaders, whose microcode is read from the decompressed `default.xex` and put into containers exactly as
   the tested library has them. It translates the Xbox 360 microcode to HLSL (XenosRecomp), compiles it to SPIR-V
   (DXC) and packs the library. The library must match, byte for byte, the one the NRO was tested with.
5. Writes the game files as the asset pack the console mounts (`game_root.nxpack` + `game_root.nxidx`), the format of
   the SDK's PackDevice. The console doesn't have to build it on its first start.
6. Streams the zip to disk through the service worker, so a 2.6 GB package never has to fit in memory.

The zip holds `sa2-nx/sa2.nro` with its `LICENSES.txt`, `sa2_shaders.mesp` + `.idx`, `game_root.nxpack` +
`.nxidx` and, if you chose it, `dlc/SonicAdventure2Battle`. The update zip holds the NRO, its licenses and the shaders
(and the DLC if you chose it). Neither holds `sa2.toml`: the game writes it at its first start, so an update never
overwrites your settings.

The page and the downloaded program are cached by the service worker: after the first visit it also works without a
connection.

## Layout

| Path | Contents |
|---|---|
| `index.html`, `app.js` | The page and its interface (the game's six languages, `lib/i18n.js`) |
| `worker.js` | Builds the package off the main thread |
| `sw.js` | Offline cache and the download stream |
| `lib/` | STFS package reader, XEX reader, shader containers and library, asset pack writer, zip writer |
| `wasm/` | WebAssembly builds of the shader translator, DXC, the library packer and the LZX decoder |
| `shader_common.h` | The translator's HLSL header (from `shaders/XenosRecomp` of sa2-nx) |
| `release/` | The list of builds and the licenses of the NRO |
| `test/` | Node scripts and a browser page that run the same code as the page |

`wasm/hlsl.*`, `wasm/pack.*` and `wasm/lzx.*` are built from the sa2-nx repository with
`shaders/wasm/build_wasm_tools.sh` (Emscripten). `wasm/dxc_web.*` is the WebAssembly DXC of
[nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) (unmodified DXC v2025.1 with the
`dxc_web.cpp` wrapper that is also in `shaders/wasm/` of sa2-nx); see [NOTICES.md](NOTICES.md).

## Deployment

The NRO is not stored here: it is the `sa2.nro` asset of a release of the sa2-nx repository of the same owner. The
workflow in `.github/workflows/deploy.yml` downloads it from the latest release, checks its SHA-256 against the list
and publishes the page on GitHub Pages. It runs on every push to `main`; after publishing a new release, run it by hand
from the Actions tab. Pages must be set to deploy from GitHub Actions (Settings > Pages > Source).

To publish a new build, update the build's entry in `release/manifest.json`. This script fills in the NRO's SHA-256
and size and the fingerprints of the game and of the shader library, made from your own copy with the page's code:

```sh
node test/release_node.mjs <game package> <sa2.nro> --version 1.0.1 --write
```

Test the NRO with exactly that library first: the library is in `sa2_shaders.mesp` of a zip made by
`test/package_node.mjs`; on the PC build, `SA2_SHADER_LIBRARY=<path>` loads it.

## Testing locally

Put `sa2.nro` in `release/` and serve the folder (any static server works; this one sets the right MIME types):

```sh
python serve.py 8193
```

Then open http://127.0.0.1:8193/. The same code runs in Node:

```sh
node test/package_node.mjs sa2-nx.zip <game package or folder> [<SonicAdventure2Battle>]
node test/package_node.mjs sa2-nx-update.zip <game package or folder> --update
node test/library_node.mjs <game package or folder> [<folder of reference containers>]
node test/texts_node.mjs
node test/fnv_node.mjs
```

And in a browser: start `python serve.py 8193 . --test-files <folder that holds 58411202>`, then open
`http://127.0.0.1:8193/test/browser.html?package=58411202/000D0000/525E7BB1E72A2DB99AB79281BA24938048198FAD58`.
It reads the package through range requests, makes the shader library, and makes an update package through
`worker.js` and `sw.js` (nothing is saved to disk).

## License

GPL-3.0 (see [LICENSE](LICENSE)). Third-party components are listed in [NOTICES.md](NOTICES.md). The page is built on
[nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) by StevensND.

Sonic Adventure 2 and Sonic the Hedgehog are trademarks of SEGA; the icon artwork is © SEGA. This project is not
affiliated with or endorsed by SEGA, Nintendo or Microsoft.
