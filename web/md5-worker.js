import init, { Md5Hasher } from "./pkg/webrac_iso.js";

const EXPECTED_BYTES = 4_214_095_872;
const CHUNK_BYTES = 8 * 1024 * 1024;
let activeJob = 0;

async function hashImage(file, job) {
  await init();
  const hash = new Md5Hasher();
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    if (job !== activeJob) return;
    const end = Math.min(file.size, offset + CHUNK_BYTES);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    hash.update(bytes);
    self.postMessage({ type: "progress", job, done: end, total: file.size });
  }
  if (job !== activeJob) return;
  self.postMessage({ type: "complete", job, md5: hash.finish() });
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type === "cancel") {
    activeJob++;
    return;
  }
  if (message.type !== "hash" || !message.file) return;
  const job = ++activeJob;
  if (message.file.size !== EXPECTED_BYTES) {
    self.postMessage({ type: "error", job, message: `This ISO is ${message.file.size.toLocaleString()} bytes. The supported USA v1.00 image is ${EXPECTED_BYTES.toLocaleString()} bytes.` });
    return;
  }
  hashImage(message.file, job).catch((error) => {
    if (job === activeJob) self.postMessage({ type: "error", job, message: error instanceof Error ? error.message : String(error) });
  });
});
