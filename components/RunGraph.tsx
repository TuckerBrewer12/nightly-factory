import type { RunDetail } from "@/lib/runs";
import { VERDICT_TEXT } from "@/lib/runs";
import type { Stage } from "@/lib/manifest";

// The run as a pipeline: one row per phase, a node (or a grid of nodes) per row.

type Tone = "ok" | "warn" | "fail" | "skipped" | "pending";
type Node = { title: string; detail: string; meta?: string; tone: Tone; badge?: string; href?: string };
type Row = { phase: string; nodes: Node[]; caption?: string; edgeNote?: string; edgeBad?: boolean; recheck?: boolean };

const ICON: Record<Tone, { glyph: string; cls: string }> = {
  ok: { glyph: "✓", cls: "text-ok" },
  warn: { glyph: "!", cls: "text-warn" },
  fail: { glyph: "✕", cls: "text-bad" },
  skipped: { glyph: "–", cls: "text-ink-3" },
  pending: { glyph: "○", cls: "text-info" },
};

const DETAIL_TONE: Record<Tone, string> = {
  ok: "text-ink-2",
  warn: "text-warn",
  fail: "text-bad",
  skipped: "text-ink-3",
  pending: "text-info",
};

const toneOf = (s: Stage["status"]): Tone => (s === "ok" ? "ok" : s === "warn" ? "warn" : s === "fail" ? "fail" : "skipped");
const secs = (n?: number) => (n === undefined ? undefined : n >= 90 ? `${Math.round(n / 60)}m` : `${Math.round(n)}s`);

function stageNode(s: Stage): Node {
  return { title: s.label, detail: s.detail, tone: toneOf(s.status), meta: secs(s.seconds), badge: s.rounds && s.rounds > 1 ? `${s.rounds} rounds` : undefined };
}

const KNOWN = ["followup", "context", "build", "pr", "fix"];

export function buildRows(run: RunDetail): Row[] {
  const m = run.manifest;
  const stage = (id: string) => m?.stages?.find((s) => s.id === id);
  const rows: Row[] = [];

  rows.push({
    phase: "Trigger",
    nodes: [
      {
        title: "Scheduled run",
        detail: `${run.task.label}, nightly at ${run.task.schedule}`,
        meta: m?.startedAt ? new Date(m.startedAt).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }) : run.date,
        tone: "ok",
        href: run.sessionUrl ?? undefined,
      },
    ],
  });

  const followup = stage("followup");
  if (followup) rows.push({ phase: "Step 0", nodes: [stageNode(followup)] });

  const context = stage("context");
  if (context) rows.push({ phase: "Prepare", nodes: [stageNode(context)] });

  const build = stage("build");
  const filesLine = run.pr ? `${run.files.length} files, +${run.pr.additions ?? 0} −${run.pr.deletions ?? 0}` : "";
  rows.push({
    phase: "Build",
    nodes: [build ? { ...stageNode(build), detail: build.detail || filesLine } : { title: "Builder", detail: filesLine || "No changes recorded", tone: run.pr ? "ok" : "skipped" }],
  });

  for (const s of m?.stages ?? []) if (!KNOWN.includes(s.id)) rows.push({ phase: s.id.replace(/[-_]/g, " "), nodes: [stageNode(s)] });

  if (m?.checks?.length) {
    const failed = m.checks.filter((c) => c.status === "fail").length;
    rows.push({
      phase: "Verify",
      caption: "Checks the run ran locally before opening the PR",
      nodes: m.checks.map((c) => ({ title: c.name, detail: c.detail ?? (c.status === "pass" ? "Passed" : c.status === "fail" ? "Failed" : "Skipped"), tone: c.status === "pass" ? "ok" : c.status === "fail" ? "fail" : "skipped" })),
      edgeNote: failed ? `${failed} failing` : undefined,
      edgeBad: failed > 0,
    });
  }

  const prStage = stage("pr");
  rows.push({
    phase: "Ship",
    nodes: [
      run.pr
        ? {
            title: run.pr.draft ? "Draft pull request" : "Pull request",
            detail: `#${run.pr.number} into ${run.pr.base.ref}`,
            meta: run.branch,
            tone: "ok",
            href: run.pr.html_url,
          }
        : prStage
          ? stageNode(prStage)
          : { title: "Pull request", detail: "Not opened", tone: "fail" },
    ],
  });

  if (run.pr) {
    const botNotes = run.feedback.filter((f) => f.bot);
    const ci: Node[] = run.checks.map((c) => ({
      title: c.name,
      detail: c.status !== "completed" ? "Running" : c.conclusion === "success" ? "Passed" : c.conclusion === "neutral" ? "Neutral" : c.conclusion ?? "",
      tone: c.status !== "completed" ? "pending" : c.conclusion === "success" || c.conclusion === "neutral" ? "ok" : "fail",
      href: c.html_url,
    }));
    ci.push({
      title: "Review bots",
      detail: botNotes.length ? `${botNotes.length} comment${botNotes.length === 1 ? "" : "s"}` : "Nothing posted",
      tone: botNotes.length ? "warn" : "ok",
    });
    const failing = ci.filter((n) => n.tone === "fail").length;
    rows.push({
      phase: "CI",
      caption: run.checks.length ? "GitHub checks on the latest commit, and what the bots said" : "No CI checks ran on this PR",
      nodes: ci,
      edgeNote: failing ? `${failing} failing` : undefined,
      edgeBad: failing > 0,
    });
  }

  const fix = stage("fix");
  if (fix) rows.push({ phase: "Fix", nodes: [stageNode(fix)], recheck: true });

  const v = run.verdict;
  rows.push({
    phase: "Review",
    nodes: [
      {
        title: "Your review",
        detail: VERDICT_TEXT[v],
        tone: v === "accepted" || v === "merged" ? "ok" : v === "rejected" || v === "no-pr" ? "fail" : v === "changes" ? "pending" : "warn",
      },
    ],
  });

  return rows;
}

