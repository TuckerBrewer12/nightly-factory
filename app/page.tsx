import Link from "next/link";
import { factory } from "@/factory.config";
import { ErrorPanel, formatNight, Header, SectionTitle, TaskTag, timeAgo, VERDICT_DOT, VerdictPill } from "@/components/ui";
import { isAccepted, lastNights, listRuns, needsYou, taskStats, VERDICT_TEXT, type RunSummary } from "@/lib/runs";
import { requireViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

const runHref = (r: RunSummary) => `/runs/${r.task.id}/${r.date}`;

export default async function Overview({ searchParams }: { searchParams: Promise<{ task?: string; show?: string }> }) {
  const viewer = await requireViewer();
  const { task: taskFilter, show } = await searchParams;

  let runs: RunSummary[];
  try {
    runs = await listRuns(viewer.token);
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
  const stats = taskStats(runs, nights);
  const queue = runs.filter((r) => needsYou(r.verdict));
  const waiting = runs.filter((r) => r.verdict === "changes");
  const decided = runs.filter((r) => isAccepted(r.verdict) || r.verdict === "rejected");
  const accepted = runs.filter((r) => isAccepted(r.verdict));
  const withPr = runs.filter((r) => r.pr);
  const missed = stats.reduce((n, s) => n + s.missed, 0);

  const listed = runs.filter((r) => (!taskFilter || r.task.id === taskFilter) && (show !== "open" || !(isAccepted(r.verdict) || r.verdict === "rejected")));

  return (
    <>
      <Header viewer={viewer} />
      <main className="mx-auto max-w-6xl space-y-12 px-5 py-8">
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          <Kpi label="Needs your review" value={queue.length} tone={queue.length ? "warn" : "ink"} />
          <Kpi label="Waiting on a run" value={waiting.length} hint="Changes requested" />
          <Kpi
            label="Accepted"
            value={`${accepted.length}/${withPr.length}`}
            hint={decided.length ? `${Math.round((accepted.length / decided.length) * 100)}% of decided runs` : "Nothing decided yet"}
            tone="ok"
          />
          <Kpi label={`Missed nights · last ${factory.nights}`} value={missed} hint="No PR opened" tone={missed ? "bad" : "ink"} />
        </section>

        <section>
          <SectionTitle right={<span className="text-xs text-ink-3">{queue.length ? `${queue.length} waiting` : ""}</span>}>Needs your review</SectionTitle>
          {queue.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-3">Nothing is waiting on you.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
              {queue.map((r) => (
                <li key={r.branch}>
                  <Link href={runHref(r)} className="group flex flex-col gap-2 px-5 py-4 hover:bg-panel-2 md:flex-row md:items-start md:gap-5">
                    <div className="flex w-56 shrink-0 items-center gap-2 md:pt-0.5">
                      <TaskTag label={r.task.label} />
                      <span className="whitespace-nowrap text-xs text-ink-3">{formatNight(r.date)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium group-hover:text-white">{r.title}</p>
                      {r.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{r.summary}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {r.pr && <span className="font-mono text-xs text-ink-3">#{r.pr.number}</span>}
                      <VerdictPill verdict={r.verdict} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Tasks</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => {
              const total = Math.max(1, s.runs);
              return (
                <Link key={s.task.id} href={`/?task=${s.task.id}#runs`} className="rounded-xl border border-line bg-panel p-5 hover:border-line-strong">
                  <div className="flex items-baseline justify-between">
                    <p className="font-medium">{s.task.label}</p>
                    <p className="font-mono text-[11px] text-ink-3">{s.task.schedule}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-10 text-xs text-ink-3">{s.task.blurb}</p>
                  <p className="mt-4 font-mono text-2xl tabular-nums">
                    {s.accepted}
                    <span className="text-ink-3">/{s.runs}</span>
                  </p>
                  <p className="text-xs text-ink-2">accepted / runs</p>
                  <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <span className="bg-ok" style={{ width: `${(s.accepted / total) * 100}%` }} />
                    <span className="bg-warn/80" style={{ width: `${(s.open / total) * 100}%` }} />
                    <span className="bg-ink-3/60" style={{ width: `${(s.rejected / total) * 100}%` }} />
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <Mini label="Open" value={s.open} />
                    <Mini label="Rejected" value={s.rejected} />
                    <Mini label="Missed" value={s.missed} bad={s.missed > 0} />
                  </dl>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle
            right={
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-ink-3">
                {(["needs-review", "changes", "accepted", "rejected", "no-pr"] as const).map((v) => (
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
                {factory.tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap pr-3 text-xs text-ink-2">{t.label}</td>
                    {[...nights].reverse().map((d) => {
                      const r = runs.find((x) => x.task.id === t.id && x.date === d);
                      return (
                        <td key={d} className="p-0">
                          {r ? (
                            <Link
                              href={runHref(r)}
                              title={`${r.title} · ${VERDICT_TEXT[r.verdict]}`}
                              className={`block h-7 min-w-7 rounded-md ${VERDICT_DOT[r.verdict]} opacity-80 hover:opacity-100 hover:ring-2 hover:ring-ink/40`}
                            />
                          ) : (
                            <span title="No PR" className="block h-7 min-w-7 rounded-md border border-dashed border-line" />
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
                <Filter href="/#runs" active={!taskFilter && show !== "open"}>All</Filter>
                <Filter href={`/?${taskFilter ? `task=${taskFilter}&` : ""}show=open#runs`} active={show === "open"}>Open only</Filter>
                {factory.tasks.map((t) => (
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
              <li key={r.branch}>
                <Link href={runHref(r)} className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-panel-2">
                  <span className="w-20 shrink-0 font-mono text-xs text-ink-3">{r.date.slice(5)}</span>
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

function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: number | string; hint?: string; tone?: "ink" | "ok" | "warn" | "bad" }) {
  const color = { ink: "text-ink", ok: "text-ok", warn: "text-warn", bad: "text-bad" }[tone];
  return (
    <div className="bg-panel p-5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-2 font-mono text-3xl tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
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
