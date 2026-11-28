#!/usr/bin/env bash
# Start the WebRAC browser demo: build web/pkg/ from the current sources when they are newer,
# serve them on 127.0.0.1:8091, and open Chromium with WebGPU.
#
# Chromium is the only supported browser: Firefox's compositor does not keep a 60 Hz canvas
# presentation even on a 144 Hz output, which reads as jagged motion in camera pans.
# Use the distribution Chromium, not the Flatpak build (it traps in wasm).
#
# Usage: ./web/run.sh [--build|--no-build]
#   --build     rebuild web/pkg/ even if it is already up to date
#   --no-build  launch the existing web/pkg/ without checking or building
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
build=auto

for arg in "$@"; do
  case "$arg" in
    --build) build=always ;;
    --no-build) build=never ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (usage: ./web/run.sh [--build|--no-build])" >&2; exit 2 ;;
  esac
done

# Cargo is incremental, so an up-to-date tree makes this a no-op; the check avoids the
# wasm-bindgen pass and gzip copy when the source and generated browser files are current.
stale=1
if [ "$build" = auto ] && [ -f "$here/pkg/rerac_bg.wasm" ] && [ -f "$here/pkg/rerac_bg.wasm.gz" ] &&
   [ -z "$(find "$root/crates" "$root/Cargo.toml" "$root/Cargo.lock" "$here/build.sh" -type f \
             \( -name '*.rs' -o -name '*.toml' -o -name '*.wgsl' \) \
             -newer "$here/pkg/rerac_bg.wasm" -print -quit 2>/dev/null)" ]; then
  stale=0
fi

if [ "$build" != never ] && [ "$stale" = 1 ]; then
  echo "building web/pkg/ from the current sources (./web/build.sh)..."
  "$here/build.sh"
fi

if ! [ -f "$here/pkg/rerac_bg.wasm" ] || ! [ -f "$here/pkg/rerac_bg.wasm.gz" ]; then
  echo "web/pkg/ is missing; run ./web/build.sh first" >&2
  exit 1
fi

if ! curl -s -o /dev/null --max-time 1 http://127.0.0.1:8091/; then
  (cd "$here" && nohup node serve.mjs > /tmp/rerac-web.log 2>&1 &)
  for _ in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 http://127.0.0.1:8091/ && break
    sleep 0.2
  done
fi

if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:8091/; then
  echo "WebRAC web server did not start; see /tmp/rerac-web.log" >&2
  exit 1
fi

if ! [ -d "$here/../extracted" ]; then
  echo "extracted/ is missing; extract your own disc first (cargo xtask regen-data --iso <image>)" >&2
  exit 1
fi

chromium=""
for b in chromium-browser chromium google-chrome-stable google-chrome; do
  if command -v "$b" >/dev/null 2>&1; then chromium="$(command -v "$b")"; break; fi
done

if [ -z "$chromium" ]; then
  echo "Chromium is not installed (tried chromium-browser, chromium, google-chrome)." >&2
  echo "WebRAC needs a Chromium-based browser with WebGPU; Firefox is not supported." >&2
  exit 1
fi

# Vulkan is what gives Chromium a WebGPU adapter on Linux; X11 avoids the Wayland/Vulkan
# surface path that refuses to start. The profile keeps saves and settings between runs.
mkdir -p "$here/rerac-chromium-profile"
# CHROMIUM_FLAGS is for debugging (e.g. --enable-logging=stderr); it is word-split on purpose.
# shellcheck disable=SC2086
exec "$chromium" \
  --user-data-dir="$here/rerac-chromium-profile" \
  --no-first-run --no-default-browser-check \
  --ozone-platform=x11 \
  --enable-features=Vulkan,WebGPU \
  --enable-unsafe-webgpu \
  --ignore-gpu-blocklist \
  ${CHROMIUM_FLAGS:-} \
  "http://127.0.0.1:8091/"
