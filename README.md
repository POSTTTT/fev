# fev — Front-End View

Instantly preview HTML, JSX, and TSX files — no build step, no `npm run dev`.

A Tauri desktop app. Open or drag a front-end file in and see it render.

## Status

- **Phase 1 (done):** HTML preview. Open/drag a `.html` file → renders in a sandboxed iframe. Recent-files list. CSS gets a sample preview. JSX/TSX recognized but show source (transpile lands in Phase 2).
- Next: Phase 2 — JSX/TSX transpile (swc) + React from vendored libs. See `SPEC.md`.

## Develop

```sh
npm install            # if cert errors: NODE_OPTIONS=--use-system-ca npm install
npm run tauri dev      # launch the app
```

## Build

```sh
npm run tauri build
```

## Stack

Tauri · Rust · React + Vite · sandboxed iframe preview. Full design in `SPEC.md`, design history in `CONVERSATION.md`.

## Try it

Run dev, then open `examples/hello.html`.
