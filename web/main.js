// WebRAC browser shell: a fork based on ReRAC's engine, with game-data access, launcher settings, and wasm start.
//
// The engine's loaders are synchronous (the native port reads the extracted data folder with
// `std::fs`). In the browser the launcher maps user-selected local Files to blob URLs; the local
// development server can still provide the same files from `/data/`.

const launcher = document.getElementById("launcher");
const settingsModal = document.getElementById("settings");
const settingsButton = document.getElementById("settings-button");
const settingsClose = document.getElementById("settings-close");
const settingsReset = document.getElementById("settings-reset");
const settingsSaved = document.getElementById("settings-saved");
const playButton = document.getElementById("play");
const skipButton = document.getElementById("skip");
const status = document.getElementById("status");
const statusText = document.getElementById("status-text");
const statusBar = document.getElementById("status-bar");
const statusLog = document.getElementById("status-log");
const hint = document.getElementById("hint");
const selectGameDataButton = document.getElementById("select-game-data");
const gameDataInput = document.getElementById("game-data-input");
const gameDataDrop = document.getElementById("game-data-drop");
const selectGameIsoButton = document.getElementById("select-game-iso");
const gameIsoInput = document.getElementById("game-iso-input");
const gameIsoDrop = document.getElementById("game-iso-drop");
const gameDataStatus = document.getElementById("game-data-status");
let hintTimer = 0;

// The selected File objects point at the user's files; only requested files are read into memory.
// Their blob URLs let the existing synchronous Rust/WASM file API keep working without uploading game data.
let selectedGameFiles = null;
let selectedIsoFile = null;
let selectedIsoFiles = null;
let isoFileBeingIndexed = null;
let localGameDataAvailable = false;
let localDataProbePromise = null;
let localGameDataProbeComplete = false;
let sourceSelectionGeneration = 0;
let isoHashWorker = null;
const gameFileObjectUrls = new Map();

function gameDataIsAvailable() {
  return selectedGameFiles !== null || selectedIsoFiles !== null || localGameDataAvailable;
}

function setGameDataStatus(message, state = "empty") {
  gameDataStatus.textContent = message;
  gameDataStatus.dataset.state = state;
  playButton.disabled = !gameDataIsAvailable();
}

function canonicalDataPath(path) {
  const parts = String(path).replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

function indexSelectedFiles(entries) {
  const allFiles = new Map();
  for (const entry of entries) {
    const path = canonicalDataPath(entry.path);
    if (path && entry.file) allFiles.set(path.toLowerCase(), { path, file: entry.file });
  }

  const tocCandidates = [...allFiles.values()].filter(({ path }) => /(^|\/)toc\.bin$/i.test(path));
  if (!tocCandidates.length) {
    throw new Error("No toc.bin was found. Choose the extracted game-data folder containing toc.bin and extract-info.json.");
  }
  const toc = tocCandidates.find(({ path }) => {
    const slash = path.lastIndexOf("/");
    const prefix = slash < 0 ? "" : path.slice(0, slash + 1);
    return allFiles.has(`${prefix}extract-info.json`.toLowerCase());
  }) || tocCandidates[0];
  const slash = toc.path.lastIndexOf("/");
  const rootPrefix = slash < 0 ? "" : toc.path.slice(0, slash + 1);
  const rootPrefixLower = rootPrefix.toLowerCase();
  const files = new Map();
  for (const [key, item] of allFiles) {
    if (rootPrefixLower && !key.startsWith(rootPrefixLower)) continue;
    const relativePath = rootPrefix ? item.path.slice(rootPrefix.length) : item.path;
    const normalizedPath = canonicalDataPath(relativePath);
    if (normalizedPath) files.set(normalizedPath.toLowerCase(), item.file);
  }
  return files;
}

function validateGameDataInfo(info) {
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    throw new Error("extract-info.json is not a valid metadata object.");
  }
  if (info.data_format !== 1) {
    throw new Error(`This folder uses data format ${String(info.data_format)}. WebRAC needs data format 1; re-extract the game data with the matching WebRAC/ReRAC extractor.`);
  }
  if (info.game && info.game !== "rac1") {
    throw new Error(`This folder is for ${String(info.game)}, but WebRAC currently needs Ratchet & Clank (2002) data.`);
  }
  const normalizedDisc = typeof info.disc === "string" ? info.disc.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (normalizedDisc !== "scus97199") {
    throw new Error(`This folder identifies disc ${String(info.disc || "unknown")}. WebRAC currently supports the NTSC-U SCUS_971.99 data format.`);
  }
  return info;
}

function requiredGameDataPaths() {
  const paths = [
    "toc.bin",
    "boot/SYSTEM.CNF",
    "boot/SCUS_971.99",
    "global/all_text.bin",
    "global/frontbin.bin",
    "global/hud_header.bin",
    "global/irx.bin",
    "global/music.bin",
    "global/save_game.bin",
    "global/sound_bank.bin",
    "global/transition.bin",
    "global/unknown_14e8.bin",
    "global/vendor.bin",
  ];
  for (let level = 0; level <= 18; level++) {
    const number = String(level).padStart(2, "0");
    const directory = `levels/${number}/`;
    paths.push(
      `${directory}level_header.bin`,
      `${directory}overlay.bin`,
      `${directory}core_index.bin`,
      `${directory}gs_ram.bin`,
      `${directory}core_data.bin`,
      `${directory}gameplay_ntsc.bin`,
      `${directory}sound_bank.bin`,
    );
    for (let bank = 0; bank < 5; bank++) paths.push(`${directory}hud_bank_${bank}.bin`);
  }
  return paths;
}

