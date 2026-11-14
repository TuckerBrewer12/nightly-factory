import Link from "next/link";
import { NewTask, TaskRowControls } from "@/components/TaskControls";
import { ErrorPanel, Header, SectionTitle, timeAgo, VerdictPill } from "@/components/ui";
import { listRuns, type RunSummary } from "@/lib/runs";
import { requireViewer } from "@/lib/session";
import { describeSchedule, loadState, type FactoryState } from "@/lib/tasks";
import { workerConfigured } from "@/lib/worker";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const viewer = await requireViewer();
  let state: FactoryState;
  let saved: boolean;
  let runs: RunSummary[];
  try {
    const loaded = await loadState(viewer.token, true);
    state = loaded.state;
    saved = !!loaded.sha;
    runs = (await listRuns(viewer.token)).runs;
  } catch (e) {
    return (
      <>
        <Header viewer={viewer} crumbs={[{ label: "Tasks" }]} />
        <main className="mx-auto max-w-6xl px-5 py-10">
          <ErrorPanel message={e instanceof Error ? e.message : String(e)} />
        </main>
      </>
    );
  }
  const ready = workerConfigured();
  // The local dev login sees the buttons; the API still refuses its writes.
  const canWrite = !!viewer.token || !!viewer.dev;

  return (
    <>
      <Header viewer={viewer} crumbs={[{ label: "Tasks" }]} />
      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            Each task runs on the &quot;Nightly factory worker&quot; routine at its time, Pacific. The scheduler checks every 30 minutes, so a 1:17 task starts by 1:37.
          </p>
          {!ready && <p className="text-warn">The worker routine isn&apos;t connected (FACTORY_ROUTINE_ID / FACTORY_ROUTINE_TOKEN), so nothing here will start yet.</p>}
          {!saved && <p className="text-ink-3">These are the starting tasks; they&apos;re saved to factory.json the first time you change one.</p>}
        </div>

        {canWrite && (
          <section>
            <NewTask />
          </section>
        )}

        <section>
          <SectionTitle>{state.tasks.length} tasks</SectionTitle>
          <div className="space-y-4">
            {state.tasks.map((t) => {
              const mine = runs.filter((r) => r.task.id === t.id);
              const last = mine[0];
              return (
                <div key={t.id} className="rounded-xl border border-line bg-panel p-5">
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{t.label}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${t.enabled ? "border-ok/30 text-ok" : "border-warn/30 text-warn"}`}>{t.enabled ? "On" : "Paused"}</span>
                        <span className="font-mono text-[11px] text-ink-3">{t.id}</span>
                      </div>
                      <p className="mt-1 text-sm text-ink-2">{t.blurb}</p>
                      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        <div>
                          <dt className="text-ink-3">Schedule</dt>
                          <dd className="text-ink-2">{describeSchedule(t)}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Base branch</dt>
                          <dd className="font-mono text-ink-2">{t.baseBranch}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Screenshots</dt>
                          <dd className="text-ink-2">{t.screenshots}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Last fired</dt>
                          <dd className="text-ink-2">{state.lastFired[t.id] ?? "Not by the factory yet"}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Runs</dt>
                          <dd className="text-ink-2">
                            <Link href={`/?task=${t.id}#runs`} className="hover:underline">
                              {mine.length}
                            </Link>
                          </dd>
                        </div>
                      </dl>
                      {last && (
                        <Link href={`/runs/${t.id}/${last.id}`} className="mt-3 flex items-center gap-2 text-xs text-ink-3 hover:text-ink">
                          Last run: <span className="truncate text-ink-2">{last.title}</span> <VerdictPill verdict={last.verdict} />
                          {last.pr && <span>{timeAgo(last.pr.updated_at)}</span>}
                        </Link>
                      )}
                    </div>
                    {canWrite && (
                      <div className="w-full sm:w-auto">
                        <TaskRowControls task={t} ready={ready} />
                      </div>
                    )}
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink">Instructions</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{t.prompt}</pre>
                  </details>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
