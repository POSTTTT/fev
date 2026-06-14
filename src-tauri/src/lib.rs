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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
