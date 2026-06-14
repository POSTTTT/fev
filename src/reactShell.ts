// Builds the HTML document that renders a JSX/TSX file inside the preview
// iframe. Phase 2 = online: React and any other imported package resolve from
// the esm.sh CDN, Tailwind from its Play CDN, and Babel transpiles the source
// in the browser. Offline (vendored libs + local cache) comes later.

const REACT_VERSION = "18.3.1";
const ESM = "https://esm.sh";
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const BABEL_CDN = "https://unpkg.com/@babel/standalone@7/babel.min.js";

// Bare specifiers the React runtime itself needs, always mapped so the
// automatic JSX runtime and our bootstrap resolve even if the file doesn't
// import React explicitly.
const REACT_BASE = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

// Pull bare (npm) import specifiers out of source so each can be mapped to a
// CDN URL. Skips relative (./ ../) and absolute (/) imports.
function scanBareImports(src: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g, // import ... from "x" / import "x"
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g, // re-exports
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const s = m[1];
      if (!s.startsWith(".") && !s.startsWith("/")) specs.add(s);
    }
  }
  return [...specs];
}

// Split a specifier into package name + subpath, handling @scope/name.
function splitSpec(spec: string): { pkg: string; sub: string } {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return { pkg: parts.slice(0, 2).join("/"), sub: parts.slice(2).join("/") };
  }
  const i = spec.indexOf("/");
  return i === -1
    ? { pkg: spec, sub: "" }
    : { pkg: spec.slice(0, i), sub: spec.slice(i + 1) };
}

// Map one specifier to its esm.sh URL. React packages are version-pinned;
// everything else is told to reuse that same React (external) so there is only
// one copy of React — two copies break hooks.
function esmUrl(spec: string): string {
  const { pkg, sub } = splitSpec(spec);
  const subPath = sub ? `/${sub}` : "";
  if (pkg === "react" || pkg === "react-dom") {
    return `${ESM}/${pkg}@${REACT_VERSION}${subPath}`;
  }
  return `${ESM}/${spec}?external=react,react-dom&deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`;
}

function buildImportMap(specs: string[]): string {
  const all = new Set<string>([...REACT_BASE, ...specs]);
  const imports: Record<string, string> = {};
  for (const s of all) imports[s] = esmUrl(s);
  return JSON.stringify({ imports }, null, 2);
}

export function buildReactDoc(name: string, source: string): string {
  const importMap = buildImportMap(scanBareImports(source));
  const srcJson = JSON.stringify(source);
  const nameJson = JSON.stringify(name);

  // Bootstrap appended to the transpiled module. Uses namespace imports with
  // mangled names so it never collides with the user's own React imports.
  const bootstrap = `
import * as __ReactDOM from "react-dom/client";
import * as __React from "react";
{
  const __el = document.getElementById("root");
  const __C = globalThis.__FEV_DEFAULT__;
  if (!__C) {
    __fevError(new Error("No default export found — fev renders the default-exported component."));
  } else {
    try {
      __ReactDOM.createRoot(__el).render(__React.createElement(__C));
    } catch (e) { __fevError(e); }
  }
}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(name)}</title>
<script src="${TAILWIND_CDN}"></script>
<script src="${BABEL_CDN}"></script>
<script type="importmap">
${importMap}
</script>
<style>
  html, body, #root { margin: 0; min-height: 100%; }
  #__fev_err {
    position: fixed; inset: 0; margin: 0; padding: 20px; z-index: 99999;
    background: #1e1e22; color: #ff9a9a; font: 13px/1.5 monospace;
    white-space: pre-wrap; overflow: auto; display: none;
  }
  #__fev_err b { color: #ff6b6b; }
</style>
</head>
<body>
<div id="root"></div>
<pre id="__fev_err"></pre>
<script>
  // Surface transpile + runtime errors in an overlay instead of a blank page.
  function __fevError(e) {
    var box = document.getElementById("__fev_err");
    box.style.display = "block";
    box.innerHTML = "<b>" + (e && e.name ? e.name : "Error") + "</b>\\n" +
      ((e && (e.stack || e.message)) || String(e));
  }
  window.addEventListener("error", function (ev) {
    __fevError(ev.error || new Error(ev.message));
  });
  window.addEventListener("unhandledrejection", function (ev) {
    __fevError(ev.reason || new Error("Unhandled promise rejection"));
  });

  // Capture "export default X" -> globalThis.__FEV_DEFAULT__ so the bootstrap
  // can mount it without knowing the component's name.
  Babel.registerPlugin("fev-capture-default", function (babel) {
    var t = babel.types;
    function assign(expr) {
      return t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(t.identifier("globalThis"), t.identifier("__FEV_DEFAULT__")),
          expr
        )
      );
    }
    return {
      visitor: {
        ExportDefaultDeclaration: function (path) {
          var d = path.node.declaration;
          if (t.isFunctionDeclaration(d) || t.isClassDeclaration(d)) {
            if (d.id) {
              // Keep the named decl, then assign by reference.
              path.replaceWithMultiple([d, assign(t.identifier(d.id.name))]);
            } else {
              var expr = t.isFunctionDeclaration(d)
                ? t.functionExpression(null, d.params, d.body, d.generator, d.async)
                : t.classExpression(null, d.superClass, d.body);
              path.replaceWith(assign(expr));
            }
          } else {
            path.replaceWith(assign(d));
          }
        },
      },
    };
  });

  try {
    var SRC = ${srcJson};
    var out = Babel.transform(SRC, {
      filename: ${nameJson},
      presets: [
        ["react", { runtime: "automatic" }],
        ["typescript", { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }],
      ],
      plugins: ["fev-capture-default"],
    }).code;
    var blob = new Blob([out + ${JSON.stringify(bootstrap)}], { type: "text/javascript" });
    import(URL.createObjectURL(blob)).catch(__fevError);
  } catch (e) {
    __fevError(e);
  }
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
