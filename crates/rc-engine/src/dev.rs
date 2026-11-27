//! `RC_DEV_LOG=1`: diagnostic lines for first-use asset builds (a moby class's meshes and materials, an extra
//! instance's parts) and the pipelines they compile. Off by default; the browser bridge reads the page query string
//! (`?RC_DEV_LOG=1`), like the other `RC_*` controls (`crate::web`).

use std::sync::OnceLock;

/// Whether `RC_DEV_LOG=1` is set (read once).
pub fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| crate::web::var("RC_DEV_LOG").is_some_and(|v| v.trim() == "1"))
}

/// One diagnostic line (`RC_DEV_LOG`). `println!` would be dropped in the browser (`stdout` is a stub there):
/// Bevy's log reaches the page console on wasm and the terminal natively.
pub fn log(args: std::fmt::Arguments<'_>) {
    if !enabled() { return; }
    bevy::log::info!("{args}");
}
