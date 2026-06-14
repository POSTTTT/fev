# fev — Front-End View

**A desktop app to preview front-end files (HTML, JSX, TSX) with no build step and no terminal.**

---

## 1. Problem

Claude frequently outputs single front-end files — usually a React component (`.jsx`/`.tsx`) or a self-contained HTML artifact. To view a JSX/TSX file today, the workflow is:

1. Create a project folder
2. `npm install`
3. Drop the file in
4. `npm run dev`
5. Open the browser

This is slow and repetitive for what is essentially a *preview*. `fev` removes all of it: open the file in `fev`, see it render.

## 2. Goal

- Double-click / drag-drop a front-end file → it renders instantly.
- No `npm install`, no `npm run dev`, no manual project setup.
- Works **offline** for the common case.
- Live reload on file save.

`fev` is a **previewer**, not an editor or a full dev environment.

## 3. Non-Goals

- Not a code editor.
- Not a full bundler / production build tool.
- Not a multi-file project runner (initial scope = single file + its inline imports from known libs). Multi-file local imports = possible later, out of v1 scope.
- Not a replacement for Vite/Next for real apps.

## 4. Supported file types

| Type | Handling |
|---|---|
| `.html` | Loaded directly into preview iframe. No transform. |
| `.jsx` | Transpiled to JS, wrapped in HTML shell, rendered. |
| `.tsx` | Same as JSX, with TypeScript stripping. |
| `.js` / `.ts` | Treated as a module; if it renders to a root, preview it. |
| `.css` | Preview as applied styles (low priority). |

Primary targets: **`.html` and `.jsx`/`.tsx`** (Claude's two common outputs).

## 5. Architecture

```
fev (Tauri desktop app)
│
├─ Rust backend
│   ├─ File open dialog + drag-drop intake
│   ├─ File watcher  → emits "file changed" event (live reload)
│   ├─ Transpiler    → swc (native, offline) JSX/TSX → JS
│   ├─ Shell builder → wraps transpiled JS in HTML doc + import map
│   └─ (later) OS file association: .jsx/.tsx/.html → open with fev
│
└─ Webview (the app's own UI = "shell UI")
    ├─ Built with React
    ├─ Sidebar: recent files / open / drag-drop zone
    ├─ Toolbar: reload, open devtools, file type badge
    └─ Preview pane: sandboxed <iframe> rendering the file
```

### Key distinction
- **Previewed file** (the artifact) = React, runs **inside the iframe**. Always React.
- **Shell UI** (fev's own chrome) = React, runs in the **main webview**. Separate from the preview.

## 6. Render pipeline

### HTML file
1. Read file.
2. Load contents into sandboxed iframe (`srcdoc` or local server route).
3. Done.

### JSX / TSX file
1. Read file.
2. **Transpile** via swc (Rust): JSX → JS, strip TS types.
3. Detect imports (`react`, `react-dom`, `lucide-react`, `recharts`, etc.).
4. **Build HTML shell**:
   - `<script type="importmap">` mapping each import to a **local vendored file** (offline) or esm.sh (online fallback).
   - Tailwind engine script (vendored, JIT in-browser).
   - Mount point `<div id="root">` + bootstrap that imports the component and `ReactDOM.createRoot().render()`.
5. Load shell into sandboxed iframe.
6. On file change → re-transpile → reload iframe.

## 7. Offline strategy

Full offline = bundle libs inside the app. Cannot predict every import, so:

- **Vendored common pack** shipped in app bundle:
  - `react`, `react-dom`
  - `lucide-react` (icons)
  - `recharts` (charts)
  - `framer-motion` (animation)
  - Tailwind in-browser JIT engine (the Play-CDN script, vendored locally)
  - Covers ~90% of Claude artifacts.
- **Import map** points to local vendored files first.
- **Fallback for unknown imports:**
  - Online → fetch from esm.sh, optionally cache to disk for next time.
  - Offline → render a clear in-preview error: `Library "X" not bundled and you are offline.`
- swc transpile is native Rust → always offline.

### Vendoring
- Pre-download the common pack at build time into `src-tauri/resources/vendor/`.
- Each lib stored as an ESM file (`react.js`, `lucide-react.js`, …).
- Import map generated per-preview pointing at these.
- **Disk cache** for CDN-fetched libs: `~/.fev/cache/` so an exotic lib downloaded once works offline afterward.

## 8. Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri** | small binary, Rust backend, native webview |
| Backend lang | **Rust** | Tauri requirement; fast transpile + file watch |
| Transpiler | **swc** (`swc_core` crate) | native, offline, fast JSX/TSX |
| Shell UI | **React** | already known → ship faster, one mental model |
| Styling (preview) | **Tailwind JIT** (vendored) | matches Claude artifact assumptions |
| Preview isolation | **sandboxed iframe** | security + style isolation from shell |

### Why not Svelte/Vanilla for shell
- Svelte: smaller/faster but new syntax to learn — slows first build. Revisit if binary size matters.
- Vanilla: fine for tiny UI but tedious as features grow.
- React chosen because the user already knows it; shell is small so React overhead is irrelevant.

## 9. Security

- Preview runs in a **sandboxed iframe** — isolated from the fev shell and the host.
- Sandbox flags: allow scripts, disallow same-origin access to fev internals, no top-navigation.
- Tauri allowlist: restrict Rust commands exposed to the webview to only what's needed (read file, transpile, watch).
- CDN fallback fetch only over HTTPS; cached files validated before reuse.
- Never execute arbitrary file content in the Rust/host context — only inside the sandboxed webview.

## 10. UX flow

1. Launch fev (or drag a file onto its icon once file-association set up).
2. Drag-drop a `.jsx`/`.html` into the window, or click **Open**.
3. fev detects type, transpiles if needed, renders in preview pane.
4. Edit the file in any editor → save → fev auto-reloads.
5. Sidebar keeps a **recent files** list for quick re-open.

### Nice-to-haves (post-v1)
- "Open with fev" OS context-menu / file association.
- Export preview as a self-contained `.html`.
- Light/dark background toggle for the preview pane.
- Viewport size presets (mobile / tablet / desktop) for responsive checks.
- Error overlay showing transpile/runtime errors inline.

## 11. Build phases

- **Phase 1 — HTML preview.** Tauri app, open/drag-drop, render `.html` in iframe, recent files. Smallest end-to-end slice.
- **Phase 2 — JSX/TSX transpile.** swc integration, HTML shell builder, import map, React from vendored files. Render a basic React component offline.
- **Phase 3 — Offline lib pack.** Vendor common pack (lucide, recharts, framer-motion, Tailwind JIT). CDN fallback + disk cache.
- **Phase 4 — Live reload.** File watcher → auto re-transpile + iframe reload.
- **Phase 5 — Polish.** File association, error overlay, viewport presets, export.

## 12. Open questions / risks

- **Tailwind offline JIT:** verify the Play-CDN script works fully offline when vendored (it scans DOM for classes at runtime — should work, confirm in Phase 3).
- **swc config:** match the JSX runtime React expects (`automatic` vs `classic`). Use automatic runtime + React 18 to align with esm.sh defaults.
- **Local relative imports:** v1 assumes single file. If an artifact imports `./other.jsx`, decide whether to resolve sibling files (likely yes — read from same folder) — flag for Phase 2.
- **esm.sh version pinning:** pin React version across vendored + CDN fallback to avoid two React copies (breaks hooks).
- **Bundle size:** vendored pack adds MBs to the installer. Acceptable for offline goal; measure in Phase 3.
```

