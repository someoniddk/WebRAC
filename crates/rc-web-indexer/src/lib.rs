#![cfg(target_arch = "wasm32")]

//! Small browser helper for hashing an ISO and indexing its file ranges.
//! The actual image bytes stay in the browser's selected `File`; `rc-formats`
//! reads only the sectors needed to inspect the filesystem and Ratchet & Clank TOC.

use js_sys::{Array, Object, Reflect, Uint8Array};
use md5::{Digest, Md5};
use std::io::{self, Read, Seek, SeekFrom};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = window, js_name = readIsoBytes)]
    fn js_read_iso_bytes(offset: f64, length: usize) -> Result<Uint8Array, JsValue>;
}

/// Incremental MD5 state used by the file-hashing worker.
#[wasm_bindgen]
pub struct Md5Hasher {
    inner: Option<Md5>,
}

#[wasm_bindgen]
impl Md5Hasher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Md5Hasher { Md5Hasher { inner: Some(Md5::new()) } }

    /// Add one file chunk to the hash.
    pub fn update(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let Some(inner) = self.inner.as_mut() else { return Err(js_error("MD5 state is already finished")) };
        inner.update(bytes);
        Ok(())
    }

    /// Finish the hash and return its lowercase hexadecimal form.
    pub fn finish(&mut self) -> Result<String, JsValue> {
        let Some(inner) = self.inner.take() else { return Err(js_error("MD5 state is already finished")) };
        Ok(inner.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
    }
}

/// Parse the selected ISO and return the Tier 0 files as `{path, offset, bytes}` records.
/// Each record points into the original image; no game files are extracted or persisted.
#[wasm_bindgen]
pub fn index_disc_image(image_size: f64) -> Result<Array, JsValue> {
    if !image_size.is_finite() || image_size < 0.0 || image_size.fract() != 0.0 || image_size > u64::MAX as f64 {
        return Err(js_error("invalid ISO file size"));
    }
    let image = rc_formats::iso9660::IsoImage::new(BrowserIsoReader { size: image_size as u64, cursor: 0 })
        .map_err(|e| js_error(format!("the image is not a readable ISO 9660 disc: {e}")))?;
    let disc = rc_formats::disc::Disc::new(image)
        .map_err(|e| js_error(format!("the disc table of contents could not be read: {e}")))?;
    let files = disc.archive_files()
        .map_err(|e| js_error(format!("the disc file index could not be built: {e}")))?;

    let records = Array::new();
    for file in files {
        let record = Object::new();
        set_property(&record, "path", JsValue::from_str(&file.path))?;
        set_property(&record, "offset", JsValue::from_f64(file.offset as f64))?;
        set_property(&record, "bytes", JsValue::from_f64(file.bytes as f64))?;
        records.push(&record);
    }
    Ok(records)
}

struct BrowserIsoReader {
    size: u64,
    cursor: u64,
}

impl Read for BrowserIsoReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        let remaining = self.size.saturating_sub(self.cursor);
        let count = usize::try_from(remaining).unwrap_or(output.len()).min(output.len());
        if count == 0 { return Ok(0); }
        let bytes = js_read_iso_bytes(self.cursor as f64, count).map_err(js_io_error)?;
        if bytes.length() as usize != count {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "short read from selected ISO file"));
        }
        bytes.copy_to(&mut output[..count]);
        self.cursor += count as u64;
        Ok(count)
    }
}

impl Seek for BrowserIsoReader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let next = match position {
            SeekFrom::Start(offset) => i128::from(offset),
            SeekFrom::Current(offset) => i128::from(self.cursor) + i128::from(offset),
            SeekFrom::End(offset) => i128::from(self.size) + i128::from(offset),
        };
        if !(0..=i128::from(u64::MAX)).contains(&next) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "ISO seek is outside the supported range"));
        }
        self.cursor = next as u64;
        Ok(self.cursor)
    }
}

fn set_property(object: &Object, name: &str, value: JsValue) -> Result<(), JsValue> {
    if Reflect::set(object, &JsValue::from_str(name), &value)? { Ok(()) }
    else { Err(js_error(format!("could not add {name} to the ISO index"))) }
}

fn js_error(message: impl AsRef<str>) -> JsValue { JsValue::from_str(message.as_ref()) }

fn js_io_error(error: JsValue) -> io::Error {
    let message = error.as_string().unwrap_or_else(|| format!("{error:?}"));
    io::Error::new(io::ErrorKind::Other, message)
}
