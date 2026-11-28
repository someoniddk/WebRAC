# WebRAC: Web Browser Port for Ratchet & Clank 1 (2002)

WebRAC is an unofficial browser port of *Ratchet & Clank* (2002). This project is a
fork of ReRAC, based on its Rust/Bevy game engine, compiled to
`wasm32-unknown-unknown` and run with WebGPU. It boots from game data extracted
from **your own disc** — no game data is stored in this repository.

## What works today

- Renders the game world, Ratchet, Clank, the HUD and the camera with WebGPU.
- The launcher can start the game's **opening, title screen and front-end menus**, or skip directly to a chosen level.
- Save and load slots use persistent browser storage for this site, so progress remains after closing the tab.
- Keyboard and standard browser gamepad gameplay through the port's normal input
  mapping. On keyboard, `WASD`/arrows move, hold the right mouse button and move
  to orbit the camera, `Space` jumps, `J` uses the wrench, `K` fires, `Enter`
  pauses, and `Backspace` selects the map. On the planet map, hold the left
  mouse button and drag to pan; the wheel zooms. Controls settings let you turn
  mouse input on or off and adjust its sensitivity. Compatible controllers use
  both sticks, the D-pad, face buttons, bumpers, triggers, Start, and Select.
- The pre-launch settings include an FPS cap (Off, 30 through 480 FPS), occlusion
  culling, low-latency presentation, resolution, aspect ratio, and fullscreen.
  The game simulation stays at its original 60 updates per second; higher
  display caps do not speed up gameplay.
- `Enter` or `Backspace` skips a skippable in-game scene or movie. The buttons
  stay consumed until released, so skipping cannot immediately open the pause
  menu or map.
- Planet travel/level changes load synchronously (no browser worker threads).
- The pre-rendered PSS cutscenes play from the disc's `global/mpegs/NNN.bin`
  files: the in-level infobot movies, `PlayMovieB`/`PlayMovieC`, and the page
  menu's replays. The browser build reads and decodes them on the main thread
  as each picture is needed (the native build uses a worker thread).
- Browser audio is mixed by the engine and queued 120 ms ahead as scheduled
  WebAudio blocks. If playback does underrun or the browser suspends audio, a
  short fade-in reduces the pop when sound resumes.
- The launcher can select or accept a dropped extracted game-data folder. It
  checks the metadata and required files, then reads requested files from the
  user's device. Game data is not uploaded or copied into browser storage; the
  folder must be selected again after refreshing the page.
- The launcher also accepts a dropped or selected USA v1.00 `.iso`. It checks
  the full-image MD5, indexes the on-disc file ranges in a small WASM helper,
  and reads game files from the original image as needed.

The port itself is not a complete game yet; see the repository README.

## Prerequisites

1. Rust with the WebAssembly target:
   `rustup target add wasm32-unknown-unknown`
2. `wasm-bindgen-cli` matching the lockfile:
   `cargo install wasm-bindgen-cli --version 0.2.129 --locked`
3. For local development, the game data folder from your own disc at
   `rerac-main/extracted/` (`cargo xtask regen-data --iso "<path to your disc image>"`).
   Players using the browser launcher choose their extracted folder directly.
4. **Chromium** with WebGPU (Chrome/Edge 113+ or the distribution Chromium).
   Firefox is not supported: its canvas presentation does not hold the game's
   60 Hz cadence and shows as jagged motion. Use the distribution package, not
   the Flatpak build (it traps in wasm).

## Build and run

```sh
./web/build.sh          # cargo build + wasm-bindgen into web/pkg/
node web/serve.mjs      # serves web/, /assets/ and /data/ on "YOUR IP HERE"
```

Open "YOUR IP HERE" in Chromium.

Or run both steps with Chromium prepared for WebGPU (Vulkan + WebGPU flags,
dedicated profile):

```sh
./web/run.sh
```

`run.sh` rebuilds `web/pkg/` first when any source file is newer than the wasm
(`--build` forces a rebuild, `--no-build` launches the existing build), so it
always runs the current tree. The game simulation stays at 60 updates per
second while the launcher controls the browser's display update cap.

To allow another device on the LAN to connect:

```sh
HOST=0.0.0.0 node web/serve.mjs
```

The server maps:

- `/` → `web/` (the page and the wasm-bindgen glue)
- `/assets/` → `crates/rc-engine/assets/` (shaders)
- `/data/` → `extracted/` (the game data from your disc)

## How the data reaches the engine

The native engine reads the data folder with `std::fs`. In the browser, the
launcher uses the File System Access API where available, with a folder-input
fallback and folder drag-and-drop support. It checks `extract-info.json`,
`toc.bin`, the boot and shared game files, and required data in all 19 levels
before enabling Play. It keeps the browser's `File` objects in memory for this page
session and creates a local `blob:` URL only when the engine requests a file.
No game files are sent to WebRAC's server or saved into browser storage. The
folder must be selected again after a page refresh.

The launcher can also use an uncompressed USA Ratchet & Clank v1.00 `.iso`
directly. A background worker reads the selected image in chunks and checks its
MD5 against `a62a8ae0e44c2580be38c82f48b7d181`; a different image is rejected.
After a match, the small `rc-web-indexer` WASM helper reuses `rc-formats` to
parse the ISO filesystem and game TOC, then returns each game's byte range. The
existing loader makes a local blob URL for only the requested range. It does
not extract the 4.2 GB image into browser storage, and the ISO stays on the
player's device. Select the image again after a page refresh.

The engine still calls `window.readGameFile(path)` (`crates/rc-formats/src/web.rs`)
synchronously and receives a `Uint8Array`. This keeps the Rust/WASM loader intact;
the browser reads the selected folder file or ISO range through a synchronous
XHR against its local blob URL. The local development server's `/data/` route
remains available. Large files are read only when the engine asks for them, so
the whole extracted folder or ISO is not copied into browser storage. The first
level load can still pause the page while the engine reads its data.

## Cloudflare Pages deployment

In the Cloudflare Pages project, leave the repository root directory blank, set the build
command to `./web/build-pages.sh`, and the build output directory to
`web/dist`. The build script installs the Rust WebAssembly target and the
matching `wasm-bindgen` CLI if needed, builds both WASM modules, copies the
launcher and shader assets, and creates a deploy-ready directory. It places the
small ISO indexer alongside its generated JavaScript so the background ISO
checker does not fail because `web/pkg/` is ignored by Git.

The game engine WASM is about 131 MiB uncompressed. The Pages build stores a
gzip-compressed copy (about 22 MiB), below Cloudflare Pages' 25 MiB per-file
limit. The launcher explicitly decompresses it in the browser before loading
the engine, so this does not depend on Pages preserving a custom
`Content-Encoding` header. The selected game-data folder or ISO remains local
to each player and is never included in the Pages output.
