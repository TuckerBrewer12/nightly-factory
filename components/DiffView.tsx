"use client";

import { useState } from "react";
import type { DiffFile } from "@/lib/diff";

const BIG = 400;

export function DiffView({ files, source }: { files: DiffFile[]; source: "pr" | "patch" | null }) {
  const [split, setSplit] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(files.map((f, i) => [key(f, i), i < 8 && lineCount(f) < BIG])),
  );
  const adds = files.reduce((s, f) => s + f.additions, 0);
  const dels = files.reduce((s, f) => s + f.deletions, 0);
  const allOpen = files.every((f, i) => open[key(f, i)]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-ink-2">
          {files.length} files <span className="text-ok">+{adds}</span> <span className="text-bad">−{dels}</span>
          {source === "patch" && <span className="ml-2 text-ink-3">from the run&apos;s saved patch</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setOpen(Object.fromEntries(files.map((f, i) => [key(f, i), !allOpen])))} className="text-ink-3 hover:text-ink">
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
          <div className="flex rounded-md border border-line bg-bg p-0.5">
            {(["Unified", "Split"] as const).map((m) => (
              <button key={m} onClick={() => setSplit(m === "Split")} className={`rounded px-2 py-0.5 ${split === (m === "Split") ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-x-6 rounded-xl border border-line bg-panel px-4 py-3 font-mono text-[11.5px] sm:grid-cols-2">
        {files.map((f, i) => (
          <a key={key(f, i)} href={`#f-${i}`} onClick={() => setOpen((o) => ({ ...o, [key(f, i)]: true }))} className="flex items-center gap-2 truncate py-0.5 text-ink-2 hover:text-ink">
            <span className={`w-3 shrink-0 ${f.status === "added" ? "text-ok" : f.status === "removed" ? "text-bad" : "text-ink-3"}`}>
              {f.status === "added" ? "A" : f.status === "removed" ? "D" : f.status === "renamed" ? "R" : "M"}
            </span>
            <span className="truncate">{f.path}</span>
            <span className="ml-auto shrink-0 text-ok">+{f.additions}</span>
            <span className="shrink-0 text-bad">−{f.deletions}</span>
          </a>
        ))}
      </div>

      <div className="space-y-3">
        {files.map((f, i) => {
          const k = key(f, i);
          const isOpen = open[k];
          return (
            <section key={k} id={`f-${i}`} className="overflow-hidden rounded-xl border border-line bg-panel">
              <button onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} className="flex w-full items-center gap-3 border-b border-line bg-panel-2 px-4 py-2 text-left">
                <span className="text-ink-3">{isOpen ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                  {f.oldPath ? `${f.oldPath} → ` : ""}
                  {f.path}
                </span>
                {f.commit && <span className="hidden max-w-xs truncate text-[11px] text-ink-3 md:inline">{f.commit}</span>}
                <span className="font-mono text-[11px] text-ok">+{f.additions}</span>
                <span className="font-mono text-[11px] text-bad">−{f.deletions}</span>
                {f.url && (
                  <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-ink-3 hover:text-ink">
                    View ↗
                  </a>
                )}
              </button>
              {isOpen &&
                (f.hunks ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse font-mono text-[12px] leading-[1.55]">
                      <tbody>{f.hunks.map((h, hi) => (split ? <SplitHunk key={hi} h={h} /> : <UnifiedHunk key={hi} h={h} />))}</tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-4 py-3 text-xs text-ink-3">Binary or too large to show here.</p>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const key = (f: DiffFile, i: number) => `${i}:${f.path}`;
const lineCount = (f: DiffFile) => f.hunks?.reduce((s, h) => s + h.lines.length, 0) ?? 0;

type Hunk = NonNullable<DiffFile["hunks"]>[number];

function HunkHeader({ text, cols }: { text: string; cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="bg-info/5 px-3 py-1 text-[11px] text-info/80">
        {text}
      </td>
    </tr>
  );
}

const num = "w-12 select-none border-r border-line px-2 text-right align-top text-ink-3";

function UnifiedHunk({ h }: { h: Hunk }) {
  return (
    <>
      <HunkHeader text={h.header} cols={3} />
      {h.lines.map((l, i) =>
        l.kind === "note" ? (
          <tr key={i}>
            <td colSpan={3} className="px-3 text-[11px] italic text-ink-3">
              {l.text}
            </td>
          </tr>
        ) : (
          <tr key={i} className={l.kind === "add" ? "diff-add" : l.kind === "del" ? "diff-del" : ""}>
            <td className={num}>{l.old ?? ""}</td>
            <td className={num}>{l.new ?? ""}</td>
            <td className="whitespace-pre px-3 text-ink">
              <span className={`mr-2 select-none ${l.kind === "add" ? "text-ok" : l.kind === "del" ? "text-bad" : "text-ink-3"}`}>
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
              </span>
              {l.text}
            </td>
          </tr>
        ),
      )}
    </>
  );
}

// Pair runs of deletions with the additions that follow them.
function SplitHunk({ h }: { h: Hunk }) {
  const rows: { left?: Hunk["lines"][number]; right?: Hunk["lines"][number] }[] = [];
  const lines = h.lines.filter((l) => l.kind !== "note");
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (l.kind === "ctx") {
      rows.push({ left: l, right: l });
      i++;
      continue;
    }
    const dels: typeof lines = [];
    const adds: typeof lines = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === "add") adds.push(lines[i++]);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) rows.push({ left: dels[j], right: adds[j] });
  }
  const cell = (l: Hunk["lines"][number] | undefined, side: "left" | "right") => (
    <>
      <td className={`${num} ${l?.kind === "del" ? "diff-del" : l?.kind === "add" ? "diff-add" : ""}`}>{side === "left" ? (l?.old ?? "") : (l?.new ?? "")}</td>
      <td className={`w-1/2 whitespace-pre px-3 text-ink ${l?.kind === "del" ? "diff-del" : l?.kind === "add" ? "diff-add" : l ? "" : "bg-panel-2/60"}`}>{l?.text ?? ""}</td>
    </>
  );
  return (
    <>
      <HunkHeader text={h.header} cols={4} />
      {rows.map((r, i) => (
        <tr key={i}>
          {cell(r.left, "left")}
          {cell(r.right, "right")}
        </tr>
      ))}
    </>
  );
}
