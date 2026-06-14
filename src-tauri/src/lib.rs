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

#[derive(serde::Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

// Noise directories never worth showing in the file tree.
const IGNORED_DIRS: [&str; 6] = [
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    ".venv",
];

/// List one directory's immediate children (lazy — the tree calls this per
/// folder on expand). Folders first, then files, each alphabetical.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = Vec::new();
    for dent in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let dent = match dent {
            Ok(d) => d,
            Err(_) => continue,
        };
        let name = dent.file_name().to_string_lossy().into_owned();
        let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        entries.push(Entry {
            name,
            path: dent.path().to_string_lossy().into_owned(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
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

// ---------------------------------------------------------------------------
// Project runner — start a real frontend project's dev server (Vite/Next/…)
// so its output can be shown in the preview, without using the terminal.
// ---------------------------------------------------------------------------

/// Holds the running dev-server child process so it can be killed later.
struct DevState(std::sync::Mutex<Option<std::process::Child>>);

#[derive(serde::Serialize)]
struct ProjectInfo {
    is_project: bool,
    dev_script: Option<String>,
    package_manager: String,
    has_node_modules: bool,
    name: Option<String>,
}

fn detect_pm(path: &Path) -> String {
    if path.join("pnpm-lock.yaml").exists() {
        "pnpm".into()
    } else if path.join("yarn.lock").exists() {
        "yarn".into()
    } else if path.join("bun.lockb").exists() {
        "bun".into()
    } else {
        "npm".into()
    }
}

/// Inspect a folder: is it a JS project, which dev script + package manager,
/// and are deps installed?
#[tauri::command]
fn detect_project(path: String) -> ProjectInfo {
    let dir = Path::new(&path);
    let mut info = ProjectInfo {
        is_project: false,
        dev_script: None,
        package_manager: detect_pm(dir),
        has_node_modules: dir.join("node_modules").is_dir(),
        name: None,
    };
    if let Ok(txt) = std::fs::read_to_string(dir.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            info.is_project = true;
            info.name = v.get("name").and_then(|n| n.as_str()).map(String::from);
            if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                for key in ["dev", "start"] {
                    if scripts.contains_key(key) {
                        info.dev_script = Some(key.to_string());
                        break;
                    }
                }
            }
        }
    }
    info
}

/// Build a command that runs a package-manager subcommand in `dir`.
/// On Windows npm/pnpm/yarn are .cmd shims, so go through `cmd /C`.
fn pm_command(pm: &str, args: &[&str], dir: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    let mut c = {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(pm);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut c = std::process::Command::new(pm);
    c.args(args);
    c.current_dir(dir);
    c
}

/// Kill a child and its whole process tree (the cmd shim spawns node).
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .status();
    }
    let _ = child.kill();
}

fn stop_inner(state: &DevState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            kill_tree(&mut child);
        }
    }
}

#[tauri::command]
fn stop_dev(state: tauri::State<DevState>) {
    stop_inner(&state);
}

/// Remove ANSI escape sequences (e.g. Vite bolds the port: localhost:\e[1m5173).
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Skip the CSI sequence up to its final letter.
            for n in chars.by_ref() {
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Find a dev-server URL in a log line (http://localhost:PORT etc).
fn find_url(line: &str) -> Option<String> {
    let i = line.find("http://").or_else(|| line.find("https://"))?;
    let url: String = line[i..]
        .chars()
        .take_while(|c| !c.is_whitespace() && (*c as u32) >= 0x20 && *c != '\u{1b}')
        .collect();
    if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0") {
        Some(url.replace("0.0.0.0", "localhost"))
    } else {
        None
    }
}

fn tail(s: &str) -> String {
    let start = s.len().saturating_sub(1500);
    s[start..].to_string()
}

/// Start the project's dev server, installing deps first if missing, and
/// return the local URL once the server reports it.
#[tauri::command]
fn run_dev(path: String, state: tauri::State<DevState>) -> Result<String, String> {
    stop_inner(&state);

    let info = detect_project(path.clone());
    let script = info
        .dev_script
        .ok_or("No \"dev\" or \"start\" script in package.json")?;
    let pm = info.package_manager;

    // F.E.V never modifies the project. If deps aren't installed, refuse.
    if !info.has_node_modules {
        return Err(format!(
            "Dependencies not installed. Run `{pm} install` in the project first."
        ));
    }

    let mut child = pm_command(&pm, &["run", &script], &path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start dev server: {e}"))?;

    use std::io::BufRead;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let tx2 = tx.clone();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx2.send(line).is_err() {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    let mut log = String::new();
    loop {
        let remaining = match deadline.checked_duration_since(std::time::Instant::now()) {
            Some(d) => d,
            None => {
                kill_tree(&mut child);
                return Err(format!("dev server didn't report a URL in time.\n{}", tail(&log)));
            }
        };
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                let line = strip_ansi(&line);
                log.push_str(&line);
                log.push('\n');
                if let Some(url) = find_url(&line) {
                    // keep draining the pipe so the child doesn't block on a full buffer
                    std::thread::spawn(move || while rx.recv().is_ok() {});
                    *state.0.lock().unwrap() = Some(child);
                    return Ok(url);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                kill_tree(&mut child);
                return Err(format!("dev server timed out.\n{}", tail(&log)));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.wait();
                return Err(format!("dev server exited before reporting a URL.\n{}", tail(&log)));
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .manage(DevState(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
        .invoke_handler(tauri::generate_handler![
            read_file,
            list_dir,
            detect_project,
            run_dev,
            stop_dev
        ])
        .on_window_event(|window, event| {
            // Kill the dev server when the window closes so it doesn't linger.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                stop_inner(&window.state::<DevState>());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
