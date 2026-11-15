import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { DiffView } from "@/components/DiffView";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { Markdown } from "@/components/Markdown";
import { LocalRun } from "@/components/RunActions";
import { BuildPlanButton, DismissButton, FeedbackNowButton, NextSteps, OpenPrButton } from "@/components/RunControls";
import { RunGraph } from "@/components/RunGraph";
import { ScreenshotCompare } from "@/components/ScreenshotCompare";
import { ErrorPanel, Header, runLabel, SectionTitle, TaskTag, timeAgo, VerdictPill } from "@/components/ui";
import { manifestDir } from "@/lib/manifest";
import { getRun, type RunDetail } from "@/lib/runs";
import { requireViewer } from "@/lib/session";
import { workerConfigured } from "@/lib/worker";

export const dynamic = "force-dynamic";

const TABS = ["summary", "graph", "changes", "screens", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function RunPage({ params, searchParams }: { params: Promise<{ task: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const viewer = await requireViewer();
  const { task, id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "summary";

  let run: RunDetail;
  try {
    const found = await getRun(task, id, viewer.token);
    if (!found) notFound();
    run = found.run;
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // notFound()
    return (
      <>
        <Header viewer={viewer} />
        <main className="mx-auto max-w-6xl px-5 py-10">
          <ErrorPanel error={e} />
        </main>
      </>
    );
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const ready = workerConfigured();
  // The local dev login sees the buttons; the API still refuses its writes.
  const canWrite = !!viewer.token || !!viewer.dev;
  const pr = run.pr;
  const m = run.manifest;
  const dir = manifestDir(run.task.id, run.id);
  const assetUrl = (p: string) => (/^https?:\/\//.test(p) ? p : `/api/asset?path=${encodeURIComponent(`${dir}/${p}`)}`);
  const shots = (m?.screenshots ?? []).map((s) => ({ ...s, beforeUrl: s.before ? assetUrl(s.before) : null, afterUrl: assetUrl(s.after) }));
  const ciFailing = run.checks.filter((c) => c.status === "completed" && !["success", "neutral"].includes(c.conclusion ?? "")).length;
  const ciRunning = run.checks.filter((c) => c.status !== "completed").length;
  const humanNotes = run.feedback.filter((f) => !f.bot);
  const adds = run.diff.reduce((s, f) => s + f.additions, 0);
  const dels = run.diff.reduce((s, f) => s + f.deletions, 0);
  const counts: Partial<Record<Tab, number>> = { screens: shots.length, changes: run.diff.length, activity: run.feedback.length };
  const wide = tab === "graph" || tab === "changes";
  const unopened = run.verdict === "unopened";

  return (
    <>
      <Header viewer={viewer} wide={wide} crumbs={[{ href: `/?task=${run.task.id}#runs`, label: run.task.label }, { label: runLabel(run.id) }]} />
      <main className={`mx-auto px-5 py-8 ${wide ? "max-w-none xl:px-10" : "max-w-6xl"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <TaskTag label={run.task.label} />
          <span className="text-xs text-ink-3">{runLabel(run.id)}</span>
          {m?.origin?.kind && m.origin.kind !== "schedule" && <span className="text-xs text-ink-3">· {originText(m.origin)}</span>}
          <VerdictPill verdict={run.verdict} className="ml-auto" />
        </div>
        <h1 className="mt-3 text-2xl leading-tight font-medium text-balance">{run.title}</h1>

        <div className="mt-4 flex flex-wrap items-start gap-2">
          {pr && <LinkBtn href={pr.html_url} primary>Pull request #{pr.number} ↗</LinkBtn>}
          {pr && pr.state === "open" && <LocalRun job={{ kind: "pr", pr: pr.number }} factoryOrigin={origin} />}
          {!pr && m?.patch && <LocalRun job={{ kind: "patch", task: run.task.id, id: run.id, base: run.task.baseBranch, patchUrl: assetUrl(m.patch) }} factoryOrigin={origin} />}
          {unopened && canWrite && <OpenPrButton task={run.task.id} id={run.id} ready={ready} />}
          {run.verdict === "plan" && canWrite && <BuildPlanButton task={run.task.id} id={run.id} ready={ready} />}
          {run.previewUrl && <LinkBtn href={run.previewUrl}>Open preview ↗</LinkBtn>}
          {run.sessionUrl && <LinkBtn href={run.sessionUrl}>Run session ↗</LinkBtn>}
          {pr && pr.state === "open" && canWrite && <FeedbackNowButton task={run.task.id} id={run.id} pr={pr.number} ready={ready} />}
          {(unopened || run.verdict === "plan") && canWrite && <DismissButton task={run.task.id} id={run.id} />}
        </div>
        {!ready && (unopened || run.verdict === "plan") && <p className="mt-2 text-xs text-ink-3">Open PR and Build need the worker routine connected in Vercel.</p>}

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {run.diff.length > 0 && (
            <Fact label="Files">
              {run.diff.length} <span className="text-ok">+{adds}</span> <span className="text-bad">−{dels}</span>
            </Fact>
          )}
          {pr && <Fact label="Commits">{run.commits.length}</Fact>}
          {pr && (
            <Fact label="CI">
              {run.checks.length === 0 ? <span className="text-ink-3">none ran</span> : ciFailing ? <span className="text-bad">{ciFailing} failing</span> : ciRunning ? <span className="text-info">{ciRunning} running</span> : <span className="text-ok">{run.checks.length} passing</span>}
            </Fact>
          )}
          {pr && run.bots.length > 0 && (
            <Fact label="Bots">
              {run.bots.map((b) => (b.state === "findings" ? `${b.findings - b.answered}/${b.findings}` : "✓")).join(" · ")}
            </Fact>
          )}
          <Fact label="Base">
            <span className="font-mono text-xs">{pr?.base.ref ?? run.task.baseBranch}</span>
            {pr?.mergeable === false && <span className="ml-2 text-warn">conflicts</span>}
          </Fact>
          {pr && <Fact label="Updated">{timeAgo(pr.updated_at)}</Fact>}
        </dl>

        <nav className="mb-6 mt-8 flex gap-1 overflow-x-auto border-b border-line">
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

        {tab === "graph" && <RunGraph run={run} />}

        {tab === "changes" &&
          (run.diff.length ? (
            <DiffView files={run.diff} source={run.diffSource} />
          ) : (
            <Empty>
              {m?.patchSource
                ? `This run's diff wasn't copied over. Its patch is in the BirdieEyeView Project as ${m.patchSource}; Open PR applies it.`
                : run.verdict === "plan"
                  ? "A plan-only run has no diff."
                  : "No diff for this run."}
            </Empty>
          ))}

        {!wide && (
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              {tab === "summary" && (
                <div className="space-y-8">
                  <section>
                    <SectionTitle>What changed</SectionTitle>
                    {run.summary ? <p className="text-[15px] leading-relaxed text-ink">{run.summary}</p> : <p className="text-sm text-ink-3">{run.verdict === "running" ? "Still running." : "The run didn't leave a summary."}</p>}
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

                  {m?.plan && (
                    <section>
                      <SectionTitle>The plan</SectionTitle>
                      <div className="rounded-xl border border-line bg-panel px-5 py-3">
                        <Markdown>{m.plan}</Markdown>
                      </div>
                    </section>
                  )}

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
                      <SectionTitle right={shots.length > 1 ? <Link href="?tab=screens" className="text-xs text-ink-3 hover:text-ink">All {shots.length} →</Link> : null}>How it looks</SectionTitle>
                      <ScreenshotCompare name={shots[0].name} note={shots[0].note} before={shots[0].beforeUrl} after={shots[0].afterUrl} />
                    </section>
                  )}

                  {m?.next?.length ? (
                    <section>
                      <SectionTitle>Next in the series</SectionTitle>
                      {canWrite ? (
                        <NextSteps task={run.task.id} id={run.id} steps={m.next} ready={ready} />
                      ) : (
                        <ol className="space-y-2 text-sm text-ink-2">
                          {m.next.map((s, i) => (
                            <li key={i} className="flex gap-3">
                              <span className="font-mono text-ink-3">{i + 2}</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                  ) : null}

                  {m?.reportSource && !pr && <p className="text-xs text-ink-3">Full write-up: {m.reportSource} in the BirdieEyeView Project.</p>}

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

              {tab === "screens" &&
                (shots.length ? (
                  <div className="space-y-6">
                    {shots.map((s) => (
                      <ScreenshotCompare key={s.name} name={s.name} note={s.note} before={s.beforeUrl} after={s.afterUrl} />
                    ))}
                  </div>
                ) : (
                  <Empty>No screenshots for this run.</Empty>
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
                  <FeedbackPanel pr={pr.number} open={pr.state === "open"} draft={pr.draft} merged={!!pr.merged_at} canWrite={canWrite} />
                ) : unopened ? (
                  <p className="text-sm text-ink-2">No PR yet, so nothing to comment on. Open PR has the worker apply this change to {run.task.baseBranch} and open it; Dismiss drops it.</p>
                ) : run.verdict === "plan" ? (
                  <p className="text-sm text-ink-2">This run only planned. Build this plan starts a run that implements it as a PR.</p>
                ) : (
                  <p className="text-sm text-ink-2">{run.verdict === "running" ? "Still running." : "Nothing to review on this run."}</p>
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
        )}
      </main>
    </>
  );
}

function originText(o: NonNullable<NonNullable<RunDetail["manifest"]>["origin"]>) {
  const by = o.by ? ` by ${o.by}` : "";
  if (o.kind === "manual") return `started${by}`;
  if (o.kind === "build-step") return `built from ${o.from}${by}`;
  if (o.kind === "open-pr") return `PR opened${by}`;
  if (o.kind === "feedback") return `feedback round${by}`;
  return "";
}

function LinkBtn({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex h-9 items-center whitespace-nowrap rounded-md border px-3 text-[13px] ${primary ? "border-accent bg-accent font-medium text-on-accent hover:opacity-90" : "border-line-strong text-ink hover:bg-panel-2"}`}
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