async function inspectSelectedGameFiles(entries) {
  const files = indexSelectedFiles(entries);
  const infoFile = files.get("extract-info.json");
  if (!infoFile) throw new Error("extract-info.json is missing beside toc.bin. Choose the extracted game-data folder, not a folder from inside it.");

  let info;
  try {
    info = validateGameDataInfo(JSON.parse(await infoFile.text()));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("extract-info.json could not be read as JSON. Re-extract the game data and choose that folder again.");
    throw error;
  }

  const missing = [];
  const empty = [];
  for (const path of requiredGameDataPaths()) {
    const file = files.get(path.toLowerCase());
    if (!file) missing.push(path);
    else if (file.size === 0 && !/\/hud_bank_\d+\.bin$/i.test(path)) empty.push(path);
  }
  if (missing.length || empty.length) {
    const details = [];
    if (missing.length) details.push(`Missing ${missing.length} required file(s): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}.`);
    if (empty.length) details.push(`Empty required file(s): ${empty.slice(0, 5).join(", ")}${empty.length > 5 ? ", …" : ""}.`);
    throw new Error(`${details.join(" ")} Re-extract the complete game-data folder and try again.`);
  }
  return { files, info };
}

function releaseGameFileObjectUrls() {
  for (const url of gameFileObjectUrls.values()) URL.revokeObjectURL(url);
  gameFileObjectUrls.clear();
}

function formatGameDataSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `, about ${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function beginSourceSelection() {
  const generation = ++sourceSelectionGeneration;
  if (isoHashWorker) {
    isoHashWorker.terminate();
    isoHashWorker = null;
    setGameDataStatus("ISO check cancelled. Choose a folder or image to continue.", "checking");
  }
  return generation;
}

function priorGameDataMessage() {
  if (selectedGameFiles) return " Your previous extracted folder is still ready.";
  if (selectedIsoFiles) return " Your previous ISO is still ready.";
  if (localGameDataAvailable) return " Local development data is still ready.";
  return "";
}

function restoreGameDataStatus() {
  if (selectedIsoFiles) setGameDataStatus("The selected USA ISO is still ready to play.", "ready");
  else if (selectedGameFiles) setGameDataStatus("The selected extracted folder is still ready to play.", "ready");
  else if (localGameDataAvailable) setGameDataStatus("Local extracted game data found. Ready to play.", "ready");
  else setGameDataStatus("Choose an extracted folder or supported USA ISO to continue. This page does not include game files.", "empty");
}

async function acceptGameDataFiles(entries, generation) {
  if (generation !== sourceSelectionGeneration) return;
  setGameDataStatus("Scanning the selected folder… This checks file names and a small metadata file.", "checking");
  try {
    if (!entries.length) throw new Error("The selected folder did not contain any visible files.");
    const checked = await inspectSelectedGameFiles(entries);
    if (generation !== sourceSelectionGeneration) return;
    releaseGameFileObjectUrls();
    selectedGameFiles = checked.files;
    selectedIsoFile = null;
    selectedIsoFiles = null;
    const fileCount = Number.isInteger(checked.info.files) ? `${checked.info.files.toLocaleString()} extracted files` : "extracted files";
    setGameDataStatus(`Game data ready — ${fileCount}${formatGameDataSize(checked.info.bytes)}. Ready to play.`, "ready");
  } catch (error) {
    if (generation !== sourceSelectionGeneration) return;
    setGameDataStatus(`Folder not accepted: ${error instanceof Error ? error.message : String(error)}${priorGameDataMessage()}`, "error");
  }
}

async function collectDirectoryHandle(handle, prefix, output) {
  if (handle.kind === "file") {
    const file = await handle.getFile();
    output.push({ path: prefix || handle.name, file });
    return;
  }
  const pending = [];
  for await (const [name, child] of handle.entries()) {
    const childPath = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "directory") pending.push(collectDirectoryHandle(child, childPath, output));
    else pending.push(child.getFile().then((file) => output.push({ path: childPath, file })));
  }
  await Promise.all(pending);
}

function readLegacyEntryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readLegacyDirectoryBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function collectLegacyEntry(entry, prefix, output) {
  if (entry.isFile) {
    const file = await readLegacyEntryFile(entry);
    output.push({ path: prefix ? `${prefix}/${entry.name}` : entry.name, file });
    return;
  }
  if (!entry.isDirectory) return;
  const directoryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await readLegacyDirectoryBatch(reader);
    if (!batch.length) break;
    children.push(...batch);
  }
  await Promise.all(children.map((child) => collectLegacyEntry(child, directoryPath, output)));
}

async function openGameDataPicker() {
  const generation = beginSourceSelection();
  if (typeof window.showDirectoryPicker !== "function" || !window.isSecureContext) {
    gameDataInput.dataset.selectionGeneration = String(generation);
    gameDataInput.click();
    return;
  }
  try {
    const directory = await window.showDirectoryPicker({ mode: "read" });
    const entries = [];
    setGameDataStatus("Reading the selected folder structure…", "checking");
    await collectDirectoryHandle(directory, "", entries);
    await acceptGameDataFiles(entries, generation);
  } catch (error) {
    if (error && error.name === "AbortError") {
      if (generation === sourceSelectionGeneration) restoreGameDataStatus();
      return;
    }
    if (generation !== sourceSelectionGeneration) return;
    setGameDataStatus(`Could not open that folder: ${error instanceof Error ? error.message : String(error)}. You can try the folder button again.`, "error");
  }
}

selectGameDataButton.addEventListener("click", openGameDataPicker);
gameDataDrop.addEventListener("click", openGameDataPicker);
gameDataDrop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openGameDataPicker();
  }
});
gameDataInput.addEventListener("change", () => {
  const entries = Array.from(gameDataInput.files || [], (file) => ({ path: file.webkitRelativePath || file.name, file }));
  const generation = Number(gameDataInput.dataset.selectionGeneration) || beginSourceSelection();
  delete gameDataInput.dataset.selectionGeneration;
  gameDataInput.value = "";
  acceptGameDataFiles(entries, generation);
});
gameDataInput.addEventListener("cancel", () => {
  delete gameDataInput.dataset.selectionGeneration;
  restoreGameDataStatus();
});
for (const eventName of ["dragenter", "dragover"]) {
  gameDataDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    gameDataDrop.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  gameDataDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    gameDataDrop.classList.remove("dragging");
  });
}
gameDataDrop.addEventListener("drop", async (event) => {
  const generation = beginSourceSelection();
  setGameDataStatus("Reading the dropped folder structure…", "checking");
  const items = Array.from(event.dataTransfer?.items || []).filter((item) => item.kind === "file");
  try {
    const entries = [];
    let folderRead = false;
    if (items.length && typeof items[0].getAsFileSystemHandle === "function") {
      const handles = await Promise.all(items.map((item) => item.getAsFileSystemHandle()));
      const usableHandles = handles.filter(Boolean);
      for (const handle of usableHandles) await collectDirectoryHandle(handle, "", entries);
      folderRead = usableHandles.length > 0;
    }
    if (!folderRead) {
      const legacyEntries = items.map((item) => typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null).filter(Boolean);
      if (legacyEntries.length) {
        await Promise.all(legacyEntries.map((entry) => collectLegacyEntry(entry, "", entries)));
        folderRead = true;
      }
    }
    if (!folderRead) {
      const files = Array.from(event.dataTransfer?.files || []);
      entries.push(...files.map((file) => ({ path: file.webkitRelativePath || file.name, file })));
    }
    await acceptGameDataFiles(entries, generation);
  } catch (error) {
    if (generation !== sourceSelectionGeneration) return;
    setGameDataStatus(`Could not read the dropped folder: ${error instanceof Error ? error.message : String(error)}. Use the folder button to select it.`, "error");
  }
});

const EXPECTED_USA_ISO_MD5 = "a62a8ae0e44c2580be38c82f48b7d181";

function validateIsoFileIndex(records, imageSize) {
  const files = new Map();
  for (const record of Array.from(records || [])) {
    const path = canonicalDataPath(record.path);
    const offset = Number(record.offset);
    const bytes = Number(record.bytes);
    if (!path || !Number.isSafeInteger(offset) || !Number.isSafeInteger(bytes) || offset < 0 || bytes < 0 || offset + bytes > imageSize) {
      throw new Error("The disc index contains an invalid file path or range.");
    }
    const key = path.toLowerCase();
    if (files.has(key)) throw new Error(`The disc index contains a repeated path: ${path}`);
    files.set(key, { offset, bytes });
  }

  const missing = requiredGameDataPaths().filter((path) => !files.has(path.toLowerCase()));
  if (missing.length) {
    throw new Error(`The recognized disc is missing ${missing.length} game file(s), including ${missing.slice(0, 6).join(", ")}.`);
  }
  return files;
}

window.readIsoBytes = function readIsoBytes(offset, length) {
  if (!isoFileBeingIndexed) throw new Error("ISO indexing requested bytes before a disc image was selected.");
  const start = Number(offset);
  const count = Number(length);
  const end = start + count;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || count < 0 || start < 0 || end > isoFileBeingIndexed.size) {
    throw new Error("ISO indexer requested a byte range outside the selected image.");
  }

  const blob = isoFileBeingIndexed.slice(start, end);
  if (blob.size !== count) throw new Error("The selected ISO ended before the requested byte range.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", objectUrl, false);
    xhr.overrideMimeType("text/plain; charset=x-user-defined");
    xhr.send(null);
    if (xhr.status !== 200) throw new Error(`could not read ISO byte range (HTTP ${xhr.status})`);
    const text = xhr.responseText;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  } catch (error) {
    throw new Error(`could not index the selected ISO: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

async function indexVerifiedIso(file, generation) {
  setGameDataStatus("USA image hash matches. Reading its disc index…", "checking");
  try {
    const { default: initIndexer, index_disc_image: indexDiscImage } = await import("./pkg/webrac_iso.js");
    await initIndexer();
    if (generation !== sourceSelectionGeneration) return;

    isoFileBeingIndexed = file;
    let records;
    try {
      records = indexDiscImage(file.size);
    } finally {
      isoFileBeingIndexed = null;
    }
    if (generation !== sourceSelectionGeneration) return;
    const files = validateIsoFileIndex(records, file.size);
    releaseGameFileObjectUrls();
    selectedGameFiles = null;
    selectedIsoFile = file;
    selectedIsoFiles = files;
    setGameDataStatus(`USA Ratchet & Clank ISO verified — ${files.size.toLocaleString()} game files indexed${formatGameDataSize(file.size)}. Ready to play.`, "ready");
  } catch (error) {
    isoFileBeingIndexed = null;
    if (generation !== sourceSelectionGeneration) return;
    setGameDataStatus(`ISO could not be prepared: ${error instanceof Error ? error.message : String(error)}${priorGameDataMessage()}`, "error");
  }
}

