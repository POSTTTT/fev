# F.E.V — Front-End View

Instantly preview front-end files — HTML, JSX, TSX — with **no build step and no terminal**. Open or drag a file into the app and see it render.

## The idea

Claude often hands me a `.jsx` file. To actually *see* it, I had to make a folder, drop the file in, and run `npm run dev` every single time — repetitive ceremony just to preview one component. And these days a lot of what I get are self-contained HTML artifacts too.

So F.E.V is a program that runs front-end files (HTML, JSX, TSX, …) directly — **no commands, no project setup**. It's a previewer: open the file, it renders. That's it.

## Features

- **HTML** — renders live, including multi-file pages. Relative assets and `@import` chains resolve from disk (served over a custom `fev://` protocol), so a page that pulls in `../styles/components.css` or a sibling script just works — even when those files live above the file's own folder.
- **JSX / TSX** — transpiled in-app (Babel) and rendered as a React component. Any npm import (e.g. `lucide-react`, `recharts`) auto-resolves from the [esm.sh](https://esm.sh) CDN, and Tailwind classes work via CDN. It auto-mounts the default-exported component. *(Online for now — offline support is planned.)*
- **CSS** — preview the stylesheet applied to a sample of common elements.
- **Recent files** — quick-open list with a `⋮` menu per item:
  - **Open file location** (reveal in the OS file explorer)
  - **Rename** — an in-app alias only; the file on disk is untouched (handy when everything is named `index.html`)
  - **Remove**
- **Sidebar** — collapse/show toggle and drag-to-resize (width is remembered).
- Drag-and-drop a file anywhere onto the window.

## How it works

A Tauri desktop app: a Rust backend + a React/Vite webview shell.

- Real `.html` is served through a custom **`fev://`** protocol rooted at the file's location, so the webview resolves relative paths like a normal web server.
- Generated previews (the React shell, CSS sample) run in a sandboxed, opaque-origin iframe so artifact code can't reach the app.
- JSX/TSX is wrapped in a small HTML shell that scans the file's imports, maps them to esm.sh (React pinned to one version so hooks don't break), transpiles with Babel, and mounts the default export. Errors show in an overlay instead of a blank page.

## Develop

```sh
npm install          # if you hit cert errors: NODE_OPTIONS=--use-system-ca npm install
npm run tauri dev    # build + launch the app
```

## Build

```sh
npm run tauri build  # standalone exe + installer
```

## App icon

The icon is generated from `src-tauri/app-icon.png` (a square 1024×1024 PNG):

```sh
npm run tauri icon src-tauri/app-icon.png
```

## Stack

Tauri · Rust · React + Vite (TypeScript) · sandboxed iframe preview · [monospace design system](../design-system/monospace) theme (Fira Code, One-Dark palette).

## Roadmap

- ✅ HTML preview (incl. multi-file relative assets)
- ✅ JSX/TSX preview (online, via esm.sh + Tailwind CDN)
- ⏳ **Offline** — vendor common libs (React, lucide, recharts, Tailwind JIT) inside the app + a download-to-cache function so previews work without internet.
- 🔭 Possible later: full Vite/Next project trees (needs an embedded dev server — out of scope for a previewer today).

## Try it

Run `npm run tauri dev`, then open `examples/hello.html` (HTML) or `examples/counter.jsx` (JSX with Tailwind + lucide icons).

## Notes (Windows / network)

This repo lives in OneDrive on a network with a corporate CA, which needs two workarounds (both committed):

- `NODE_OPTIONS=--use-system-ca` for `npm install` (cert verification).
- `src-tauri/.cargo/config.toml`: `check-revoke = false` (schannel can't reach the revocation server) and `target-dir` pointed outside OneDrive (OneDrive locks `target/*.dll` during linking → `LNK1105`).
