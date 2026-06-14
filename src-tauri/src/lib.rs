use std::path::Path;

/// Read a file from disk and return its contents plus detected kind.
/// Used by the frontend to load a file the user opened or dragged in.
#[tauri::command]
fn read_file(path: String) -> Result<LoadedFile, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let name = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    Ok(LoadedFile {
        path,
        name,
        ext,
        content,
    })
}

#[derive(serde::Serialize)]
struct LoadedFile {
    path: String,
    name: String,
    ext: String,
    content: String,
}

/// Decode %XX percent-escapes in a URL path. No-op when none are present, so
/// it is safe whether or not the webview already decoded the request.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Content-Type for a file extension. Keeps text types tagged utf-8 so the
/// webview parses them correctly; falls back to octet-stream.
fn mime_for(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "jsx" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Serve the previewed file and its relative assets. The full absolute
        // path travels in the URL path (slashes preserved), so the webview
        // resolves relative refs and @import chains itself — including paths
        // that climb above the file's own folder. Reachable as
        // fev://localhost/<path> (http://fev.localhost/<path> on Windows).
        .register_uri_scheme_protocol("fev", |_ctx, request| {
            let raw = request.uri().path();
            let fs_path = percent_decode(raw.trim_start_matches('/'));
            match std::fs::read(&fs_path) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header("Content-Type", mime_for(&fs_path))
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .unwrap(),
                Err(e) => tauri::http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .body(format!("fev: cannot read {fs_path}: {e}").into_bytes())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