function startIsoHash(file, generation) {
  if (generation !== sourceSelectionGeneration) return;
  setGameDataStatus("Checking the whole ISO against the supported USA disc MD5… 0%", "checking");
  let worker;
  try {
    worker = new Worker(new URL("./md5-worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    setGameDataStatus(`This browser could not start the ISO checker: ${error instanceof Error ? error.message : String(error)}. Choose an extracted folder instead.${priorGameDataMessage()}`, "error");
    return;
  }
  isoHashWorker = worker;
  worker.addEventListener("message", (event) => {
    if (generation !== sourceSelectionGeneration || isoHashWorker !== worker) return;
    const message = event.data || {};
    if (message.type === "progress") {
      const percent = Math.min(100, Math.floor(message.done / Math.max(1, message.total) * 100));
      const readGb = (message.done / 1_000_000_000).toFixed(1);
      const totalGb = (message.total / 1_000_000_000).toFixed(1);
      setGameDataStatus(`Checking the whole ISO against the supported USA disc MD5… ${percent}% (${readGb} / ${totalGb} GB)`, "checking");
      return;
    }
    worker.terminate();
    isoHashWorker = null;
    if (message.type === "error") {
      setGameDataStatus(`ISO check failed: ${String(message.message || "the file could not be read")}${priorGameDataMessage()}`, "error");
      return;
    }
    if (message.type !== "complete") return;
    const actualMd5 = String(message.md5 || "").toLowerCase();
    if (actualMd5 !== EXPECTED_USA_ISO_MD5) {
      setGameDataStatus(`This is not the supported USA v1.00 image. Its MD5 is ${actualMd5 || "unavailable"}; expected ${EXPECTED_USA_ISO_MD5}.${priorGameDataMessage()}`, "error");
      return;
    }
    indexVerifiedIso(file, generation);
  });
  worker.addEventListener("error", (event) => {
    if (generation !== sourceSelectionGeneration || isoHashWorker !== worker) return;
    worker.terminate();
    isoHashWorker = null;
    const details = [event.message, event.filename && `${event.filename}${event.lineno ? `:${event.lineno}` : ""}`].filter(Boolean).join(" at ");
    const reason = details || "the background checker or its WebAssembly helper could not be loaded";
    setGameDataStatus(`ISO check failed: ${reason}. The deployed site must include md5-worker.js and the generated pkg/webrac_iso.js and pkg/webrac_iso_bg.wasm files; rebuild Pages with ./web/build-pages.sh and output directory web/dist.${priorGameDataMessage()}`, "error");
  });
  worker.addEventListener("messageerror", () => {
    if (generation !== sourceSelectionGeneration || isoHashWorker !== worker) return;
    worker.terminate();
    isoHashWorker = null;
    setGameDataStatus(`ISO check failed: the background checker could not read its message. Rebuild Pages with ./web/build-pages.sh and output directory web/dist.${priorGameDataMessage()}`, "error");
  });
  worker.postMessage({ type: "hash", file });
}

function openIsoPicker() {
  const generation = beginSourceSelection();
  gameIsoInput.dataset.selectionGeneration = String(generation);
  gameIsoInput.click();
}

selectGameIsoButton.addEventListener("click", openIsoPicker);
gameIsoDrop.addEventListener("click", openIsoPicker);
gameIsoDrop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openIsoPicker();
  }
});
gameIsoInput.addEventListener("change", () => {
  const file = gameIsoInput.files?.[0] || null;
  const generation = Number(gameIsoInput.dataset.selectionGeneration) || beginSourceSelection();
  delete gameIsoInput.dataset.selectionGeneration;
  gameIsoInput.value = "";
  if (!file) return;
  startIsoHash(file, generation);
});
gameIsoInput.addEventListener("cancel", () => {
  delete gameIsoInput.dataset.selectionGeneration;
  restoreGameDataStatus();
});
for (const eventName of ["dragenter", "dragover"]) {
  gameIsoDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    gameIsoDrop.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  gameIsoDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    gameIsoDrop.classList.remove("dragging");
  });
}
gameIsoDrop.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []);
  const generation = beginSourceSelection();
  if (files.length !== 1) {
    setGameDataStatus(`Drop one ISO image at a time.${priorGameDataMessage()}`, "error");
    return;
  }
  startIsoHash(files[0], generation);
});

window.addEventListener("beforeunload", releaseGameFileObjectUrls);

// The control hint is a quiet bottom pill: it greets the player for a few seconds, then only appears while the
// pointer rests near the bottom edge (so it never covers the picture during play).
function showHint(seconds = 0) {
  clearTimeout(hintTimer);
  hint.classList.add("show");
  if (seconds > 0) hintTimer = setTimeout(() => hint.classList.remove("show"), seconds * 1000);
}
window.addEventListener("pointermove", (e) => {
  if (!window.__rerac || !window.__rerac.started) return;
  if (e.clientY > window.innerHeight - 80) showHint(2.5);
  else hint.classList.remove("show");
});

