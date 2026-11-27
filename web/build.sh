#!/usr/bin/env bash
# Build the ReRAC browser build: wasm32 release + wasm-bindgen glue in web/pkg/.
set -euo pipefail
cd "$(dirname "$0")/.."

export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target-wasm}"
cargo build -p rc-engine --target wasm32-unknown-unknown --release --features bevy/webgpu

mkdir -p web/pkg
wasm-bindgen --target web --out-dir web/pkg --out-name rerac --no-typescript \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/rerac.wasm"

echo "built web/pkg/rerac_bg.wasm ($(du -h web/pkg/rerac_bg.wasm | cut -f1))"
echo "serve: node web/serve.mjs   (then open http://127.0.0.1:8091/)"
