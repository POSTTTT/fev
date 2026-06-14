import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { classify, buildPreview, type LoadedFile } from "./preview";
import "./App.css";

const RECENTS_KEY = "fev.recents";
const MAX_RECENTS = 8;

interface Recent {
  path: string;
  name: string;
}

function loadRecents(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function App() {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<Recent[]>(loadRecents);

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
      const next = [r, ...prev.filter((p) => p.path !== r.path)].slice(
        0,
        MAX_RECENTS,
      );
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
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

  const kind = file ? classify(file.ext) : null;
  const preview = file ? buildPreview(file) : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">fev</div>
        <button className="open-btn" onClick={openDialog}>
          Open file…
        </button>

        <div className="recents-label">Recent</div>
        <ul className="recents">
          {recents.length === 0 && <li className="muted">none yet</li>}
          {recents.map((r) => (
            <li
              key={r.path}
              className={file?.path === r.path ? "active" : ""}
              title={r.path}
              onClick={() => loadPath(r.path)}
            >
              {r.name}
            </li>
          ))}
        </ul>
      </aside>

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
