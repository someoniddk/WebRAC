//! Monotonic clock.
//!
//! `std::time::Instant::now` panics on `wasm32-unknown-unknown` (std's time support there is
//! unsupported), while the browser has `performance.now`.  Bevy already solves this in
//! `bevy_platform::time`, so the engine takes its clock from there on the web build.

#[cfg(not(target_arch = "wasm32"))]
pub use std::time::Instant;

#[cfg(target_arch = "wasm32")]
pub use bevy::platform::time::Instant;
