import type { RunDetail } from "@/lib/runs";
import { VERDICT_TEXT } from "@/lib/runs";
import type { Stage } from "@/lib/manifest";

// The run as a left-to-right pipeline. Each column is a phase; a column with
// several nodes (local checks, CI, bots) stacks them.

type Tone = "ok" | "warn" | "fail" | "skipped" | "pending";
type Node = { title: string; detail: string; meta?: string; tone: Tone; badge?: string; href?: string };
type Column = { phase: string; nodes: Node[]; caption?: string; edgeNote?: string; edgeBad?: boolean; recheck?: boolean };

const ICON: Record<Tone, { glyph: string; cls: string }> = {
  ok: { glyph: "✓", cls: "text-ok" },
  warn: { glyph: "!", cls: "text-warn" },
  fail: { glyph: "✕", cls: "text-bad" },
  skipped: { glyph: "–", cls: "text-ink-3" },
  pending: { glyph: "○", cls: "text-info" },
};

const DETAIL_TONE: Record<Tone, string> = { ok: "text-ink-2", warn: "text-warn", fail: "text-bad", skipped: "text-ink-3", pending: "text-info" };

const toneOf = (s: Stage["status"]): Tone => (s === "ok" ? "ok" : s === "warn" ? "warn" : s === "fail" ? "fail" : "skipped");
const secs = (n?: number) => (n === undefined ? undefined : n >= 90 ? `${Math.round(n / 60)}m` : `${Math.round(n)}s`);

function stageNode(s: Stage): Node {
  return { title: s.label, detail: s.detail, tone: toneOf(s.status), meta: secs(s.seconds), badge: s.rounds && s.rounds > 1 ? `${s.rounds} rounds` : undefined };
}

const KNOWN = ["followup", "context", "build", "pr", "fix"];

