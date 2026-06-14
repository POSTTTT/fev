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
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
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

  // Close the kebab menu when clicking outside it (but not the click that
  // opened it, nor clicks on the menu/kebab themselves).
  useEffect(() => {
    if (menuPath === null) return;
    const close = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest(".menu") || t.closest(".kebab"))) return;
      setMenuPath(null);
    };
    // Defer attaching so the opening click doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", close);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", close);
    };
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

  // Group recents by file suffix, ordered with the common types first.
  const EXT_ORDER = ["html", "htm", "jsx", "tsx", "js", "ts", "css"];
  const extOf = (r: Recent) => r.name.split(".").pop()?.toLowerCase() ?? "";
  const groupedRecents = (() => {
    const groups = new Map<string, Recent[]>();
    for (const r of recents) {
      const e = extOf(r);
      if (!groups.has(e)) groups.set(e, []);
      groups.get(e)!.push(r);
    }
    const rank = (e: string) => {
      const i = EXT_ORDER.indexOf(e);
      return i === -1 ? EXT_ORDER.length : i;
    };
    return [...groups.entries()].sort(
      ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
    );
  })();

  const renderRecent = (r: Recent) => (
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
              if (menuPath === r.path) {
                setMenuPath(null);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              const MENU_W = 190;
              const MENU_H = 140;
              const x = Math.min(rect.right + 4, window.innerWidth - MENU_W - 8);
              const y = Math.min(rect.bottom + 4, window.innerHeight - MENU_H);
              setMenuPos({ x, y });
              setMenuPath(r.path);
            }}
          >
            ⋮
          </button>
        </>
      )}
    </li>
  );

  // The kebab menu is rendered at the app root (not inside the list item):
  // a transform on .recents li would otherwise become the containing block
  // for this position:fixed menu and the sidebar overflow would clip it.
  const menuRecent = menuPath ? recents.find((r) => r.path === menuPath) : null;
  const menuEl =
    menuRecent && menuPos ? (
      <div
        className="menu"
        style={{ top: menuPos.y, left: menuPos.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={() => openLocation(menuRecent.path)}>
          <IconLocation />
          Open file location
        </button>
        <button onClick={() => startRename(menuRecent)}>
          <IconRename />
          Rename
        </button>
        <div className="menu-sep" />
        <button className="danger" onClick={() => removeRecent(menuRecent.path)}>
          <IconRemove />
          Remove
        </button>
      </div>
    ) : null;

  return (
    <div className={`app${sidebarOpen ? "" : " app--collapsed"}`}>
      {/* Transparent overlay during drag so the iframe doesn't eat mouse moves. */}
      {isResizing && <div className="resize-overlay" />}

      {menuEl}

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
          <div className="recents-scroll">
            {groupedRecents.map(([ext, items]) => (
              <div className="recents-group" key={ext}>
                <div className="recents-group-label">.{ext || "file"}</div>
                <ul className="recents">{items.map(renderRecent)}</ul>
              </div>
            ))}
          </div>
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

// Menu icons — line style (stroke=currentColor) to match the mono theme.
const svg = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 16 16",
};

function IconLocation() {
  return (
    <svg {...svg}>
      <path d="M8 1.8a3.6 3.6 0 0 0-3.6 3.6c0 2.6 3.6 6.8 3.6 6.8s3.6-4.2 3.6-6.8A3.6 3.6 0 0 0 8 1.8z" />
      <circle cx="8" cy="5.4" r="1.4" />
    </svg>
  );
}

function IconRename() {
  return (
    <svg {...svg}>
      <path d="M2.5 11.5 11 3l1.9 1.9-8.5 8.5-2.4.5z" />
      <path d="M10.2 3.8 12.2 5.8" />
    </svg>
  );
}

function IconRemove() {
  return (
    <svg {...svg}>
      <path d="M3 4.3h10M6.4 4.3V2.7h3.2v1.6M4.6 4.3l.6 9h5.6l.6-9" />
    </svg>
  );
}

export default App;
