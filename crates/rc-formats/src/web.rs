//! Game-data file access in the browser build.
//!
//! The native runtime reads the extracted data folder with `std::fs`.  A `wasm32-unknown-unknown`
//! build has no filesystem, so the web shell installs `window.readGameFile(path)`, which returns
//! bytes from either a browser-selected local File (through a blob URL) or the development server's
//! `/data/` route. The call is synchronous on purpose: the engine's loaders are synchronous, and
//! this prototype loads one level before the first frame. It blocks the main thread while a file is
//! read, which is covered by the loading screen.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    /// `window.readGameFile(path) -> Uint8Array`; throws on a missing file or an HTTP error.
    #[wasm_bindgen(catch, js_namespace = window, js_name = readGameFile)]
    fn js_read_game_file(path: &str) -> Result<js_sys::Uint8Array, JsValue>;
}

/// The bytes of a file relative to the data folder (`levels/01/core_data.bin`, `boot/SCUS_971.99`, ...).
#[cfg(target_arch = "wasm32")]
pub fn read(rel: &str) -> std::io::Result<Vec<u8>> {
    js_read_game_file(rel).map(|a| a.to_vec()).map_err(|e| {
        let text = if let Some(s) = e.as_string() {
            s
        } else if let Some(err) = e.dyn_ref::<js_sys::Error>() {
            String::from(err.message())
        } else {
            format!("{e:?}")
        };
        std::io::Error::new(std::io::ErrorKind::NotFound, format!("{rel}: {text}"))
    })
}