export function buildColumns(run: RunDetail): Column[] {
  const m = run.manifest;
  const stage = (id: string) => m?.stages?.find((s) => s.id === id);
  const cols: Column[] = [];
  const running = run.verdict === "running";

  cols.push({
    phase: "Trigger",
    nodes: [
      {
        title: m?.origin?.kind === "build-step" ? "Built from a plan" : m?.origin?.kind === "manual" ? "Started by hand" : m?.origin?.kind === "open-pr" ? "Open PR" : "Scheduled run",
        detail: m?.origin?.by ? `${run.task.label}, by ${m.origin.by}` : run.task.label,
        meta: m?.startedAt ? new Date(m.startedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : run.id,
        tone: "ok",
        href: run.sessionUrl ?? undefined,
      },
    ],
  });

  const followup = stage("followup");
  if (followup) cols.push({ phase: "Step 0", nodes: [stageNode(followup)] });

  const context = stage("context");
  if (context) cols.push({ phase: "Prepare", nodes: [stageNode(context)] });

  const build = stage("build");
  const adds = run.diff.reduce((s, f) => s + f.additions, 0);
  const dels = run.diff.reduce((s, f) => s + f.deletions, 0);
  const filesLine = run.diff.length ? `${run.diff.length} files, +${adds} −${dels}` : "";
  cols.push({
    phase: "Build",
    nodes: [
      build
        ? { ...stageNode(build), detail: build.detail || filesLine }
        : running
          ? { title: "Builder", detail: "In progress", tone: "pending" }
          : { title: "Builder", detail: filesLine || "No changes recorded", tone: filesLine ? "ok" : "skipped" },
    ],
  });

  for (const s of m?.stages ?? []) if (!KNOWN.includes(s.id)) cols.push({ phase: s.id.replace(/[-_]/g, " "), nodes: [stageNode(s)] });

  if (m?.checks?.length) {
    const failed = m.checks.filter((c) => c.status === "fail").length;
    cols.push({
      phase: "Verify",
      caption: "Run locally",
      nodes: m.checks.map((c) => ({
        title: c.name,
        detail: c.detail ?? (c.status === "pass" ? "Passed" : c.status === "fail" ? "Failed" : "Skipped"),
        tone: c.status === "pass" ? "ok" : c.status === "fail" ? "fail" : "skipped",
      })),
      edgeNote: failed ? `${failed} failing` : undefined,
      edgeBad: failed > 0,
    });
  }

  const prStage = stage("pr");
  cols.push({
    phase: "Ship",
    nodes: [
      run.pr
        ? { title: run.pr.draft ? "Draft PR" : "Pull request", detail: `#${run.pr.number} into ${run.pr.base.ref}`, meta: run.branch, tone: "ok", href: run.pr.html_url }
        : prStage
          ? stageNode(prStage)
          : running
            ? { title: "Pull request", detail: "Not yet", tone: "pending" }
            : { title: "Pull request", detail: run.verdict === "plan" ? "Plan only, no code" : "Not opened", tone: run.verdict === "plan" ? "skipped" : "fail" },
    ],
    edgeNote: !run.pr && !running && run.verdict !== "plan" ? "unopened" : undefined,
    edgeBad: !run.pr && !running && run.verdict !== "plan",
  });

  if (run.pr) {
    const ci: Node[] = run.checks.map((c) => ({
      title: c.name,
      detail: c.status !== "completed" ? "Running" : c.conclusion === "success" ? "Passed" : c.conclusion === "neutral" ? "Neutral" : (c.conclusion ?? ""),
      tone: c.status !== "completed" ? "pending" : c.conclusion === "success" || c.conclusion === "neutral" ? "ok" : "fail",
      href: c.html_url,
    }));
    const failing = ci.filter((n) => n.tone === "fail").length;
    cols.push({
      phase: "CI",
      caption: ci.length ? "Latest commit" : undefined,
      nodes: ci.length ? ci : [{ title: "CI", detail: "No checks ran", tone: "skipped" }],
      edgeNote: failing ? `${failing} failing` : undefined,
      edgeBad: failing > 0,
    });

    const botNodes: Node[] = run.bots.map((b) => ({
      title: b.name.replace(/^[^\w]+\s*/, ""),
      detail: b.state === "clean" ? "Nothing found" : b.state === "findings" ? `${b.findings} found, ${b.answered} answered` : b.summary || "Commented",
      tone: b.state === "clean" ? "ok" : b.state === "findings" ? (b.answered >= b.findings ? "ok" : "warn") : "ok",
      href: b.url,
    }));
    const open = run.bots.reduce((s, b) => s + Math.max(0, b.findings - b.answered), 0);
    cols.push({
      phase: "Review bots",
      nodes: botNodes.length ? botNodes : [{ title: "Review bots", detail: "Nothing posted yet", tone: "skipped" }],
      edgeNote: open ? `${open} unanswered` : undefined,
      edgeBad: open > 0,
    });
  }

  const fix = stage("fix");
  if (fix) cols.push({ phase: "Fix", nodes: [stageNode(fix)], recheck: true });

  const v = run.verdict;
  cols.push({
    phase: "Review",
    nodes: [
      {
        title: "Your review",
        detail: VERDICT_TEXT[v],
        tone: v === "accepted" || v === "merged" ? "ok" : v === "rejected" || v === "no-pr" ? "fail" : v === "changes" || v === "running" ? "pending" : "warn",
      },
    ],
  });

  return cols;
}

function NodeCard({ n }: { n: Node }) {
  const icon = ICON[n.tone];
  const inner = (
    <div className={`flex w-56 gap-2.5 rounded-lg border bg-panel px-3.5 py-2.5 text-left ${n.tone === "fail" ? "border-bad/50" : "border-line"} ${n.href ? "hover:border-line-strong" : ""}`}>
      <span className={`mt-0.5 w-3 shrink-0 text-center text-sm font-semibold ${icon.cls}`}>{icon.glyph}</span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm text-ink">
          <span className="truncate">{n.title}</span>
          {n.badge && <span className="shrink-0 rounded bg-panel-2 px-1.5 font-mono text-[10px] text-ink-3">{n.badge}</span>}
        </p>
        {n.detail && <p className={`mt-0.5 line-clamp-3 text-[12.5px] leading-snug ${DETAIL_TONE[n.tone]}`}>{n.detail}</p>}
        {n.meta && <p className="mt-1 truncate font-mono text-[10.5px] text-ink-3">{n.meta}</p>}
      </div>
    </div>
  );
  return n.href ? (
    <a href={n.href} target="_blank" rel="noreferrer" className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}

export function RunGraph({ run }: { run: RunDetail }) {
  const cols = buildColumns(run);
  return (
    <div className="rounded-xl border border-line bg-panel/40">
      <div className="overflow-x-auto px-6 py-6">
        <div className="flex min-h-[55vh] w-max items-start">
          {cols.map((c, i) => {
            const last = i === cols.length - 1;
            return (
              <div key={`${c.phase}-${i}`} className="flex items-start">
                <div className="flex flex-col">
                  <p className="mb-1 font-mono text-[10.5px] uppercase tracking-widest text-ink-3">{c.phase}</p>
                  <p className="mb-2 h-4 text-[11px] text-ink-3">{c.caption ?? ""}</p>
                  <div className={`flex flex-col gap-2 ${c.nodes.length > 1 ? "rounded-xl border border-line/80 bg-panel/50 p-1.5" : ""}`}>
                    {c.nodes.map((n, j) => (
                      <NodeCard key={`${n.title}-${j}`} n={n} />
                    ))}
                  </div>
                  {c.recheck && <p className="mt-2 font-mono text-[10.5px] text-ink-3">↺ back to CI after each round</p>}
                </div>
                {!last && (
                  <div className="relative mt-[3.65rem] flex w-14 flex-col items-center">
                    <span className={`h-px w-full ${c.edgeBad ? "bg-bad/70" : "bg-line-strong"}`} />
                    <span className={`absolute -right-0.5 -top-[5px] text-[10px] ${c.edgeBad ? "text-bad/80" : "text-ink-3"}`}>▸</span>
                    {c.edgeNote && <span className={`mt-1 whitespace-nowrap text-[10.5px] ${c.edgeBad ? "text-bad" : "text-ink-3"}`}>{c.edgeNote}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!run.manifest && (
        <p className="border-t border-line px-6 py-3 text-xs text-ink-3">
          This run didn&apos;t write a run.json, so the graph shows only what GitHub knows. Newer runs fill in Step 0, the local checks and the fix rounds.
        </p>
      )}
    </div>
  );
}