// ---- launcher settings -----------------------------------------------------------------------------------------
// The browser build has no native settings file: the launcher owns the options, keeps them in localStorage, and
// passes them to the engine as the same `RC_*` switches the native build reads (window.__reracEnv -> crate::web::var).
const STORAGE_KEY = "rerac.launcher.settings.v1";
const DEFAULTS = Object.freeze({
  preset: "original",
  aa: "original",
  detail: "original",
  textures: "original",
  hud: "original",
  shadows: "on",
  aspect: "4:3",
  resolution: "window",
  fullscreen: "off",
  fpsLimit: "60",
  culling: "on",
  lowLatency: "off",
  mouseEnabled: "on",
  mouseSensitivity: "1",
  startMode: "front-end",
  level: "1",
});
const PRESETS = Object.freeze({
  original: { aa: "original", detail: "original", textures: "original", hud: "original" },
  performance: { aa: "off", detail: "near", textures: "original", hud: "original" },
  enhanced: { aa: "4x", detail: "far", textures: "smooth", hud: "original" },
  maximum: { aa: "8x", detail: "maximum", textures: "sharp", hud: "original" },
});
const ALLOWED = Object.freeze({
  preset: ["original", "performance", "enhanced", "maximum", "custom"],
  aa: ["original", "off", "2x", "4x", "8x"],
  detail: ["near", "original", "far", "farther", "maximum"],
  textures: ["original", "smooth", "sharp"],
  hud: ["original", "sharp"],
  shadows: ["on", "off"],
  aspect: ["4:3", "16:10", "16:9", "fill"],
  resolution: ["window", "416p", "720p", "1080p", "1440p", "2160p"],
  fullscreen: ["off", "on"],
  fpsLimit: ["0", "30", "60", "80", "100", "120", "144", "165", "200", "240", "300", "360", "480"],
  culling: ["on", "off"],
  lowLatency: ["off", "on"],
  mouseEnabled: ["on", "off"],
  mouseSensitivity: ["0.5", "0.75", "1", "1.25", "1.5", "2", "3", "4"],
  startMode: ["front-end", "level"],
  level: Array.from({ length: 19 }, (_, i) => String(i)),
});
const controls = {
  preset: document.getElementById("set-preset"),
  aa: document.getElementById("set-aa"),
  detail: document.getElementById("set-detail"),
  textures: document.getElementById("set-textures"),
  hud: document.getElementById("set-hud"),
  shadows: document.getElementById("set-shadows"),
  aspect: document.getElementById("set-aspect"),
  resolution: document.getElementById("set-resolution"),
  fullscreen: document.getElementById("set-fullscreen"),
  fpsLimit: document.getElementById("set-fps-limit"),
  culling: document.getElementById("set-culling"),
  lowLatency: document.getElementById("set-low-latency"),
  mouseEnabled: document.getElementById("set-mouse-enabled"),
  mouseSensitivity: document.getElementById("set-mouse-sensitivity"),
  startMode: document.getElementById("set-start-mode"),
  level: document.getElementById("set-level"),
};

function sanitizeSettings(s) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = s && s[key];
    if (typeof value === "string" && ALLOWED[key].includes(value)) out[key] = value;
  }
  return out;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch (e) {
    console.warn("settings: could not read localStorage", e);
  }
  return { ...DEFAULTS };
}

let settings = loadSettings();

function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    settingsSaved.textContent = "Saved";
    settingsSaved.style.color = "";
  } catch (e) {
    console.warn("settings: could not write localStorage", e);
    settingsSaved.textContent = "Could not save";
    settingsSaved.style.color = "#ffb0b0";
  }
}

function presetOf(s) {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (p.aa === s.aa && p.detail === s.detail && p.textures === s.textures && p.hud === s.hud) return name;
  }
  return "custom";
}

function readControls() {
  const s = { ...settings };
  for (const [key, el] of Object.entries(controls)) s[key] = el.value;
  return sanitizeSettings(s);
}

function writeControls(s) {
  for (const [key, el] of Object.entries(controls)) el.value = s[key];
}

function onSettingChanged(event) {
  const key = event.target.id.replace(/^set-/, "");
  settings = readControls();
  if (key === "preset" && settings.preset !== "custom") {
    Object.assign(settings, PRESETS[settings.preset]);
  } else if (key !== "preset") {
    settings.preset = presetOf(settings);
  }
  writeControls(settings);
  saveSettings(settings);
}

for (const el of Object.values(controls)) el.addEventListener("change", onSettingChanged);

function openSettings() {
  writeControls(settings);
  settingsModal.classList.remove("hidden");
  settingsSaved.textContent = "Saved";
  controls.preset.focus();
}

function closeSettings() {
  saveSettings(settings);
  settingsModal.classList.add("hidden");
}

settingsButton.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});
settingsReset.addEventListener("click", () => {
  settings = { ...DEFAULTS };
  writeControls(settings);
  saveSettings(settings);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) {
    e.preventDefault();
    closeSettings();
  }
});

