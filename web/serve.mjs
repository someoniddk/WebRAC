#!/usr/bin/env node
// Static server for the ReRAC browser build.
//   /data/…   -> rerac-main/extracted          (the game data folder, extracted from the user's disc)
//   /assets/… -> rerac-main/crates/rc-engine/assets (shaders and engine assets)
//   anything else -> rerac-main/web            (index.html, main.js, pkg/)
// Game data is served from the user's own extracted folder only; nothing here ships it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const roots = [
  ["/data/", path.join(repo, "extracted")],
  ["/assets/", path.join(repo, "crates/rc-engine/assets")],
  ["/", path.join(repo, "web")],
];
const port = Number(process.env.PORT || 8091);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wgsl": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bin": "application/octet-stream",
  ".data": "application/octet-stream",
  ".woff2": "font/woff2",
  ".toml": "text/plain; charset=utf-8",
};

function contentHeaders(file) {
  if (file.endsWith(".wasm.gz")) {
    return { "Content-Type": "application/gzip" };
  }
  return { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  for (const [prefix, dir] of roots) {
    if (!decoded.startsWith(prefix)) continue;
    let rel = decoded.slice(prefix.length);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(dir, rel);
    const base = path.resolve(dir);
    if (file !== base && !file.startsWith(base + path.sep)) return null;
    return file;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || "/");
  if (!file) {
    send(res, 403, "forbidden");
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, `not found: ${req.url}`);
      return;
    }
    res.writeHead(200, {
      ...contentHeaders(file),
      "Content-Length": st.size,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    });
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`ReRAC web: http://${host}:${port}/`);
  console.log(`  /data/   <- ${roots[0][1]}`);
  console.log(`  /assets/ <- ${roots[1][1]}`);
});
