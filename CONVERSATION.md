# fev — Design Conversation Log

Date: 2026-06-14

This is the discussion that produced `SPEC.md`. Kept for context at build time.

---

## The idea

A program called **fev** ("front-end view") that runs/previews front-end files (HTML, JSX, TSX) directly — no terminal, no build step.

**Origin of the problem:** Claude often outputs a JSX file. To view it, the user has to make a folder, drop the file in, and run `npm run dev` every time. Wanted a tool that previews the front-end without that ceremony. Mostly a **previewer**, since a lot of the output is HTML artifacts.

## Decisions reached

1. **Form factor → Tauri desktop app.** Rust backend + native webview. Double-click / drag-drop feel, no terminal.

2. **Offline support → yes, wanted.** Strategy: vendor a common lib pack (React, ReactDOM, lucide-react, recharts, framer-motion, Tailwind JIT engine) inside the app. Import map points to local files first. Fallback to esm.sh + disk cache when online; clear error when offline + lib not bundled. swc transpile is native Rust = always offline.

3. **Shell UI framework → React.** User only knows React. Compared against Svelte (smaller/faster, new syntax) and Vanilla (smallest, tedious). React chosen to ship faster; shell is small so React overhead is irrelevant.
   - Important distinction clarified: the **previewed artifact** is React running *inside a sandboxed iframe*; the **shell UI** is React running in the *main webview*. Two separate things.

4. **Transpiler → swc (Rust, `swc_core`).** Native, offline, fast for JSX/TSX. Alternatives considered: esbuild-wasm (heavier), Babel standalone (slowest, needs net).

5. **Build timing → later.** Spec written now; no code yet.

## Locked stack

Tauri + Rust (swc transpile + file watch) + React shell + vendored-offline libs + sandboxed iframe preview.

## Key risks flagged

- Pin **one React version** across vendored + CDN fallback, or hooks break from two React copies.
- v1 = single file. Sibling `./other.jsx` imports → decide resolution in Phase 2.
- Verify Tailwind Play-CDN JIT script works fully offline when vendored.
- swc JSX runtime = `automatic` + React 18 to match esm.sh defaults.
- Vendored pack adds MBs to installer — acceptable for offline goal.

## Next step

When ready: start **Phase 1 — HTML preview** (smallest end-to-end slice). See `SPEC.md` §11.
