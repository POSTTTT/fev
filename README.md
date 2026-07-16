<div align="center">

<img src="docs/banner.png" alt="F.E.V" width="380" />

# F.E.V — Front-End View 👁️

*See any front-end file. No build step, no terminal.*

[Download](https://github.com/POSTTTT/fev/releases/latest) · [Examples](examples) · [Report a bug](https://github.com/POSTTTT/fev/issues)

![Release](https://img.shields.io/github/v/release/POSTTTT/fev?style=for-the-badge&label=RELEASE&labelColor=282c34&color=61afef)
![Platform](https://img.shields.io/badge/PLATFORM-Windows-abb2bf?style=for-the-badge&labelColor=282c34)
![Built with](https://img.shields.io/badge/BUILT%20WITH-Tauri%20%C2%B7%20Rust%20%C2%B7%20React-c678dd?style=for-the-badge&labelColor=282c34)
![No build step](https://img.shields.io/badge/BUILD%20STEP-none-98c379?style=for-the-badge&labelColor=282c34)

</div>

**Preview front-end files and run real front-end projects** — with **no build step and no terminal**. Open it, see it.

## The idea

Claude often hands me a `.jsx` file. To actually *see* it, I had to make a folder, drop the file in, and run `npm run dev` every single time — repetitive ceremony just to preview one component. And a lot of what I get now are self-contained HTML artifacts too.

So F.E.V is a desktop app that previews front-end files directly, and can run a real project's dev server for you — **no commands, no setup**. Open it, see it.

## Features

### Preview a file
- **HTML** — renders live, including multi-file pages. Relative assets and `@import` chains resolve from disk (served over a custom `fev://` protocol), so a page pulling in `../styles/components.css` or a sibling script just works — even when those files live above the file's own folder.
- **JSX / TSX** — transpiled in-app (Babel) and rendered as a React component. Any npm import (e.g. `lucide-react`, `recharts`) auto-resolves from the [esm.sh](https://esm.sh) CDN; Tailwind classes work via CDN. Auto-mounts the default export; errors show in an overlay instead of a blank page.
- **CSS** — preview the stylesheet applied to a sample of common elements.
- Drag-and-drop a file anywhere onto the window, or use **Open file…**.

### Open a folder
- **File tree** — browse a folder; click any previewable file to open it. Non-previewable files are greyed; `node_modules`, `.git`, `target`, `dist`, `.next`, `.venv` are skipped.
- **Run a real project** — if the folder is a front-end project (has a `dev`/`start` script), F.E.V **runs its dev server** (Vite/Next/…) and shows the live app. It detects the package manager (npm/pnpm/yarn/bun), starts the server, and loads its `localhost` URL.
  - F.E.V **never modifies your project** — dependencies must already be installed. If `node_modules` is missing it tells you to run `install` yourself.
  - The dev server is killed on **Stop**, **Clear**, or when the app closes.
  - Opening a file while the server runs switches to the file; **Show dev server** flips back without restarting.
- **Recent folders** — quick re-open list (folder selection isn't restored on launch).

### Around the app
- **File / Folder tabs** in the sidebar; **recent files** grouped by suffix, each with a `⋮` menu: **Open file location**, **Rename** (in-app alias only — handy when everything's named `index.html`), **Remove**.
- **Sidebar** collapse/show + drag-to-resize (width remembered).
- Click the **F.E.V** brand to return to the empty home screen.
- Monospace design-system theme (Fira Code, One-Dark palette), subtle motion.

## How it works

A Tauri desktop app: Rust backend + React/Vite webview shell.

- Real `.html` is served through a custom **`fev://`** protocol rooted at the file's location, so the webview resolves relative paths like a normal web server.
- Generated previews (React shell, CSS sample) run in a sandboxed, opaque-origin iframe so artifact code can't reach the app.
- JSX/TSX is wrapped in a shell that scans imports → esm.sh (React pinned so hooks don't break), transpiles with Babel, mounts the default export.
- Projects are run by spawning the dev script; F.E.V parses the printed `localhost` URL (ANSI-stripped) and frames it. The process tree is killed on stop/close.

## Develop

```sh
npm install          # if you hit cert errors: NODE_OPTIONS=--use-system-ca npm install
npm run tauri dev    # build + launch the app
```

## Build

```sh
npm run tauri build  # standalone exe + installer
```

## Notes (Windows / network)

This repo lives in OneDrive on a network with a corporate CA — two workarounds are committed:

- `NODE_OPTIONS=--use-system-ca` for `npm install` (cert verification).
- `src-tauri/.cargo/config.toml`: `check-revoke = false` (schannel can't reach the revocation server) and `target-dir` pointed outside OneDrive (OneDrive locks `target/*.dll` during linking → `LNK1105`).