// The engine's settings: the launcher's values as `RC_*` switches, unless the URL already has that switch (dev
// overrides keep working, e.g. `?RC_GFX_PRESET=performance`). `RC_AUTOSTART=1` skips the launcher for test runs.
function applySettingsToEngine() {
  const params = window.__reracEnv instanceof URLSearchParams
    ? window.__reracEnv
    : new URLSearchParams(window.location.search);
  const set = (key, value) => { if (!params.has(key)) params.set(key, value); };
  set("RC_GFX_PRESET", settings.preset === "custom" ? "original" : settings.preset);
  set("RC_GFX_ANTI_ALIASING", settings.aa);
  set("RC_GFX_DETAIL", settings.detail);
  set("RC_GFX_TEXTURES", settings.textures);
  set("RC_GFX_HUD", settings.hud);
  set("RC_SHADOWS", settings.shadows === "on" ? "1" : "0");
  set("RC_ASPECT", settings.aspect);
  set("RC_RESOLUTION", settings.resolution);
  set("RC_FULLSCREEN", settings.fullscreen === "on" ? "1" : "0");
  set("RC_FPS_LIMIT", settings.fpsLimit);
  set("RC_OCCL", settings.culling === "on" ? "2" : "0");
  set("RC_LOW_LATENCY", settings.lowLatency === "on" ? "1" : "0");
  set("RC_MOUSE_ENABLED", settings.mouseEnabled === "on" ? "1" : "0");
  set("RC_MOUSE_SENSITIVITY", settings.mouseSensitivity);
  set("RC_MODERN_CONTROLS", "0");
  set("RC_FRONTEND", settings.startMode === "front-end" ? "1" : "0");
  if (settings.startMode === "level") set("RC_LEVEL", settings.level);
  window.__reracEnv = params;
}

// ---- cutscene skip ---------------------------------------------------------------------------------------------
// The engine adds `body.cutscene` while a scene runs (crate::web::set_scene_active). The button is a one-shot flag
// read by crate::web::take_skip_request; Backspace (Select) does the same from the keyboard.
skipButton.addEventListener("click", () => {
  window.__reracSkipRequested = true;
  skipButton.blur();
});

// Keep Enter / Backspace from invoking browser navigation while a cinematic is playing; Bevy still receives the keys
// so the shared gamepad mapping can turn either one into the cinematic skip action.
window.addEventListener("keydown", (event) => {
  if ((document.body.classList.contains("cutscene") || document.body.classList.contains("movie")) &&
      (event.key === "Enter" || event.key === "Backspace")) {
    event.preventDefault();
  }
}, { capture: true });

// ---- audio unlock ----------------------------------------------------------------------------------------------
// Browsers start Web Audio suspended until the page has a user gesture.  The engine's
// audio output (rodio -> cpal -> AudioContext) is created while the level loads, before
// any click, so record every context it creates and resume them on the first gesture;
// otherwise the game stays silent even though the mixer is running.
const nativeAudioContext = window.AudioContext || window.webkitAudioContext;
const audioContexts = [];
let audioUnlocked = false;
let browserAudioContext = null;
let browserAudioNextTime = 0;
let browserAudioUnderruns = 0;
let browserAudioFadeIn = true;
const BROWSER_AUDIO_RATE = 48000;
const BROWSER_AUDIO_LEAD = 0.12;
const BROWSER_AUDIO_RECOVERY_FADE_FRAMES = Math.round(BROWSER_AUDIO_RATE * 0.005);

// Schedule small PCM blocks ahead on the WebAudio clock. cpal's wasm backend services
// AudioBufferSourceNode callbacks from the page thread; a busy game frame can therefore
// delay the callback itself. These scheduled buffers keep already-mixed audio playing
// while WebGPU and the game update catch up.
function browserAudio() {
  if (browserAudioContext || !nativeAudioContext) return browserAudioContext;
  try {
    browserAudioContext = new window.AudioContext({ latencyHint: "interactive", sampleRate: BROWSER_AUDIO_RATE });
    browserAudioContext.addEventListener("statechange", () => {
      if (browserAudioContext.state !== "running") {
        browserAudioNextTime = 0;
        browserAudioFadeIn = true;
      }
    });
    if (audioUnlocked && browserAudioContext.state === "suspended") {
      browserAudioContext.resume().catch((e) => console.warn("audio: browser output resume failed", e));
    }
  } catch (e) {
    console.warn("audio: could not create browser output", e);
  }
  return browserAudioContext;
}

