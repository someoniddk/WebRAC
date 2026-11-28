#!/usr/bin/env bash
# Build a complete, Cloudflare Pages-ready static site in web/dist/.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if ! command -v rustup >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "Cloudflare Pages build needs curl to install the Rust toolchain." >&2
    exit 1
  fi
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust Cargo is unavailable; install Rust before building WebRAC for Pages." >&2
  exit 1
fi

rustup target add wasm32-unknown-unknown
if ! command -v wasm-bindgen >/dev/null 2>&1 || ! wasm-bindgen --version | grep -q '0\.2\.129$'; then
  cargo install wasm-bindgen-cli --version 0.2.129 --locked --force
fi

./web/build.sh

dist="$repo_root/web/dist"
rm -rf "$dist"
mkdir -p "$dist/pkg"
cp "$repo_root/web/index.html" "$repo_root/web/main.js" "$repo_root/web/md5-worker.js" "$repo_root/web/WEBRAC LOGO.png" "$repo_root/web/_headers" "$dist/"
cp -a "$repo_root/web/pkg/." "$dist/pkg/"
cp -a "$repo_root/crates/rc-engine/assets" "$dist/assets"
rm -f "$dist/pkg/rerac_bg.wasm"

node --input-type=module - "$dist/pkg/rerac_bg.wasm.gz" <<'NODE'
import fs from "node:fs";

const [, , compressedPath] = process.argv;
const compressedBytes = fs.statSync(compressedPath).size;
const pagesLimit = 25 * 1024 * 1024;
if (compressedBytes > pagesLimit) {
  throw new Error(`Compressed game engine is ${compressedBytes} bytes, above Cloudflare Pages' ${pagesLimit}-byte per-file limit.`);
}
console.log(`Pages engine asset: ${(compressedBytes / 1048576).toFixed(1)} MiB (gzip)`);
NODE

echo "Pages output ready: web/dist/"
