import { factory, LABELS, type TaskConfig } from "@/factory.config";
import { GitHubError, ghGet, pool, repoPath } from "@/lib/github";
import { manifestDir, parseManifest, type RunManifest } from "@/lib/manifest";
import { FEEDBACK_MARKER } from "@/lib/feedback-marker";
import { localArtifacts } from "@/lib/local-artifacts";

// ---------- shapes from the GitHub REST API (only what we read) ----------

type GhLabel = { name: string };
type GhUser = { login: string; avatar_url: string; type: string };
export type GhPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  labels: GhLabel[];
  user: GhUser;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable?: boolean | null;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
};
type GhComment = { id: number; body: string; user: GhUser; created_at: string; html_url: string };
type GhReviewComment = GhComment & { path: string; in_reply_to_id?: number };
type GhReview = { id: number; state: string; body: string; user: GhUser; submitted_at: string; html_url: string };
type GhCheckRun = { name: string; status: string; conclusion: string | null; html_url: string; started_at: string | null; completed_at: string | null };
type GhFile = { filename: string; status: string; additions: number; deletions: number; blob_url: string };
type GhCommit = { sha: string; html_url: string; commit: { message: string; committer: { date: string } } };
type GhDeployment = { id: number; environment: string; sha: string; created_at: string };
type GhDeploymentStatus = { state: string; environment_url?: string; target_url?: string; created_at: string };
type GhTree = { tree: { path: string; type: string }[]; truncated: boolean };

// ---------- the factory's view ----------

export type Verdict = "needs-review" | "revised" | "changes" | "accepted" | "merged" | "rejected" | "no-pr";

export const VERDICT_TEXT: Record<Verdict, string> = {
  "needs-review": "Needs review",
  revised: "Revised, needs review",
  changes: "Waiting on the run",
  accepted: "Accepted",
  merged: "Merged",
  rejected: "Rejected",
  "no-pr": "No PR opened",
};

export const needsYou = (v: Verdict) => v === "needs-review" || v === "revised";
export const isAccepted = (v: Verdict) => v === "accepted" || v === "merged";

export type RunSummary = {
  task: TaskConfig;
  date: string;
  branch: string;
  title: string;
  summary: string;
  verdict: Verdict;
  pr: GhPull | null;
  hasManifest: boolean;
};

const BRANCH_RE = /^(.*-)(\d{4}-\d{2}-\d{2})$/;

export function parseBranch(ref: string): { task: TaskConfig; date: string } | null {
  const m = BRANCH_RE.exec(ref);
  if (!m) return null;
  const task = factory.tasks.find((t) => t.branchPrefix === m[1]);
  return task ? { task, date: m[2] } : null;
}

export const taskById = (id: string) => factory.tasks.find((t) => t.id === id) ?? null;
export const branchFor = (task: TaskConfig, date: string) => `${task.branchPrefix}${date}`;

// "2026-11-14" in Pacific time, for the night grid.
export function pacificDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function lastNights(n: number, from = new Date()) {
  const out: string[] = [];
  const [y, m, d] = pacificDate(from).split("-").map(Number);
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(y, m - 1, d - i));
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

const hasLabel = (pr: GhPull, name: string) => pr.labels.some((l) => l.name === name);

// The plain-language summary when a run didn't write one: the PR body's first real paragraph.
export function summaryFromBody(body: string | null): string {
  if (!body) return "";
  const paras = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("```") && !/^From the nightly\//.test(p) && !/^\*\*Needs a rebase/.test(p) && !/^Applies cleanly/.test(p));
  const first = paras[0] ?? "";
  const flat = first.replace(/\s+/g, " ");
  return flat.length > 320 ? `${flat.slice(0, 317)}…` : flat;
}

function verdictFromLabels(pr: GhPull): Verdict {
  if (pr.merged_at) return "merged";
  if (pr.state === "closed") return "rejected";
  if (hasLabel(pr, LABELS.accepted)) return "accepted";
  if (hasLabel(pr, LABELS.rejected)) return "rejected";
  if (hasLabel(pr, LABELS.changes)) return "changes";
  return "needs-review";
}

