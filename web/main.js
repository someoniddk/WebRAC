// WebRAC browser shell: a fork based on ReRAC's engine, with game-data access, launcher settings, and wasm start.
//
// The engine's loaders are synchronous (the native port reads the extracted data folder with
// `std::fs`), so the browser build reads the same folder with a synchronous same-origin XHR.
// The engine calls `window.readGameFile("levels/01/core_data.bin")`; the server maps `/data/`
// to the extracted folder.

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
let hintTimer = 0;

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
  const url = new URL("data/" + path.replace(/^\/+/, ""), document.baseURI);
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false); // synchronous on purpose: the engine's loaders block
  // A synchronous XHR cannot use responseType = "arraybuffer" in Chromium.
  // The x-user-defined charset maps every byte to one char code, so `responseText` is the file.
  xhr.overrideMimeType("text/plain; charset=x-user-defined");
  try {
    xhr.send(null);
  } catch (e) {
    throw new Error(`readGameFile(${path}): ${e}`);
  }
  if (xhr.status !== 200) {
    throw new Error(`readGameFile(${path}): HTTP ${xhr.status}; is the extracted data folder served at /data/?`);
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
    await init();
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
if (new URLSearchParams(window.location.search).get("RC_AUTOSTART") === "1") startGame();
