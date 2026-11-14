"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type QueueItem = {
  key: string;
  href: string;
  task: string;
  night: string;
  title: string;
  summary: string;
  verdict: "needs-review" | "revised" | "unopened" | "plan";
  pr: number | null;
};

const GROUPS = [
  { id: "all", label: "All" },
  { id: "pr", label: "PRs", match: (v: QueueItem["verdict"]) => v === "needs-review" || v === "revised" },
  { id: "unopened", label: "Unopened", match: (v: QueueItem["verdict"]) => v === "unopened" },
  { id: "plan", label: "Plans", match: (v: QueueItem["verdict"]) => v === "plan" },
] as const;

const BADGE: Record<QueueItem["verdict"], string> = {
  "needs-review": "PR",
  revised: "Revised",
  unopened: "Unopened",
  plan: "Plan",
};

const PAGE = 4;

export function ReviewQueue({ items }: { items: QueueItem[] }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("all");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group);
    return g && "match" in g ? items.filter((i) => g.match(i.verdict)) : items;
  }, [group, items]);

  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-3">Nothing is waiting on you.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1 text-xs">
        {GROUPS.map((g) => {
          const n = "match" in g ? items.filter((i) => g.match(i.verdict)).length : items.length;
          if (n === 0 && g.id !== "all") return null;
          return (
            <button
              key={g.id}
              onClick={() => {
                setGroup(g.id);
                setShown(PAGE);
              }}
              className={`rounded-md border px-2 py-1 ${group === g.id ? "border-line-strong bg-panel-2 text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
            >
              {g.label} <span className="font-mono text-ink-3">{n}</span>
            </button>
          );
        })}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {filtered.slice(0, shown).map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="group flex items-center gap-4 px-4 py-2.5 hover:bg-panel-2">
              <span className="w-40 shrink-0 truncate font-mono text-[11px] text-ink-3">
                {r.task} · {r.night}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                {r.summary && <span className="block truncate text-xs text-ink-3">{r.summary}</span>}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-3">{r.pr ? `#${r.pr}` : ""}</span>
              <span
                className={`w-20 shrink-0 rounded-full border px-2 py-0.5 text-center text-[11px] ${
                  r.verdict === "plan" ? "border-info/30 text-info" : "border-warn/30 text-warn"
                }`}
              >
                {BADGE[r.verdict]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {filtered.length > shown && (
        <div className="mt-2 flex gap-3 text-xs">
          <button onClick={() => setShown((s) => s + PAGE)} className="text-ink-2 hover:text-ink">
            Show {Math.min(PAGE, filtered.length - shown)} more
          </button>
          <button onClick={() => setShown(filtered.length)} className="text-ink-3 hover:text-ink">
            Show all {filtered.length}
          </button>
        </div>
      )}
      {shown > PAGE && filtered.length <= shown && filtered.length > PAGE && (
        <button onClick={() => setShown(PAGE)} className="mt-2 text-xs text-ink-3 hover:text-ink">
          Show fewer
        </button>
      )}
    </div>
  );
}
