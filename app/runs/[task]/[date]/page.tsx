import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { Markdown } from "@/components/Markdown";
import { RunGraph } from "@/components/RunGraph";
import { ScreenshotCompare } from "@/components/ScreenshotCompare";
import { ErrorPanel, formatNight, Header, SectionTitle, TaskTag, timeAgo, VerdictPill } from "@/components/ui";
import { manifestDir } from "@/lib/manifest";
import { getRun, type RunDetail } from "@/lib/runs";
import { requireViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

const TABS = ["summary", "graph", "screens", "changes", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ task: string; date: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const viewer = await requireViewer();
  const { task, date } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "summary";

  let run: RunDetail | null;
  try {
    run = await getRun(task, date, viewer.token);
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
  if (!run) notFound();

  const pr = run.pr;
  const m = run.manifest;
  const shots = (m?.screenshots ?? []).map((s) => {
    const url = (p: string) => (/^https?:\/\//.test(p) ? p : `/api/asset?path=${encodeURIComponent(`${manifestDir(run.task.id, run.date)}/${p}`)}`);
    return { ...s, beforeUrl: s.before ? url(s.before) : null, afterUrl: url(s.after) };
  });
  const ciFailing = run.checks.filter((c) => c.status === "completed" && !["success", "neutral"].includes(c.conclusion ?? "")).length;
  const ciRunning = run.checks.filter((c) => c.status !== "completed").length;
  const humanNotes = run.feedback.filter((f) => !f.bot);
  const counts: Partial<Record<Tab, number>> = { screens: shots.length, changes: run.files.length, activity: run.feedback.length };

  return (
    <>
      <Header viewer={viewer} crumbs={[{ href: `/?task=${run.task.id}#runs`, label: run.task.label }, { label: formatNight(run.date) }]} />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-center gap-2">
          <TaskTag label={run.task.label} />
          <span className="text-xs text-ink-3">{formatNight(run.date, "long")} run</span>
          <VerdictPill verdict={run.verdict} className="ml-auto" />
        </div>
        <h1 className="mt-3 text-2xl leading-tight font-medium text-balance">{run.title}</h1>

        <div className="mt-4 flex flex-wrap gap-2">
          {pr && <LinkBtn href={pr.html_url} primary>Pull request #{pr.number} ↗</LinkBtn>}
          {run.previewUrl ? (
            <LinkBtn href={run.previewUrl} primary>Open preview ↗</LinkBtn>
          ) : (
            <span className="inline-flex h-9 items-center rounded-md border border-dashed border-line px-3 text-sm text-ink-3" title="No preview deploy for this commit">
              No preview build
            </span>
          )}
          {pr && <LinkBtn href={`${pr.html_url}/files`}>Diff ↗</LinkBtn>}
          {run.sessionUrl && <LinkBtn href={run.sessionUrl}>Run session ↗</LinkBtn>}
        </div>

        {pr && (
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Fact label="Files">
              {run.files.length} <span className="text-ok">+{pr.additions ?? 0}</span> <span className="text-bad">−{pr.deletions ?? 0}</span>
            </Fact>
            <Fact label="Commits">{run.commits.length}</Fact>
            <Fact label="CI">
              {run.checks.length === 0 ? (
                <span className="text-ink-3">none ran</span>
              ) : ciFailing ? (
                <span className="text-bad">{ciFailing} failing</span>
              ) : ciRunning ? (
                <span className="text-info">{ciRunning} running</span>
              ) : (
                <span className="text-ok">{run.checks.length} passing</span>
              )}
            </Fact>
            <Fact label="Base">
              <span className="font-mono text-xs">{pr.base.ref}</span>
              {pr.mergeable === false && <span className="ml-2 text-warn">conflicts</span>}
            </Fact>
            <Fact label="Updated">{timeAgo(pr.updated_at)}</Fact>
          </dl>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
              {TABS.map((t) => (
                <Link
                  key={t}
                  href={`?tab=${t}`}
                  scroll={false}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm capitalize ${tab === t ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
                >
                  {t}
                  {counts[t] ? <span className="font-mono text-[11px] text-ink-3">{counts[t]}</span> : null}
                </Link>
              ))}
            </nav>

            {tab === "summary" && (
              <div className="space-y-8">
                <section>
                  <SectionTitle>What changed</SectionTitle>
                  {run.summary ? <p className="text-[15px] leading-relaxed text-ink">{run.summary}</p> : <p className="text-sm text-ink-3">The run didn&apos;t leave a summary.</p>}
                </section>

                {m?.stillOpen?.length ? (
                  <section className="rounded-xl border border-warn/30 bg-warn/5 p-5">
                    <SectionTitle>Still open</SectionTitle>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
                      {m.stillOpen.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {m?.reviewFirst?.length ? (
                  <section>
                    <SectionTitle>Review first</SectionTitle>
                    <ol className="space-y-2 text-sm text-ink-2">
                      {m.reviewFirst.map((s, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="font-mono text-ink-3">{i + 1}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {shots.length > 0 && (
                  <section>
                    <SectionTitle right={shots.length > 1 ? <Link href="?tab=screens" className="text-xs text-ink-3 hover:text-ink">All {shots.length} →</Link> : null}>
                      How it looks
                    </SectionTitle>
                    <ScreenshotCompare name={shots[0].name} note={shots[0].note} before={shots[0].beforeUrl} after={shots[0].afterUrl} />
                  </section>
                )}

                {m?.next?.length ? (
                  <section>
                    <SectionTitle>Next in the series</SectionTitle>
                    <ol className="space-y-2 text-sm text-ink-2">
                      {m.next.map((s, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="font-mono text-ink-3">{i + 2}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {pr?.body && (
                  <details className="group rounded-xl border border-line bg-panel" open={!m}>
                    <summary className="cursor-pointer list-none px-5 py-3 text-sm text-ink-2 hover:text-ink">
                      <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>Full PR description
                    </summary>
                    <div className="border-t border-line px-5 py-4">
                      <Markdown>{pr.body}</Markdown>
                    </div>
                  </details>
                )}
              </div>
            )}

            {tab === "graph" && <RunGraph run={run} />}

            {tab === "screens" &&
              (shots.length ? (
                <div className="space-y-6">
                  {shots.map((s) => (
                    <ScreenshotCompare key={s.name} name={s.name} note={s.note} before={s.beforeUrl} after={s.afterUrl} />
                  ))}
                </div>
              ) : (
                <Empty>
                  No screenshots for this run.{" "}
                  {run.task.id === "design" || run.task.id === "library-feature"
                    ? "Runs from now on attach before and after shots of every screen they touch."
                    : "This task usually doesn't change the UI."}
                </Empty>
              ))}

            {tab === "changes" &&
              (run.files.length ? (
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
                  {run.files.map((f) => {
                    const total = Math.max(1, f.additions + f.deletions);
                    return (
                      <li key={f.filename}>
                        <a href={f.blob_url} target="_blank" rel="noreferrer" className="flex items-center gap-4 px-4 py-2.5 text-sm hover:bg-panel-2">
                          <span className={`w-14 shrink-0 font-mono text-[11px] ${f.status === "added" ? "text-ok" : f.status === "removed" ? "text-bad" : "text-ink-3"}`}>{f.status}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">{f.filename}</span>
                          <span className="font-mono text-xs text-ok">+{f.additions}</span>
                          <span className="font-mono text-xs text-bad">−{f.deletions}</span>
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-panel-2 sm:flex">
                            <span className="bg-ok" style={{ width: `${(f.additions / total) * 100}%` }} />
                            <span className="bg-bad" style={{ width: `${(f.deletions / total) * 100}%` }} />
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>No PR, so no diff to show.</Empty>
              ))}

            {tab === "activity" &&
              (run.feedback.length ? (
                <ol className="space-y-3">
                  {run.feedback.map((f) => (
                    <li key={f.id} className={`rounded-xl border bg-panel ${f.verdict === "changes" ? "border-warn/40" : f.verdict === "accept" ? "border-ok/40" : f.verdict === "reject" ? "border-bad/40" : "border-line"}`}>
                      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs">
                        {f.who.avatar_url && <img src={f.who.avatar_url} alt="" className="size-5 rounded-full" />}
                        <span className={f.bot ? "text-ink-3" : "text-ink"}>{f.who.login}</span>
                        {f.kind === "inline" && f.path && <span className="truncate font-mono text-[11px] text-ink-3">on {f.path}</span>}
                        <a href={f.url} target="_blank" rel="noreferrer" className="ml-auto text-ink-3 hover:text-ink">
                          {timeAgo(f.when)}
                        </a>
                      </div>
                      {f.bot && f.body.length > 600 ? (
                        <details className="px-4 py-2">
                          <summary className="cursor-pointer text-xs text-ink-3">Bot comment, {f.body.length.toLocaleString()} characters</summary>
                          <Markdown>{f.body}</Markdown>
                        </details>
                      ) : (
                        <div className="px-4 py-1">
                          <Markdown>{f.body}</Markdown>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty>No comments yet.</Empty>
              ))}
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-xl border border-line bg-panel p-4">
              <p className="mb-3 text-sm font-medium">Your feedback</p>
              {pr ? (
                <FeedbackPanel pr={pr.number} open={pr.state === "open"} draft={pr.draft} merged={!!pr.merged_at} canWrite={!!viewer.token} />
              ) : (
                <p className="text-sm text-ink-2">
                  This run couldn&apos;t open a PR, so there&apos;s nothing to comment on.
                  {m?.stillOpen?.length ? " The reason is under Still open." : ""}
                </p>
              )}
            </div>
            {humanNotes.length > 0 && (
              <div className="mt-4 rounded-xl border border-line bg-panel p-4">
                <p className="mb-2 text-xs text-ink-3">Latest from people</p>
                {humanNotes.slice(-3).map((f) => (
                  <div key={f.id} className="border-t border-line py-2 first:border-0 first:pt-0">
                    <p className="text-xs text-ink-3">
                      {f.who.login} · {timeAgo(f.when)}
                    </p>
                    <p className="mt-0.5 line-clamp-3 text-sm text-ink-2">{f.body.replace(/<!--[\s\S]*?-->/g, "").replace(/\*\*/g, "").trim()}</p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

function LinkBtn({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex h-9 items-center rounded-md border px-3 text-sm ${primary ? "border-ink bg-ink font-medium text-bg hover:bg-white" : "border-line-strong text-ink hover:bg-panel-2"}`}
    >
      {children}
    </a>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-ink-2">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-sm text-ink-3">{children}</p>;
}