function scheduleBrowserAudio(samples) {
  const ctx = browserAudio();
  if (!ctx || ctx.state !== "running" || samples.length < 2) {
    browserAudioNextTime = 0;
    browserAudioFadeIn = true;
    return;
  }
  const frames = Math.floor(samples.length / 2);
  const now = ctx.currentTime;
  if (browserAudioNextTime === 0) browserAudioNextTime = now + BROWSER_AUDIO_LEAD;
  else if (browserAudioNextTime < now) {
    browserAudioUnderruns++;
    // Resume at the current clock. The missed interval was already silent; adding
    // another recovery delay would make a short hiccup sound much longer.
    browserAudioNextTime = now;
    browserAudioFadeIn = true;
  }
  try {
    const buffer = ctx.createBuffer(2, frames, BROWSER_AUDIO_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      const gain = browserAudioFadeIn && i < BROWSER_AUDIO_RECOVERY_FADE_FRAMES
        ? (i + 1) / BROWSER_AUDIO_RECOVERY_FADE_FRAMES
        : 1;
      left[i] = samples[i * 2] / 32768 * gain;
      right[i] = samples[i * 2 + 1] / 32768 * gain;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => source.disconnect();
    source.start(browserAudioNextTime);
    browserAudioNextTime += frames / BROWSER_AUDIO_RATE;
    browserAudioFadeIn = false;
  } catch (e) {
    browserAudioNextTime = 0;
    browserAudioFadeIn = true;
    console.warn("audio: could not schedule browser output", e);
  }
}

function queuedBrowserAudio() {
  const ctx = browserAudioContext;
  if (!ctx || ctx.state !== "running" || browserAudioNextTime <= 0) return 0;
  return Math.max(0, Math.ceil((browserAudioNextTime - ctx.currentTime) * BROWSER_AUDIO_RATE));
}

if (nativeAudioContext) {
  const TrackedAudioContext = function (...args) {
    const ctx = new nativeAudioContext(...args);
    audioContexts.push(ctx);
    ctx.addEventListener("statechange", () => console.log(`audio: AudioContext ${ctx.state}`));
    if (audioUnlocked || (navigator.userActivation && navigator.userActivation.hasBeenActive)) {
      ctx.resume().catch((e) => console.warn("audio: resume failed", e));
    }
    return ctx;
  };
  TrackedAudioContext.prototype = nativeAudioContext.prototype;
  try {
    Object.defineProperty(window, "AudioContext", { value: TrackedAudioContext, configurable: true, writable: true });
    if (window.webkitAudioContext) window.webkitAudioContext = TrackedAudioContext;
  } catch (e) {
    console.warn("audio: could not track AudioContext", e);
  }
}
function unlockAudio() {
  audioUnlocked = true;
  for (const ctx of audioContexts) {
    if (ctx.state === "suspended") {
      ctx.resume().then(() => console.log("audio: AudioContext resumed")).catch((e) => console.warn("audio: resume failed", e));
    }
  }
}
for (const event of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
  window.addEventListener(event, unlockAudio, { capture: true });
}
window.__reracAudio = {
  contexts: audioContexts,
  unlock: unlockAudio,
  schedule: scheduleBrowserAudio,
  queuedSamples: queuedBrowserAudio,
  underruns: () => browserAudioUnderruns,
};

// Console capture so the test harness can read the engine's own log lines.
window.__reracLogs = [];
for (const level of ["log", "warn", "error", "info"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try {
      window.__reracLogs.push({ level, t: Date.now(), text: args.map(String).join(" ") });
      if (window.__reracLogs.length > 2000) window.__reracLogs.shift();
    } catch {}
    original(...args);
  };
}
window.addEventListener("error", (e) => window.__reracLogs.push({ level: "error", t: Date.now(), text: `window.onerror: ${e.message}` }));
window.addEventListener("unhandledrejection", (e) => window.__reracLogs.push({ level: "error", t: Date.now(), text: `unhandledrejection: ${e.reason && e.reason.stack || e.reason}` }));
window.__rerac = { started: false, failed: false, settings };

function setStatus(text, progress) {
  statusText.textContent = text;
  if (progress !== undefined) statusBar.style.width = `${Math.round(progress * 100)}%`;
}

async function loadPagesEngineWasm() {
  const response = await fetch(new URL("./pkg/rerac_bg.wasm.gz", import.meta.url));
  if (!response.ok) throw new Error(`Could not load the compressed game engine (HTTP ${response.status}).`);
  if (!response.body || typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot unpack the game engine. Use a recent Chromium browser.");
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function fail(err) {
  window.__rerac.failed = true;
  console.error(err);
  launcher.classList.add("hidden");
  settingsModal.classList.add("hidden");
  status.classList.remove("hidden");
  status.classList.add("error");
  status.querySelector("h1").textContent = "WebRAC could not start";
  statusText.textContent = "The browser console has the full log.";
  statusLog.textContent = String(err && err.stack ? err.stack : err);
  hint.classList.remove("show");
  clearTimeout(hintTimer);
}

let bytesServed = 0;
let requests = 0;
let lastStatus = 0;

// Same-origin synchronous read used by `rc_formats::web::read` (`#[wasm_bindgen] extern "C"`).
window.readGameFile = function readGameFile(path) {
  const relativePath = canonicalDataPath(path);
  if (!relativePath) throw new Error(`readGameFile(${path}): invalid game-data path`);
  let url;
  if (selectedIsoFiles) {
    const entry = selectedIsoFiles.get(relativePath.toLowerCase());
    if (!entry) throw new Error(`readGameFile(${relativePath}): this file is missing from the indexed ISO. Choose a complete supported image again.`);
    let objectUrl = gameFileObjectUrls.get(relativePath.toLowerCase());
    if (!objectUrl) {
      const blob = selectedIsoFile.slice(entry.offset, entry.offset + entry.bytes);
      if (blob.size !== entry.bytes) throw new Error(`readGameFile(${relativePath}): the selected ISO file range is no longer available.`);
      objectUrl = URL.createObjectURL(blob);
      gameFileObjectUrls.set(relativePath.toLowerCase(), objectUrl);
    }
    url = objectUrl;
  } else if (selectedGameFiles) {
    const file = selectedGameFiles.get(relativePath.toLowerCase());
    if (!file) throw new Error(`readGameFile(${relativePath}): this file is missing from the selected game-data folder. Choose a complete extraction again.`);
    let objectUrl = gameFileObjectUrls.get(relativePath.toLowerCase());
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file);
      gameFileObjectUrls.set(relativePath.toLowerCase(), objectUrl);
    }
    url = objectUrl;
  } else if (localGameDataAvailable) {
    url = new URL("data/" + relativePath, document.baseURI);
  } else {
    throw new Error(`readGameFile(${relativePath}): choose an extracted game-data folder or supported USA ISO before starting WebRAC.`);
  }
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false); // synchronous on purpose: the Rust/WASM engine's loaders block
  // A synchronous XHR cannot use responseType = "arraybuffer" in Chromium.
  // The x-user-defined charset maps every byte to one char code, so `responseText` is the file.
  xhr.overrideMimeType("text/plain; charset=x-user-defined");
  try {
    xhr.send(null);
  } catch (e) {
    throw new Error(`readGameFile(${relativePath}): ${e}; if the game data is on removable storage, reconnect it and choose the folder again`);
  }
  if (xhr.status !== 200) {
    const source = selectedIsoFiles ? "the selected ISO or removable drive" : selectedGameFiles ? "the selected folder or removable drive" : "the extracted data served at /data/";
    throw new Error(`readGameFile(${relativePath}): HTTP ${xhr.status}; check ${source} and choose the folder again if needed`);
  }
  const text = xhr.responseText;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  bytesServed += bytes.length;
  requests += 1;
  const now = performance.now();
  if (now - lastStatus > 250) {
    lastStatus = now;
    setStatus(`Loading ${path} — ${(bytesServed / (1024 * 1024)).toFixed(0)} MiB read…`, 0.35);
  }
  return bytes;
};

