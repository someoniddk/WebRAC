//! Browser glue for the wasm build: a panic hook that reaches the browser console.
//!
//! A panic on `wasm32-unknown-unknown` otherwise aborts with `RuntimeError: unreachable executed`
//! and the message is lost (Rust's stderr is a stub in the browser).  Bevy installs its own hook
//! once `LogPlugin` runs, but a panic during the boot-time level load happens before the app is
//! built, so install this one at the top of `main`.

#[cfg(target_arch = "wasm32")]
mod hook {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = console, js_name = error)]
        fn console_error(s: &str);
    }

    // Browser dev variables, the wasm equivalent of the `RC_*` environment variables: the page's query string,
    // e.g. `?RC_FRAME_LOG=1&RC_HERO_AT=253.13,186.67,95.57,2.5066`. The page may also set `window.__reracEnv`
    // (a URLSearchParams-like object) before the engine starts, or call `.set` on the one made here.
    #[wasm_bindgen(inline_js = "
        export function rerac_dev_env(name) {
            const p = window.__reracEnv || (window.__reracEnv = new URLSearchParams(window.location.search));
            const v = p.get(name);
            return v === null ? undefined : String(v);
        }
        export function rerac_take_skip() {
            const v = window.__reracSkipRequested === true;
            window.__reracSkipRequested = false;
            return v;
        }
        export function rerac_scene_active(on) {
            document.body.classList.toggle('cutscene', !!on);
        }
        export function rerac_movie_active(on) {
            document.body.classList.toggle('movie', !!on);
        }
        export function rerac_local_time() {
            const d = new Date();
            return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].join(',');
        }
        export function rerac_audio_frame(samples) {
            window.__reracAudio?.schedule(samples);
        }
        export function rerac_audio_queued() {
            return window.__reracAudio?.queuedSamples() || 0;
        }
        export function rerac_audio_underruns() {
            return window.__reracAudio?.underruns() || 0;
        }
        export function rerac_save_display_settings(aspect, resolution, fullscreen) {
            try {
                const key = 'rerac.launcher.settings.v1';
                const settings = JSON.parse(localStorage.getItem(key) || '{}');
                settings.aspect = aspect;
                settings.resolution = resolution;
                settings.fullscreen = fullscreen ? 'on' : 'off';
                localStorage.setItem(key, JSON.stringify(settings));
            } catch (e) {
                console.warn('display: could not save browser settings', e);
            }
        }
    ")]
    extern "C" {
        #[wasm_bindgen(js_name = rerac_dev_env)]
        fn dev_env(name: &str) -> Option<String>;
        #[wasm_bindgen(js_name = rerac_take_skip)]
        fn take_skip() -> bool;
        #[wasm_bindgen(js_name = rerac_scene_active)]
        fn scene_active(on: bool);
        #[wasm_bindgen(js_name = rerac_movie_active)]
        fn movie_active(on: bool);
        #[wasm_bindgen(js_name = rerac_local_time)]
        fn local_time_string() -> Option<String>;
        #[wasm_bindgen(js_name = rerac_audio_frame)]
        fn audio_frame_js(samples: &[i16]);
        #[wasm_bindgen(js_name = rerac_audio_queued)]
        fn audio_queued_js() -> u32;
        #[wasm_bindgen(js_name = rerac_audio_underruns)]
        fn audio_underruns_js() -> u32;
        #[wasm_bindgen(js_name = rerac_save_display_settings)]
        fn save_display_settings_js(aspect: &str, resolution: &str, fullscreen: bool);
    }

    pub fn install() {
        std::panic::set_hook(Box::new(|info| {
            console_error(&format!("Rust panic: {info}"));
        }));
    }

    pub fn error(msg: &str) {
        console_error(msg);
    }

    pub fn var(name: &str) -> Option<String> {
        dev_env(name)
    }

    /// The page's Skip button was clicked since the last call (one-shot).
    pub fn take_skip_request() -> bool {
        take_skip()
    }

    /// Shows / hides the page's cutscene Skip button.
    pub fn set_scene_active(on: bool) {
        scene_active(on);
    }

    /// Shows / hides the browser cinematic controls during pre-rendered movies.
    pub fn set_movie_active(on: bool) { movie_active(on); }

    /// The browser's local wall clock, used for save-file timestamps.
    pub fn local_time() -> Option<[u64; 6]> {
        let s = local_time_string()?;
        let v: Vec<u64> = s.split(',').map(str::parse).collect::<Result<_, _>>().ok()?;
        v.try_into().ok()
    }

    /// Sends interleaved stereo PCM samples to the browser's scheduled WebAudio output.
    pub fn audio_frame(samples: &[i16]) { audio_frame_js(samples); }
    pub fn audio_queued() -> u32 { audio_queued_js() }
    pub fn audio_underruns() -> u32 { audio_underruns_js() }
    pub fn save_display_settings(aspect: &str, resolution: &str, fullscreen: bool) {
        save_display_settings_js(aspect, resolution, fullscreen);
    }
}

#[cfg(target_arch = "wasm32")]
pub use hook::{audio_frame, audio_queued, audio_underruns, error, install, local_time, save_display_settings, set_movie_active, set_scene_active, take_skip_request, var};

/// A dev control's value: `std::env::var` natively, the page's query string in the browser (`?RC_...=...`).
#[cfg(not(target_arch = "wasm32"))]
pub fn var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// The page's Skip button (native: no page, never requested).
#[cfg(not(target_arch = "wasm32"))]
pub fn take_skip_request() -> bool { false }

/// The page's cutscene Skip button (native: no page).
#[cfg(not(target_arch = "wasm32"))]
pub fn set_scene_active(_on: bool) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn set_movie_active(_on: bool) {}

#[cfg(not(target_arch = "wasm32"))]
pub fn install() {}

#[cfg(not(target_arch = "wasm32"))]
pub fn error(_msg: &str) {}
