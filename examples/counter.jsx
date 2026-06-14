import { useState } from "react";
import { Plus, Minus, RotateCcw } from "lucide-react";

export default function Counter() {
  const [n, setN] = useState(0);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-fuchsia-600">
      <div className="bg-white/10 backdrop-blur rounded-2xl p-10 text-center shadow-2xl">
        <h1 className="text-white text-3xl font-bold mb-1">fev · JSX</h1>
        <p className="text-white/70 mb-6">Tailwind + lucide icons, no build step</p>

        <div className="text-white text-7xl font-mono tabular-nums mb-6">{n}</div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setN((v) => v - 1)}
            className="p-3 rounded-xl bg-white/20 hover:bg-white/30 text-white"
          >
            <Minus />
          </button>
          <button
            onClick={() => setN(0)}
            className="p-3 rounded-xl bg-white/20 hover:bg-white/30 text-white"
          >
            <RotateCcw />
          </button>
          <button
            onClick={() => setN((v) => v + 1)}
            className="p-3 rounded-xl bg-white text-fuchsia-600 hover:bg-white/90"
          >
            <Plus />
          </button>
        </div>
      </div>
    </div>
  );
}
