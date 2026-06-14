import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { classify } from "./preview";

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

const extOf = (n: string) => n.split(".").pop()?.toLowerCase() ?? "";
const previewable = (n: string) => classify(extOf(n)) !== "unknown";

interface NodeProps {
  entry: Entry;
  depth: number;
  onOpenFile: (path: string) => void;
  activePath?: string;
}

function TreeNode({ entry, depth, onOpenFile, activePath }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const pad = { paddingLeft: 8 + depth * 12 };

  async function toggle() {
    if (!open && children === null) {
      try {
        setChildren(await invoke<Entry[]>("list_dir", { path: entry.path }));
      } catch {
        setChildren([]);
      }
    }
    setOpen((o) => !o);
  }

  if (entry.is_dir) {
    return (
      <div>
        <div className="tree-row tree-dir" style={pad} onClick={toggle}>
          <span className={`tree-caret${open ? " open" : ""}`}>▸</span>
          <span className="tree-name">{entry.name}</span>
        </div>
        {open &&
          children?.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              activePath={activePath}
            />
          ))}
      </div>
    );
  }

  const ok = previewable(entry.name);
  // Indent files past the folder caret so names line up under folder names.
  const filePad = { paddingLeft: 8 + depth * 12 + 14 };
  return (
    <div
      className={
        "tree-row tree-file" +
        (ok ? "" : " disabled") +
        (activePath === entry.path ? " active" : "")
      }
      style={filePad}
      title={entry.path}
      onClick={() => ok && onOpenFile(entry.path)}
    >
      <span className="tree-name">{entry.name}</span>
    </div>
  );
}

export function FileTree({
  rootDir,
  onOpenFile,
  activePath,
}: {
  rootDir: string;
  onOpenFile: (path: string) => void;
  activePath?: string;
}) {
  const [children, setChildren] = useState<Entry[] | null>(null);

  useEffect(() => {
    let alive = true;
    setChildren(null);
    invoke<Entry[]>("list_dir", { path: rootDir })
      .then((c) => alive && setChildren(c))
      .catch(() => alive && setChildren([]));
    return () => {
      alive = false;
    };
  }, [rootDir]);

  return (
    <div className="tree">
      {children?.map((c) => (
        <TreeNode
          key={c.path}
          entry={c}
          depth={0}
          onOpenFile={onOpenFile}
          activePath={activePath}
        />
      ))}
    </div>
  );
}