function NodeCard({ n }: { n: Node }) {
  const icon = ICON[n.tone];
  const inner = (
    <div
      className={`flex h-full gap-3 rounded-lg border bg-panel px-4 py-3 text-left ${n.tone === "fail" ? "border-bad/50" : "border-line"} ${n.href ? "hover:border-line-strong" : ""}`}
    >
      <span className={`mt-0.5 w-3 shrink-0 text-center text-sm font-semibold ${icon.cls}`}>{icon.glyph}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm text-ink">
          <span className="truncate">{n.title}</span>
          {n.badge && <span className="rounded bg-panel-2 px-1.5 font-mono text-[10px] text-ink-3">{n.badge}</span>}
        </p>
        {n.detail && <p className={`mt-0.5 text-[13px] leading-snug ${DETAIL_TONE[n.tone]}`}>{n.detail}</p>}
        {n.meta && <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{n.meta}</p>}
      </div>
    </div>
  );
  return n.href ? (
    <a href={n.href} target="_blank" rel="noreferrer" className="block h-full">
      {inner}
    </a>
  ) : (
    inner
  );
}

export function RunGraph({ run }: { run: RunDetail }) {
  const rows = buildRows(run);
  return (
    <div className="char-field rounded-xl border border-line bg-bg/40 px-4 py-6 sm:px-6">
      {rows.map((row, i) => {
        const grid = row.nodes.length > 1;
        const last = i === rows.length - 1;
        return (
          <div key={`${row.phase}-${i}`} className="grid grid-cols-[72px_1fr] gap-3 sm:grid-cols-[96px_1fr] sm:gap-6">
            <div className="pt-4 font-mono text-[11px] uppercase tracking-widest text-ink-3">{row.phase}</div>
            <div className="relative">
              {row.caption && <p className="mb-2 text-xs text-ink-3">{row.caption}</p>}
              {grid ? (
                <div className="grid gap-2 rounded-xl border border-line/80 bg-panel/40 p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {row.nodes.map((n, j) => (
                    <NodeCard key={`${n.title}-${j}`} n={n} />
                  ))}
                </div>
              ) : (
                <div className="max-w-sm">
                  <NodeCard n={row.nodes[0]} />
                </div>
              )}
              {row.recheck && (
                <p className="mt-2 font-mono text-[11px] text-ink-3">↺ rechecked after each round of fixes</p>
              )}
              {!last && (
                <div className={`ml-6 flex h-8 items-center gap-2 ${grid ? "" : ""}`}>
                  <span className={`h-full w-px ${row.edgeBad ? "bg-bad/70" : "bg-line-strong"}`} />
                  {row.edgeNote && <span className={`text-xs ${row.edgeBad ? "text-bad" : "text-ink-3"}`}>{row.edgeNote}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!run.manifest && (
        <p className="mt-6 border-t border-line pt-4 text-xs text-ink-3">
          This run didn&apos;t write a run.json, so the graph only shows what GitHub knows. Newer runs fill in Step 0, the local checks and the fix rounds.
        </p>
      )}
    </div>
  );
}