// "Changes requested" turns into "Revised" once the run has pushed after the request.
async function refineChanges(pr: GhPull, token?: string): Promise<Verdict> {
  try {
    const [comments, commit] = await Promise.all([
      ghGet<GhComment[]>(`${repoPath()}/issues/${pr.number}/comments?per_page=100`, token),
      ghGet<GhCommit>(`${repoPath()}/commits/${pr.head.sha}`, token),
    ]);
    const lastAsk = comments
      .filter((c) => c.body.includes(FEEDBACK_MARKER.changes))
      .map((c) => c.created_at)
      .sort()
      .at(-1);
    if (lastAsk && commit.commit.committer.date > lastAsk) return "revised";
  } catch {}
  return "changes";
}

async function listNightlyPulls(token?: string): Promise<GhPull[]> {
  const since = process.env.FACTORY_SINCE ?? "2026-11-01";
  const out: GhPull[] = [];
  for (let page = 1; page <= 15; page++) {
    const batch = await ghGet<GhPull[]>(
      `${repoPath()}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
      token,
    );
    for (const pr of batch) if (parseBranch(pr.head.ref)) out.push(pr);
    const oldest = batch.at(-1)?.created_at ?? "";
    if (batch.length < 100 || oldest < since) break;
  }
  return out;
}

// Run folders on the artifacts branch: "task/date" -> true
async function listManifests(token?: string): Promise<Set<string>> {
  const local = await localArtifacts();
  if (local) return local.list();
  try {
    const tree = await ghGet<GhTree>(`${repoPath()}/git/trees/${factory.artifactsBranch}?recursive=1`, token);
    const keys = tree.tree
      .filter((t) => t.type === "blob" && /^runs\/[^/]+\/\d{4}-\d{2}-\d{2}\/run\.json$/.test(t.path))
      .map((t) => t.path.split("/").slice(1, 3).join("/"));
    return new Set(keys);
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return new Set();
    throw e;
  }
}

export async function getManifest(task: string, date: string, token?: string): Promise<RunManifest | null> {
  const local = await localArtifacts();
  if (local) return local.manifest(task, date);
  try {
    const raw = await ghGet<string>(
      `${repoPath()}/contents/${manifestDir(task, date)}/run.json?ref=${factory.artifactsBranch}`,
      token,
      { raw: true },
    );
    return parseManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listRuns(token?: string): Promise<RunSummary[]> {
  const [pulls, manifests] = await Promise.all([listNightlyPulls(token), listManifests(token)]);

  // One run per task and night. If a night has several PRs, the newest wins.
  const byKey = new Map<string, GhPull>();
  for (const pr of pulls) {
    const p = parseBranch(pr.head.ref)!;
    const key = `${p.task.id}/${p.date}`;
    const prev = byKey.get(key);
    if (!prev || prev.created_at < pr.created_at) byKey.set(key, pr);
  }

  const keys = new Set([...byKey.keys(), ...manifests]);
  const runs = await pool([...keys], 8, async (key): Promise<RunSummary | null> => {
    const [taskId, date] = key.split("/");
    const task = taskById(taskId);
    if (!task) return null;
    const pr = byKey.get(key) ?? null;
    const hasManifest = manifests.has(key);

    let verdict: Verdict = pr ? verdictFromLabels(pr) : "no-pr";
    if (pr && verdict === "changes") verdict = await refineChanges(pr, token);

    // Fetch the run's own summary only where someone will read it.
    const manifest = hasManifest && (needsYou(verdict) || !pr) ? await getManifest(taskId, date, token) : null;

    return {
      task,
      date,
      branch: branchFor(task, date),
      title: stripTitle(manifest?.title ?? pr?.title ?? "Run didn't open a PR"),
      summary: manifest?.summary || summaryFromBody(pr?.body ?? null),
      verdict,
      pr,
      hasManifest,
    };
  });

  return runs.filter((r): r is RunSummary => r !== null).sort((a, b) => (a.date === b.date ? a.task.id.localeCompare(b.task.id) : b.date.localeCompare(a.date)));
}

export const stripTitle = (t: string) => t.replace(/^\[nightly\/[^\]]+\]\s*/, "");

// ---------- one run, in full ----------

export type FeedbackItem = {
  id: string;
  who: GhUser;
  when: string;
  body: string;
  url: string;
  kind: "comment" | "review" | "inline";
  path?: string;
  bot: boolean;
  verdict?: "changes" | "accept" | "reject";
};

export type RunDetail = RunSummary & {
  manifest: RunManifest | null;
  files: GhFile[];
  checks: GhCheckRun[];
  commits: GhCommit[];
  feedback: FeedbackItem[];
  previewUrl: string | null;
  sessionUrl: string | null;
};

const isBot = (u: GhUser) => u.type === "Bot" || u.login.endsWith("[bot]");

function verdictOf(body: string): FeedbackItem["verdict"] {
  if (body.includes(FEEDBACK_MARKER.changes)) return "changes";
  if (body.includes(FEEDBACK_MARKER.accept)) return "accept";
  if (body.includes(FEEDBACK_MARKER.reject)) return "reject";
  return undefined;
}

async function previewFor(sha: string, token?: string): Promise<string | null> {
  try {
    const deployments = await ghGet<GhDeployment[]>(`${repoPath()}/deployments?sha=${sha}&per_page=10`, token);
    for (const d of deployments) {
      if (/production/i.test(d.environment)) continue;
      const statuses = await ghGet<GhDeploymentStatus[]>(`${repoPath()}/deployments/${d.id}/statuses?per_page=5`, token);
      const ok = statuses.find((s) => s.state === "success" && (s.environment_url || s.target_url));
      if (ok) return ok.environment_url || ok.target_url || null;
    }
  } catch {}
  return null;
}

const SESSION_RE = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;

export async function getRun(taskId: string, date: string, token?: string): Promise<RunDetail | null> {
  const task = taskById(taskId);
  if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const branch = branchFor(task, date);
  const { owner } = factory.repo;

  const [pulls, manifest] = await Promise.all([
    ghGet<GhPull[]>(`${repoPath()}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`, token, { fresh: true }),
    getManifest(task.id, date, token),
  ]);
  const listed = pulls.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  if (!listed && !manifest) return null;

  const empty: Omit<RunDetail, keyof RunSummary> = {
    manifest,
    files: [],
    checks: [],
    commits: [],
    feedback: [],
    previewUrl: manifest?.previewUrl ?? null,
    sessionUrl: manifest?.session ?? null,
  };

  if (!listed) {
    return {
      task,
      date,
      branch,
      title: stripTitle(manifest!.title),
      summary: manifest!.summary,
      verdict: "no-pr",
      pr: null,
      hasManifest: true,
      ...empty,
    };
  }

  const n = listed.number;
  const [pr, files, checks, comments, inline, reviews, commits] = await Promise.all([
    ghGet<GhPull>(`${repoPath()}/pulls/${n}`, token, { fresh: true }),
    ghGet<GhFile[]>(`${repoPath()}/pulls/${n}/files?per_page=100`, token),
    ghGet<{ check_runs: GhCheckRun[] }>(`${repoPath()}/commits/${listed.head.sha}/check-runs?per_page=100`, token).then((r) => r.check_runs),
    ghGet<GhComment[]>(`${repoPath()}/issues/${n}/comments?per_page=100`, token, { fresh: true }),
    ghGet<GhReviewComment[]>(`${repoPath()}/pulls/${n}/comments?per_page=100`, token, { fresh: true }),
    ghGet<GhReview[]>(`${repoPath()}/pulls/${n}/reviews?per_page=100`, token, { fresh: true }),
    ghGet<GhCommit[]>(`${repoPath()}/pulls/${n}/commits?per_page=100`, token),
  ]);

  let verdict = verdictFromLabels(pr);
  if (verdict === "changes") {
    const lastAsk = comments.filter((c) => c.body.includes(FEEDBACK_MARKER.changes)).map((c) => c.created_at).sort().at(-1);
    const lastPush = commits.map((c) => c.commit.committer.date).sort().at(-1);
    if (lastAsk && lastPush && lastPush > lastAsk) verdict = "revised";
  }

  const feedback: FeedbackItem[] = [
    ...comments.map((c) => ({ id: `c${c.id}`, who: c.user, when: c.created_at, body: c.body, url: c.html_url, kind: "comment" as const, bot: isBot(c.user), verdict: verdictOf(c.body) })),
    ...reviews
      .filter((r) => r.body?.trim())
      .map((r) => ({ id: `r${r.id}`, who: r.user, when: r.submitted_at, body: r.body, url: r.html_url, kind: "review" as const, bot: isBot(r.user) })),
    ...inline.map((c) => ({ id: `i${c.id}`, who: c.user, when: c.created_at, body: c.body, url: c.html_url, kind: "inline" as const, path: c.path, bot: isBot(c.user) })),
  ].sort((a, b) => a.when.localeCompare(b.when));

  const sessionUrl =
    manifest?.session ?? commits.map((c) => SESSION_RE.exec(c.commit.message)?.[0]).find(Boolean) ?? SESSION_RE.exec(pr.body ?? "")?.[0] ?? null;

  return {
    task,
    date,
    branch,
    title: stripTitle(manifest?.title ?? pr.title),
    summary: manifest?.summary || summaryFromBody(pr.body),
    verdict,
    pr,
    hasManifest: !!manifest,
    manifest,
    files,
    checks: checks.filter((c) => c.conclusion !== "skipped"),
    commits,
    feedback,
    previewUrl: manifest?.previewUrl ?? (await previewFor(pr.head.sha, token)),
    sessionUrl,
  };
}

// ---------- each task's base branch against main ----------

export type BaseStatus = { ahead: number; behind: number; url: string } | null;

export async function baseStatuses(token?: string): Promise<Record<string, BaseStatus>> {
  const out: Record<string, BaseStatus> = {};
  await Promise.all(
    factory.tasks.map(async (t) => {
      try {
        const c = await ghGet<{ ahead_by: number; behind_by: number; html_url: string }>(
          `${repoPath()}/compare/${encodeURIComponent(factory.mainBranch)}...${encodeURIComponent(t.baseBranch)}?per_page=1`,
          token,
        );
        out[t.id] = { ahead: c.ahead_by, behind: c.behind_by, url: c.html_url };
      } catch {
        out[t.id] = null;
      }
    }),
  );
  return out;
}

// ---------- the overview's numbers ----------

export type TaskStats = {
  task: TaskConfig;
  runs: number;
  accepted: number;
  rejected: number;
  open: number;
  needsYou: number;
  missed: number;
  last: RunSummary | null;
};

export function taskStats(runs: RunSummary[], nights: string[]): TaskStats[] {
  return factory.tasks.map((task) => {
    const mine = runs.filter((r) => r.task.id === task.id);
    const withPr = mine.filter((r) => r.pr);
    const seen = new Set(mine.map((r) => r.date));
    const first = mine.at(-1)?.date ?? "9999";
    return {
      task,
      runs: withPr.length,
      accepted: mine.filter((r) => isAccepted(r.verdict)).length,
      rejected: mine.filter((r) => r.verdict === "rejected").length,
      open: mine.filter((r) => r.verdict === "needs-review" || r.verdict === "revised" || r.verdict === "changes").length,
      needsYou: mine.filter((r) => needsYou(r.verdict)).length,
      missed: nights.filter((d) => d >= first && (!seen.has(d) || mine.find((r) => r.date === d)?.verdict === "no-pr")).length,
      last: mine[0] ?? null,
    };
  });
}
