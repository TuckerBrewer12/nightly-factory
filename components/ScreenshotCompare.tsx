"use client";

import { useState } from "react";

type Mode = "after" | "before" | "side" | "slide";

export function ScreenshotCompare({ name, note, before, after }: { name: string; note?: string; before: string | null; after: string }) {
  const [mode, setMode] = useState<Mode>(before ? "slide" : "after");
  const [pos, setPos] = useState(50);
  const modes: Mode[] = before ? ["slide", "side", "before", "after"] : ["after"];

  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-panel">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm">{name}</p>
          {note && <p className="truncate text-xs text-ink-3">{note}</p>}
        </div>
        {modes.length > 1 && (
          <div className="flex rounded-md border border-line bg-bg p-0.5 text-xs">
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 ${mode === m ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                {{ slide: "Slider", side: "Side by side", before: "Before", after: "After" }[m]}
              </button>
            ))}
          </div>
        )}
      </figcaption>
      <div className="bg-[#050505] p-3">
        {mode === "side" && before ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Labeled label="Before" src={before} />
            <Labeled label="After" src={after} />
          </div>
        ) : mode === "slide" && before ? (
          <div className="relative mx-auto w-fit select-none">
            <img src={after} alt="After" className="block max-h-[70vh] w-auto" />
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              <img src={before} alt="Before" className="block max-h-[70vh] w-auto" />
            </div>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/80" style={{ left: `${pos}%` }} />
            <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">Before</span>
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">After</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label="Before and after divider"
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            />
          </div>
        ) : (
          <img src={mode === "before" && before ? before : after} alt={mode} className="mx-auto block max-h-[70vh] w-auto" />
        )}
      </div>
    </figure>
  );
}

function Labeled({ label, src }: { label: string; src: string }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-3">{label}</p>
      <img src={src} alt={label} className="block w-full" />
    </div>
  );
}
