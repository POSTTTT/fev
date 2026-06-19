import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { classify, buildPreview, type LoadedFile } from "./preview";
import { FileTree } from "./FileTree";
import "./tokens.css";
import "./App.css";

const RECENTS_KEY = "fev.recents";
const MAX_RECENTS = 8;
// GitHub repo used for the "check for updates" lookup.
const REPO = "POSTTTT/fev";

// Compare dotted versions numerically: is `latest` newer than `current`?
function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

type UpdateState = {
  status: "idle" | "checking" | "latest" | "available" | "error";
  version?: string;
  url?: string;
  message?: string;
};

// Settings sections. Add an entry here + a branch in the body to grow it.
type SettingsSection = "about";
const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "about", label: "About" },
];

interface ProjectInfo {
  is_project: boolean;
  dev_script: string | null;
  package_manager: string;
  has_node_modules: boolean;
  name: string | null;
}

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
  const [view, setView] = useState<"recent" | "files">("recent");
  // Folder selection is intentionally not restored on launch.
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("fev.recentFolders") ?? "[]");
    } catch {
      return [];
    }
  });
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [devStatus, setDevStatus] = useState<
    "idle" | "starting" | "running" | "error"
  >("idle");
  const [devError, setDevError] = useState<string | null>(null);
  // Which output fills the preview area: an opened file, or the dev server.
  const [activeView, setActiveView] = useState<"file" | "dev">("file");
  const [folderInfoOpen, setFolderInfoOpen] = useState(false);
  const [dontShowFolderInfo, setDontShowFolderInfo] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("about");
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  // App version (from tauri.conf.json) for the About box.
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Route A update check: read the latest GitHub release tag, compare to the
  // running version. No auto-install — just point the user at the download.
  async function checkUpdate() {
    setUpdate({ status: "checking" });
    try {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!r.ok) throw new Error(`GitHub responded ${r.status}`);
      const data = await r.json();
      const latest = String(data.tag_name ?? "").replace(/^v/, "");
      if (latest && appVersion && isNewer(latest, appVersion)) {
        setUpdate({ status: "available", version: latest, url: data.html_url });
      } else {
        setUpdate({ status: "latest" });
      }
    } catch (e) {
      setUpdate({ status: "error", message: String(e) });
    }
  }

  function openSettings() {
    setUpdate({ status: "idle" });
    setSettingsSection("about");
    setSettingsOpen(true);
  }

  function pushRecentFolder(path: string) {
    setRecentFolders((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 6);
      localStorage.setItem("fev.recentFolders", JSON.stringify(next));
      return next;
    });
  }

  function removeRecentFolder(path: string) {
    setRecentFolders((prev) => {
      const next = prev.filter((p) => p !== path);
      localStorage.setItem("fev.recentFolders", JSON.stringify(next));
      return next;
    });
  }

  function selectFolder(path: string) {
    setRootDir(path);
    pushRecentFolder(path);
    setView("files");
  }

  async function openFolder() {
    const selected = await open({ directory: true });
    if (typeof selected === "string") selectFolder(selected);
  }

  // Show the explainer modal before the picker, unless dismissed before.
  function requestOpenFolder() {
    if (localStorage.getItem("fev.hideFolderInfo") === "1") {
      openFolder();
    } else {
      setDontShowFolderInfo(false);
      setFolderInfoOpen(true);
    }
  }

  function confirmFolderInfo() {
    if (dontShowFolderInfo) localStorage.setItem("fev.hideFolderInfo", "1");
    setFolderInfoOpen(false);
    openFolder();
  }

  const folderName = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() ?? p;

  // When the folder changes, stop any running server and re-detect the project.
  useEffect(() => {
    setDevUrl(null);
    setDevStatus("idle");
    setDevError(null);
    invoke("stop_dev").catch(() => {});
    if (rootDir) {
      invoke<ProjectInfo>("detect_project", { path: rootDir })
        .then(setProject)
        .catch(() => setProject(null));
    } else {
      setProject(null);
    }
  }, [rootDir]);

  async function runDev() {
    if (!rootDir) return;
    setDevError(null);
    setDevStatus("starting");
    try {
      const url = await invoke<string>("run_dev", { path: rootDir });
      setDevUrl(url);
      setDevStatus("running");
      setActiveView("dev");
    } catch (e) {
      setDevError(String(e));
      setDevStatus("error");
    }
  }

  function stopDev() {
    invoke("stop_dev").catch(() => {});
    setDevUrl(null);
    setDevStatus("idle");
    setActiveView("file");
  }

  function clearFolder() {
    stopDev();
    setRootDir(null);
  }

  // Clicking the F.E.V brand returns to the empty first screen.
  function goHome() {
    setFile(null);
    setError(null);
    setActiveView("file");
    setMenuPath(null);
  }

  async function loadPath(path: string) {
    setError(null);
    setActiveView("file");
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

      {folderInfoOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setFolderInfoOpen(false)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Opening a folder</h2>
            <p className="modal-text">
              Browse a folder's files and click any <b>.html / .jsx / .tsx / .css</b>{" "}
              to preview it.
            </p>
            <p className="modal-text">
              If the folder is a real front-end project (has a <code>dev</code>{" "}
              script), F.E.V can <b>run its dev server</b> and show the live app —
              no terminal needed.
            </p>
            <p className="modal-text muted">
              F.E.V never changes your project. Dependencies must already be
              installed (<code>node_modules</code>); if they're missing it will
              tell you to run <code>install</code> yourself. The dev server stops
              when you press Stop, Clear, or close the app.
            </p>

            <label className="modal-check">
              <input
                type="checkbox"
                checked={dontShowFolderInfo}
                onChange={(e) => setDontShowFolderInfo(e.target.checked)}
              />
              Don't show this again
            </label>

            <div className="modal-actions">
              <button
                className="run-btn stop"
                onClick={() => setFolderInfoOpen(false)}
              >
                Cancel
              </button>
              <button className="open-btn" onClick={confirmFolderInfo}>
                Choose folder…
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div
            className="modal-card settings-card"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="settings-nav">
              <div className="settings-nav-title">Settings</div>
              {SETTINGS_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className={`settings-nav-item${
                    settingsSection === s.id ? " active" : ""
                  }`}
                  onClick={() => setSettingsSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>

            <div className="settings-body">
              {settingsSection === "about" && (
                <>
                  <h2 className="modal-title">F.E.V — Front-End View</h2>
                  <p className="modal-text">Version {appVersion || "…"}</p>
                  <p className="modal-text muted">
                    Preview front-end files and run real front-end projects — no
                    build step, no terminal.
                  </p>
                  <p className="modal-text">
                    <span
                      className="link"
                      onClick={() => openUrl(`https://github.com/${REPO}`)}
                    >
                      github.com/{REPO}
                    </span>
                  </p>

                  <div className="about-update">
                    {update.status === "latest" && (
                      <span className="muted">
                        You're on the latest version.
                      </span>
                    )}
                    {update.status === "available" && (
                      <span className="update-avail">
                        Update available: v{update.version}
                      </span>
                    )}
                    {update.status === "error" && (
                      <span className="run-error">
                        Couldn't check: {update.message}
                      </span>
                    )}
                  </div>

                  <div className="modal-actions">
                    {update.status === "available" ? (
                      <button
                        className="open-btn"
                        onClick={() => update.url && openUrl(update.url)}
                      >
                        Download update
                      </button>
                    ) : (
                      <button
                        className="open-btn"
                        onClick={checkUpdate}
                        disabled={update.status === "checking"}
                      >
                        {update.status === "checking"
                          ? "Checking…"
                          : "Check for updates"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              className="settings-close"
              title="Close"
              onClick={() => setSettingsOpen(false)}
            >
              <IconClose />
            </button>
          </div>
        </div>
      )}

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
            <div className="brand" onClick={goHome} title="Home — clear preview">
              F.E.V
            </div>
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
          <button className="open-folder-btn" onClick={requestOpenFolder}>
            Open folder…
          </button>

          <div className="tabs">
            <button
              className={`tab${view === "recent" ? " active" : ""}`}
              onClick={() => setView("recent")}
            >
              File
            </button>
            <button
              className={`tab${view === "files" ? " active" : ""}`}
              onClick={() => setView("files")}
            >
              Folder
            </button>
          </div>

          {view === "recent" && (
            <div className="recents-scroll">
              {groupedRecents.map(([ext, items]) => (
                <div className="recents-group" key={ext}>
                  <div className="recents-group-label">.{ext || "file"}</div>
                  <ul className="recents">{items.map(renderRecent)}</ul>
                </div>
              ))}
            </div>
          )}

          {view === "files" && (
            <div className="files-pane">
              {!rootDir && recentFolders.length > 0 && (
                <div className="recents-scroll">
                  <div className="recents-group-label">Recent folders</div>
                  {recentFolders.map((p) => (
                    <div
                      className="tree-row"
                      key={p}
                      title={p}
                      onClick={() => selectFolder(p)}
                    >
                      <span className="tree-name">{folderName(p)}</span>
                      <button
                        className="kebab"
                        title="Remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentFolder(p);
                        }}
                      >
                        <IconClose />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {rootDir && (
                <>
                  <div className="files-head">
                    <span className="files-root" title={rootDir}>
                      {rootDir.split(/[/\\]/).filter(Boolean).pop()}
                    </span>
                    <button
                      className="files-clear"
                      title="Clear folder & stop dev server"
                      onClick={clearFolder}
                    >
                      Clear
                    </button>
                  </div>

                  {project?.is_project && project.dev_script && (
                    <>
                      {!project.has_node_modules ? (
                        <div className="run-note muted">
                          ⚠ Dependencies not installed. Run{" "}
                          <code>{project.package_manager} install</code> in the
                          project first.
                        </div>
                      ) : devStatus === "running" ? (
                        <>
                          {activeView !== "dev" && (
                            <button
                              className="run-btn"
                              onClick={() => setActiveView("dev")}
                            >
                              ▶ Show dev server
                            </button>
                          )}
                          <button className="run-btn stop" onClick={stopDev}>
                            ■ Stop dev server
                          </button>
                        </>
                      ) : (
                        <button
                          className="run-btn"
                          onClick={runDev}
                          disabled={devStatus === "starting"}
                          title="Run the project's dev server"
                        >
                          {devStatus === "starting"
                            ? "Starting…"
                            : "▶ Run dev server"}
                        </button>
                      )}
                      {devError && <div className="run-error">{devError}</div>}
                    </>
                  )}

                  <div className="recents-scroll">
                    <FileTree
                      rootDir={rootDir}
                      onOpenFile={loadPath}
                      activePath={file?.path}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="sidebar-footer">
            <button
              className="about-btn"
              onClick={openSettings}
              title="Settings"
            >
              Settings
            </button>
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
        {activeView === "dev" && devUrl && (
          <>
            <div className="topbar">
              <span className="filename">{project?.name || "dev server"}</span>
              <span className="badge badge-dev">live</span>
              <span className="dev-url" title={devUrl}>
                {devUrl}
              </span>
              <button className="files-change" title="Stop" onClick={stopDev}>
                ■
              </button>
            </div>
            <iframe
              className="frame"
              title="dev"
              src={devUrl}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </>
        )}

        {activeView !== "dev" && !file && (
          <div className="dropzone">
            <p>Drag a file here, or click <b>Open file…</b></p>
            <p className="muted">.html · .jsx · .tsx · .css</p>
          </div>
        )}

        {activeView !== "dev" && file && (
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

function IconClose() {
  return (
    <svg {...svg}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export default App;
