// Decides how a loaded file should be previewed.
// Phase 1: HTML renders for real. Phase 2: JSX/TSX render via online CDN
// (esm.sh + Tailwind + Babel). Everything else shows source.

import { buildReactDoc } from "./reactShell";

export type FileKind = "html" | "react" | "css" | "unknown";

export interface LoadedFile {
  path: string;
  name: string;
  ext: string;
  content: string;
}

export function classify(ext: string): FileKind {
  switch (ext) {
    case "html":
    case "htm":
      return "html";
    case "jsx":
    case "tsx":
      return "react";
    case "css":
      return "css";
    default:
      return "unknown";
  }
}

// How the preview iframe should load a file.
//  - "src":    point the iframe at the fev:// protocol so relative assets and
//              @import chains resolve from disk (real .html files).
//  - "srcdoc": inline a generated document (React shell, CSS sample).
export type Preview =
  | { mode: "src"; url: string }
  | { mode: "srcdoc"; doc: string }
  | null;

export function buildPreview(file: LoadedFile): Preview {
  const kind = classify(file.ext);
  switch (kind) {
    case "html":
      return { mode: "src", url: fevUrl(file.path) };
    case "react":
      return { mode: "srcdoc", doc: buildReactDoc(file.name, file.content) };
    case "css":
      return { mode: "srcdoc", doc: cssPreviewDoc(file.content) };
    default:
      return null;
  }
}

// Turn an absolute filesystem path into a fev:// URL. Slashes stay literal so
// the webview can resolve relative refs; each segment is percent-encoded so
// drive colons, spaces, etc. survive. Windows serves custom schemes over
// http://<scheme>.localhost.
function fevUrl(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const encoded = norm.split("/").map(encodeURIComponent).join("/");
  const isWindows = navigator.userAgent.includes("Windows");
  return isWindows
    ? `http://fev.localhost/${encoded}`
    : `fev://localhost/${encoded}`;
}

// Show the stylesheet applied to a small sample of common elements.
function cssPreviewDoc(css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body>
  <h1>Heading 1</h1><h2>Heading 2</h2>
  <p>Paragraph text with a <a href="#">link</a> and <strong>bold</strong>.</p>
  <button>Button</button>
  <input placeholder="Input" />
  <ul><li>List item one</li><li>List item two</li></ul>
</body></html>`;
}
