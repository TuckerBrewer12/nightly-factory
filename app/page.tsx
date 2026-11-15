import Link from "next/link";
import { factory } from "@/factory.config";
import { ReviewQueue, type QueueItem } from "@/components/ReviewQueue";
import { ErrorPanel, formatNight, Header, runLabel, SectionTitle, TaskTag, timeAgo, VERDICT_DOT, VerdictPill } from "@/components/ui";
import { baseStatuses, isAccepted, isOpen, lastNights, listRuns, needsYou, taskStats, VERDICT_TEXT, type BaseStatus, type RunSummary } from "@/lib/runs";
import { requireViewer } from "@/lib/session";
import { describeSchedule, type FactoryTask } from "@/lib/tasks";
import { serverTokenStatus } from "@/lib/github";
import { workerConfigured } from "@/lib/worker";

export const dynamic = "force-dynamic";

const runHref = (r: RunSummary) => `/runs/${r.task.id}/${r.id}`;

export default async function Overview({ searchParams }: { searchParams: Promise<{ task?: string; show?: string }> }) {
  const viewer = await requireViewer();
  const { task: taskFilter, show } = await searchParams;

  let runs: RunSummary[];
  let tasks: FactoryTask[];
  let bases: Record<string, BaseStatus>;
  try {
    ({ runs, tasks } = await listRuns(viewer.token));
    bases = await baseStatuses(tasks, viewer.token);
  } catch (e) {
    return (
      <>
        <Header viewer={viewer} />
        <main className="mx-auto max-w-6xl px-5 py-10">
          <ErrorPanel message={e instanceof Error ? e.message : String(e)} />
        </main>
      </>
    );
  }

  const nights = lastNights(factory.nights);
  // Tasks first, then any task that only exists in old runs.
  const shownTasks = [...tasks, ...[...new Map(runs.filter((r) => !tasks.some((t) => t.id === r.task.id)).map((r) => [r.task.id, r.task])).values()]];
  const stats = taskStats(shownTasks, runs, nights);
  const queue = runs.filter((r) => needsYou(r.verdict));
  const running = runs.filter((r) => r.verdict === "running");
  const waiting = runs.filter((r) => r.verdict === "changes");
  const decided = runs.filter((r) => isAccepted(r.verdict) || r.verdict === "rejected");
  const accepted = runs.filter((r) => isAccepted(r.verdict));
  const missed = stats.reduce((n, s) => n + s.missed, 0);

  const queueItems: QueueItem[] = queue.map((r) => ({
    key: `${r.task.id}/${r.id}`,
    href: runHref(r),
    task: r.task.label,
    night: r.id.slice(5),
    title: r.title,
    summary: r.summary,
    verdict: r.verdict as QueueItem["verdict"],
    pr: r.pr?.number ?? null,
  }));

  const listed = runs.filter((r) => (!taskFilter || r.task.id === taskFilter) && (show !== "open" || isOpen(r.verdict)));
  const noWorker = !workerConfigured();
  const tokenStatus = serverTokenStatus();
  const anyEnabled = tasks.some((t) => t.enabled);

  return (
    <>
      <Header viewer={viewer} />
      <main className="mx-auto max-w-6xl space-y-10 px-5 py-8">
        {tokenStatus !== "ok" && (
          <div className="rounded-xl border border-warn/30 bg-warn/5 px-5 py-3 text-sm text-ink-2">
            {tokenStatus === "rejected"
              ? "GitHub rejected the GITHUB_TOKEN set in Vercel (401), so pages are reading with your own sign-in. The scheduler can't start runs until it's replaced with a valid token."
              : "GITHUB_TOKEN isn't set in Vercel. Pages read with your own sign-in; the scheduler needs it to start runs."}
          </div>
        )}
        {(noWorker || !anyEnabled) && (
          <div className="rounded-xl border border-info/30 bg-info/5 px-5 py-3 text-sm text-ink-2">
            {noWorker
              ? "The worker routine isn't connected yet, so Run now, Build and Open PR are off and the factory's schedule is idle. Add FACTORY_ROUTINE_ID and FACTORY_ROUTINE_TOKEN in Vercel."
              : "All tasks are paused here. Turn them on under Tasks once the claude.ai scheduled tasks are off, so nothing runs twice."}
          </div>
        )}

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-5">
          <Kpi label="Needs you" value={queue.length} tone={queue.length ? "warn" : "ink"} />
          <Kpi label="Running" value={running.length} tone={running.length ? "info" : "ink"} />
          <Kpi label="Waiting on a run" value={waiting.length} hint="Changes requested" />
          <Kpi
            label="Accepted"
            value={`${accepted.length}/${runs.length}`}
            hint={decided.length ? `${Math.round((accepted.length / decided.length) * 100)}% of decided runs` : "Nothing decided yet"}
            tone="ok"
          />
          <Kpi label={`Missed · last ${factory.nights}`} value={missed} hint="Nights with no run" tone={missed ? "bad" : "ink"} />
        </section>

        <section>
          <SectionTitle>Needs your review</SectionTitle>
          <ReviewQueue items={queueItems} />
        </section>

        <section>
          <SectionTitle right={<Link href="/tasks" className="text-xs text-ink-3 hover:text-ink">Manage tasks →</Link>}>Tasks</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => {
              const total = Math.max(1, s.runs);
              const base = bases[s.task.id];
              return (
                <div key={s.task.id} className="flex flex-col rounded-xl border border-line bg-panel p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/?task=${s.task.id}#runs`} className="font-medium hover:underline">
                      {s.task.label}
                    </Link>
                    <span className={`whitespace-nowrap font-mono text-[11px] ${s.task.enabled ? "text-ink-3" : "text-warn"}`}>
                      {s.task.enabled ? describeSchedule(s.task).replace("Daily at ", "") : "Paused"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-8 text-xs text-ink-3">{s.task.blurb}</p>
                  <p className="mt-3 font-mono text-2xl tabular-nums">
                    {s.accepted}
                    <span className="text-ink-3">/{s.runs}</span>
                  </p>
                  <p className="text-xs text-ink-2">accepted / runs</p>
                  <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <span className="bg-ok" style={{ width: `${(s.accepted / total) * 100}%` }} />
                    <span className="bg-warn/80" style={{ width: `${(s.open / total) * 100}%` }} />
                    <span className="bg-ink-3/60" style={{ width: `${(s.rejected / total) * 100}%` }} />
                  </div>
                  <dl className="mb-4 mt-4 grid grid-cols-3 gap-2 text-xs">
                    <Mini label="Open" value={s.open} />
                    <Mini label="Rejected" value={s.rejected} />
                    <Mini label="Missed" value={s.missed} bad={s.missed > 0} />
                  </dl>
                  <div className="mt-auto border-t border-line pt-3 text-xs">
                    <p className="truncate font-mono text-[11px] text-ink-2">{s.task.baseBranch}</p>
                    {base ? (
                      <a href={base.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-ink-3 hover:text-ink">
                        {base.ahead === 0 && base.behind === 0 ? (
                          "Same as main"
                        ) : (
                          <>
                            <span className={base.ahead ? "text-ok" : ""}>{base.ahead} ahead</span>, <span className={base.behind ? "text-warn" : ""}>{base.behind} behind</span> main ↗
                          </>
                        )}
                      </a>
                    ) : (
                      <p className="mt-0.5 text-bad">Branch not found</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle
            right={
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-ink-3">
                {(["needs-review", "unopened", "plan", "changes", "accepted", "rejected"] as const).map((v) => (
                  <span key={v} className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-sm ${VERDICT_DOT[v]}`} />
                    {VERDICT_TEXT[v]}
                  </span>
                ))}
              </div>
            }
          >
            Last {factory.nights} nights
          </SectionTitle>
          <div className="overflow-x-auto rounded-xl border border-line bg-panel p-4">
            <table className="w-full border-separate border-spacing-1">
              <thead>
                <tr>
                  <th />
                  {[...nights].reverse().map((d) => (
                    <th key={d} className="px-0.5 text-center font-mono text-[10px] font-normal text-ink-3">
                      {d.slice(5).replace("-", "/")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownTasks.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap pr-3 text-xs text-ink-2">{t.label}</td>
                    {[...nights].reverse().map((d) => {
                      const dayRuns = runs.filter((x) => x.task.id === t.id && x.date === d);
                      const r = dayRuns.find((x) => x.id === d) ?? dayRuns[0];
                      return (
                        <td key={d} className="p-0">
                          {r ? (
                            <Link
                              href={runHref(r)}
                              title={`${r.title} · ${VERDICT_TEXT[r.verdict]}${dayRuns.length > 1 ? ` (+${dayRuns.length - 1} more that day)` : ""}`}
                              className={`relative block h-7 min-w-7 rounded-md ${VERDICT_DOT[r.verdict]} opacity-85 hover:opacity-100 hover:ring-2 hover:ring-ink/40`}
                            >
                              {dayRuns.length > 1 && <span className="absolute right-0.5 top-0 font-mono text-[9px] text-bg">+{dayRuns.length - 1}</span>}
                            </Link>
                          ) : (
                            <span title="No run" className="block h-7 min-w-7 rounded-md border border-dashed border-line" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="runs">
          <SectionTitle
            right={
              <div className="flex flex-wrap gap-1 text-xs">
                <Filter href="/#runs" active={!taskFilter && show !== "open"}>
                  All
                </Filter>
                <Filter href={`/?${taskFilter ? `task=${taskFilter}&` : ""}show=open#runs`} active={show === "open"}>
                  Open only
                </Filter>
                {shownTasks.map((t) => (
                  <Filter key={t.id} href={`/?task=${t.id}${show ? `&show=${show}` : ""}#runs`} active={taskFilter === t.id}>
                    {t.label}
                  </Filter>
                ))}
              </div>
            }
          >
            All runs
          </SectionTitle>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {listed.length === 0 && <li className="px-5 py-6 text-sm text-ink-3">No runs match.</li>}
            {listed.map((r) => (
              <li key={`${r.task.id}/${r.id}`}>
                <Link href={runHref(r)} className="flex items-center gap-4 px-5 py-2.5 text-sm hover:bg-panel-2">
                  <span className="w-28 shrink-0 font-mono text-xs text-ink-3">{r.id === r.date ? formatNight(r.id) : runLabel(r.id)}</span>
                  <span className="hidden w-36 shrink-0 sm:block">
                    <TaskTag label={r.task.label} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  {r.pr && <span className="hidden font-mono text-xs text-ink-3 md:inline">{timeAgo(r.pr.updated_at)}</span>}
                  <VerdictPill verdict={r.verdict} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: number | string; hint?: string; tone?: "ink" | "ok" | "warn" | "bad" | "info" }) {
  const color = { ink: "text-ink", ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" }[tone];
  return (
    <div className="bg-panel p-4">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-1.5 font-mono text-2xl tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

function Mini({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className={`font-mono tabular-nums ${bad ? "text-bad" : "text-ink-2"}`}>{value}</dd>
    </div>
  );
}

function Filter({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-md border px-2 py-1 ${active ? "border-line-strong bg-panel-2 text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>
      {children}
    </Link>
  );
}
