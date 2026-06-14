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

// Build the document loaded into the preview iframe.
// Returns null when the kind cannot be rendered yet.
export function buildPreviewDoc(file: LoadedFile): string | null {
  const kind = classify(file.ext);
  switch (kind) {
    case "html":
      return file.content;
    case "react":
      return buildReactDoc(file.name, file.content);
    case "css":
      return cssPreviewDoc(file.content);
    default:
      return null;
  }
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
