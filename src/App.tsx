import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { classify, buildPreview, type LoadedFile } from "./preview";
import "./tokens.css";
import "./App.css";

const RECENTS_KEY = "fev.recents";
const MAX_RECENTS = 8;

interface Recent {
  path: string;
  name: string;
  // In-app display name. Renaming a recent never touches the file on disk —
  // useful because artifacts are often all named index.html.
  alias?: string;
}

function loadRecents(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecents(list: Recent[]) {
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

const displayName = (r: Recent) => r.alias?.trim() || r.name;

function App() {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<Recent[]>(loadRecents);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem("fev.sidebarWidth")) || 230,
  );
  const resizing = useRef(false);
  const [isResizing, setIsResizing] = useState(false);

  async function loadPath(path: string) {
    setError(null);
    try {
      const loaded = await invoke<LoadedFile>("read_file", { path });
      setFile(loaded);
      pushRecent({ path: loaded.path, name: loaded.name });
    } catch (e) {
      setError(String(e));
    }
  }

  function pushRecent(r: Recent) {
    setRecents((prev) => {
      const existing = prev.find((p) => p.path === r.path);
      // Keep a previously set alias when reopening the same file.
      const merged = existing?.alias ? { ...r, alias: existing.alias } : r;
      const next = [merged, ...prev.filter((p) => p.path !== r.path)].slice(
        0,
        MAX_RECENTS,
      );
      saveRecents(next);
      return next;
    });
  }

  function removeRecent(path: string) {
    setRecents((prev) => {
      const next = prev.filter((p) => p.path !== path);
      saveRecents(next);
      return next;
    });
    setMenuPath(null);
    // If the removed file is the one on screen, clear the preview.
    setFile((cur) => (cur?.path === path ? null : cur));
    if (file?.path === path) setError(null);
  }

  function openLocation(path: string) {
    setMenuPath(null);
    revealItemInDir(path).catch((e) => setError(String(e)));
  }

  function startRename(r: Recent) {
    setEditPath(r.path);
    setEditValue(displayName(r));
    setMenuPath(null);
  }

  function commitRename() {
    if (editPath === null) return;
    const path = editPath;
    const value = editValue.trim();
    setRecents((prev) => {
      const next = prev.map((p) =>
        p.path === path ? { ...p, alias: value || undefined } : p,
      );
      saveRecents(next);
      return next;
    });
    setEditPath(null);
  }

  async function openDialog() {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Front-end", extensions: ["html", "htm", "jsx", "tsx", "css"] },
      ],
    });
    if (typeof selected === "string") loadPath(selected);
  }

  // OS file drag-and-drop onto the window.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths.length) {
        loadPath(event.payload.paths[0]);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Close the kebab menu when clicking anywhere else.
  useEffect(() => {
    if (menuPath === null) return;
    const close = () => setMenuPath(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuPath]);

  // Drag the sidebar's right edge to resize. Sidebar is leftmost, so the
  // pointer's clientX is the target width (clamped).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.min(480, Math.max(170, e.clientX));
      setSidebarWidth(w);
    };
    const up = () => {
      if (!resizing.current) return;
      resizing.current = false;
      setIsResizing(false);
      localStorage.setItem("fev.sidebarWidth", String(sidebarWidth));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [sidebarWidth]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizing.current = true;
    setIsResizing(true);
  }

  const kind = file ? classify(file.ext) : null;
  const preview = file ? buildPreview(file) : null;

  return (
    <div className={`app${sidebarOpen ? "" : " app--collapsed"}`}>
      {/* Transparent overlay during drag so the iframe doesn't eat mouse moves. */}
      {isResizing && <div className="resize-overlay" />}

      {!sidebarOpen && (
        <button
          className="reveal-btn"
          title="Show sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          »
        </button>
      )}

      {sidebarOpen && (
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="brand-row">
            <div className="brand">F.E.V</div>
            <button
              className="collapse-btn"
              title="Hide sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              «
            </button>
          </div>
          <button className="open-btn" onClick={openDialog}>
            Open file…
          </button>

        <div className="recents-label">Recent</div>
        <ul className="recents">
          {recents.map((r) => (
            <li
              key={r.path}
              className={file?.path === r.path ? "active" : ""}
              title={r.path}
              onClick={() => editPath !== r.path && loadPath(r.path)}
            >
              {editPath === r.path ? (
                <input
                  className="rename-input"
                  autoFocus
                  value={editValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditPath(null);
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <>
                  <span className="label">{displayName(r)}</span>
                  <button
                    className="kebab"
                    title="More"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuPath(menuPath === r.path ? null : r.path);
                    }}
                  >
                    ⋮
                  </button>
                </>
              )}

              {menuPath === r.path && (
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openLocation(r.path)}>
                    Open file location
                  </button>
                  <button onClick={() => startRename(r)}>Rename</button>
                  <button className="danger" onClick={() => removeRecent(r.path)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
          </ul>
        </aside>
      )}

      {sidebarOpen && (
        <div
          className="resizer"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      )}

      <main className="preview">
        {!file && (
          <div className="dropzone">
            <p>Drag a file here, or click <b>Open file…</b></p>
            <p className="muted">.html · .jsx · .tsx · .css</p>
          </div>
        )}

        {file && (
          <>
            <div className="topbar">
              <span className="filename">{file.name}</span>
              <span className={`badge badge-${kind}`}>{file.ext}</span>
            </div>

            {error && <div className="error">{error}</div>}

            {/* Real .html served over fev:// so relative assets resolve. Its
                own origin (distinct from the app) makes allow-same-origin safe
                here, enabling localStorage/fonts the page may use. */}
            {preview?.mode === "src" && (
              <iframe
                key={preview.url}
                className="frame"
                title="preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                src={preview.url}
              />
            )}

            {/* Generated docs (React shell, CSS sample) stay opaque-origin so
                artifact code can't reach the parent app. */}
            {preview?.mode === "srcdoc" && (
              <iframe
                key={file.path}
                className="frame"
                title="preview"
                sandbox="allow-scripts allow-forms allow-popups allow-modals"
                srcDoc={preview.doc}
              />
            )}

            {preview === null && (
              <div className="notyet">
                <p>
                  <b>{file.ext}</b> preview not supported.
                </p>
                <p className="muted">Try a .html, .jsx, .tsx, or .css file.</p>
                <pre className="source">{file.content.slice(0, 4000)}</pre>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
