#!/usr/bin/env bash
# Build the ReRAC browser build: wasm32 release + wasm-bindgen glue in web/pkg/.
set -euo pipefail
cd "$(dirname "$0")/.."

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target-wasm}"
cargo build -p rc-engine --target wasm32-unknown-unknown --release --features bevy/webgpu
cargo build -p rc-web-indexer --target wasm32-unknown-unknown --release

mkdir -p web/pkg
wasm-bindgen --target web --out-dir web/pkg --out-name rerac --no-typescript \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/rerac.wasm"
wasm-bindgen --target web --out-dir web/pkg --out-name webrac_iso --no-typescript \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/rc_web_indexer.wasm"

node --input-type=module - web/pkg/rerac_bg.wasm web/pkg/rerac_bg.wasm.gz <<'NODE'
import fs from "node:fs";
import zlib from "node:zlib";

const [, , inputPath, outputPath] = process.argv;
fs.writeFileSync(outputPath, zlib.gzipSync(fs.readFileSync(inputPath), { level: 9 }));
NODE

echo "built web/pkg/rerac_bg.wasm ($(du -h web/pkg/rerac_bg.wasm | cut -f1))"
echo "built web/pkg/rerac_bg.wasm.gz ($(du -h web/pkg/rerac_bg.wasm.gz | cut -f1))"
echo "built web/pkg/webrac_iso_bg.wasm ($(du -h web/pkg/webrac_iso_bg.wasm | cut -f1))"
echo "serve: node web/serve.mjs   (then open http://127.0.0.1:8091/)"