async function probeLocalGameData() {
  try {
    const infoUrl = new URL("data/extract-info.json", document.baseURI);
    const tocUrl = new URL("data/toc.bin", document.baseURI);
    const [infoResponse, tocResponse] = await Promise.all([
      fetch(infoUrl, { cache: "no-store" }),
      fetch(tocUrl, { method: "HEAD", cache: "no-store" }),
    ]);
    if (!infoResponse.ok || !tocResponse.ok) throw new Error("No local /data/ folder was found");
    validateGameDataInfo(await infoResponse.json());
    localGameDataAvailable = true;
    if (!selectedGameFiles && !selectedIsoFiles) {
      setGameDataStatus("Local extracted game data found. Ready to play, or choose another folder or ISO above.", "ready");
    }
  } catch {
    localGameDataAvailable = false;
    if (!selectedGameFiles && !selectedIsoFiles) {
      setGameDataStatus("Choose an extracted folder or supported USA ISO to continue. This page does not include game files.", "empty");
    }
  } finally {
    localGameDataProbeComplete = true;
  }
}

// The engine writes progress with console.log; surface the important lines on the loading screen.
const nativeLog = console.log;
console.log = (...args) => {
  nativeLog(...args);
  const line = args.map(String).join(" ");
  if (/^(data|level \d\d|audio|rc-data|level switch)/.test(line)) setStatus(line, 0.6);
};

window.addEventListener("error", (e) => fail(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => fail(e.reason));

let starting = false;

async function startGame() {
  if (starting || window.__rerac.started) return;
  starting = true;
  if (!selectedGameFiles && !localGameDataProbeComplete && localDataProbePromise) await localDataProbePromise;
  if (!gameDataIsAvailable()) {
    starting = false;
    setGameDataStatus("Choose a complete extracted folder or supported USA ISO before pressing Play.", "empty");
    return;
  }
  // Fullscreen must be requested directly from the Play gesture; the Rust window
  // setting applies again after the renderer starts.
  if (settings.fullscreen === "on" && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch((e) => console.warn("display: fullscreen request failed", e));
  }
  launcher.classList.add("hidden");
  settingsModal.classList.add("hidden");
  status.classList.remove("hidden");
  status.classList.remove("error");
  status.querySelector("h1").textContent = "WebRAC";
  statusText.textContent = "Starting…";
  statusLog.textContent = "";
  try {
    if (!("gpu" in navigator)) {
      throw new Error("WebGPU is not available in this browser. WebRAC needs a Chromium-based browser with WebGPU (Chrome/Edge 113+ or Chromium).");
    }
    applySettingsToEngine();
    setStatus("Loading the engine…", 0.1);
    const { default: init } = await import("./pkg/rerac.js");
    setStatus("Starting the engine…", 0.2);
    const engineWasm = await loadPagesEngineWasm();
    await init({ module_or_path: engineWasm });
    window.__rerac.started = true;
    // `main` runs at wasm start (wasm-bindgen's generated start calls it); the event loop takes over.
    const hide = () => { status.classList.add("hidden"); showHint(9); };
    const waitForCanvas = () => {
      if (document.querySelector("canvas")) setTimeout(hide, 800);
      else setTimeout(waitForCanvas, 200);
    };
    waitForCanvas();
    console.log("WebRAC: engine started");
  } catch (e) {
    fail(e);
  }
}

playButton.addEventListener("click", startGame);

// A launcher is the normal path. `RC_AUTOSTART=1` (a test run) starts immediately with the saved settings.
localDataProbePromise = probeLocalGameData();
if (new URLSearchParams(window.location.search).get("RC_AUTOSTART") === "1") localDataProbePromise.then(startGame);
