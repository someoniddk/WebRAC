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

The port itself is not a complete game yet; see the repository README.

## Prerequisites

1. Rust with the WebAssembly target:
   `rustup target add wasm32-unknown-unknown`
2. `wasm-bindgen-cli` matching the lockfile:
   `cargo install wasm-bindgen-cli --version 0.2.129 --locked`
3. The game data folder from your own disc, at `rerac-main/extracted/`
   (`cargo xtask regen-data --iso "<path to your disc image>"`).
4. **Chromium** with WebGPU (Chrome/Edge 113+ or the distribution Chromium).
   Firefox is not supported: its canvas presentation does not hold the game's
   60 Hz cadence and shows as jagged motion. Use the distribution package, not
   the Flatpak build (it traps in wasm).

## Build and run

```sh
./web/build.sh          # cargo build + wasm-bindgen into web/pkg/
node web/serve.mjs      # serves web/, /assets/ and /data/ on 127.0.0.1:8091
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

The native engine reads the data folder with `std::fs`. In the browser the
engine calls `window.readGameFile(path)` (`crates/rc-formats/src/web.rs`), which
does a **synchronous same-origin XHR** and returns a `Uint8Array`. Synchronous
XHR cannot use `responseType = "arraybuffer"`, so the loader asks for the
`x-user-defined` charset and turns each char code back into a byte; this works
in Chromium. The engine's level loaders are synchronous, so the first load
blocks the page until Novalis is ready (about 160 MiB, roughly ten seconds on
localhost); a movie file is read the same way when it starts.
