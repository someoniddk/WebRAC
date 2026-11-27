# <img width="707" height="353" alt="WEBRAC LOGO" src="https://github.com/user-attachments/assets/feb50e15-4fd7-431b-a453-e9e335edb1e9" />


WebRAC is an unofficial browser port of *Ratchet & Clank* (2002). This project is a fork of ReRAC and is based on
ReRAC's Rust/Bevy game engine, adapted to run in the browser with WebAssembly and WebGPU.

You need your own copy of the game. This repository does not include the disc image or extracted game data. WebRAC is
an unofficial fan project and is not affiliated with or endorsed by Sony Interactive Entertainment or Insomniac Games.

## Run WebRAC

You need Rust, the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.129, and Chromium with WebGPU enabled.
First, extract the data from your own disc into `extracted/`:

```sh
cargo xtask regen-data --iso "<path to your disc image>.iso"
```

Then build and launch the browser port:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
./web/run.sh
```

See [`web/README.md`](web/README.md) for browser build details and troubleshooting. The game data and generated browser
build are kept out of version control; the build script creates them locally.

## Project layout

| Folder | Contents |
|---|---|
| `crates/` | ReRAC-based game engine, game logic, formats, and disc-data extractor |
| `web/` | WebRAC launcher, WebAssembly build script, and browser server |
| `tools/` | Development and data inspection tools |
| `docs/` | Format notes, plans, and development workflows |

## License and credit

WebRAC retains the ReRAC ISC license and copyright notice in [`LICENSE`](LICENSE). Keep that notice with copies of
the source. WebRAC's fork and browser port are based on the ReRAC engine.
