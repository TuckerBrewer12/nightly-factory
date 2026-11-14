import { factory, LABELS } from "@/factory.config";
import { botReports, type BotReport } from "@/lib/bots";
import { fromGitHubFiles, parsePatchFile, type DiffFile } from "@/lib/diff";
import { FEEDBACK_MARKER } from "@/lib/feedback-marker";
import { GitHubError, ghGet, pool, repoPath } from "@/lib/github";
import { localArtifacts } from "@/lib/local-artifacts";
import { manifestDir, parseManifest, type RunManifest } from "@/lib/manifest";
import { getTasks, pacificParts, taskOrStub, type FactoryTask } from "@/lib/tasks";

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
  additions?: number;
  deletions?: number;
  changed_files?: number;
};
type GhComment = { id: number; body: string; user: GhUser; created_at: string; html_url: string };
type GhReviewComment = GhComment & { path: string; in_reply_to_id?: number; pull_request_review_id: number | null };
type GhReview = { id: number; state: string; body: string; user: GhUser; submitted_at: string; html_url: string };
type GhCheckRun = { name: string; status: string; conclusion: string | null; html_url: string };
type GhFile = { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string; blob_url: string };
type GhCommit = { sha: string; html_url: string; commit: { message: string; committer: { date: string } } };
type GhDeployment = { id: number; environment: string };
type GhDeploymentStatus = { state: string; environment_url?: string; target_url?: string };
type GhTree = { tree: { path: string; type: string; sha: string }[] };

// ---------- the factory's view ----------

export type Verdict = "needs-review" | "revised" | "changes" | "unopened" | "plan" | "running" | "accepted" | "merged" | "rejected" | "no-pr";

export const VERDICT_TEXT: Record<Verdict, string> = {
  "needs-review": "Needs review",
  revised: "Revised, needs review",
  changes: "Waiting on the run",
  unopened: "Unopened PR",
  plan: "Plan only",
  running: "Running",
  accepted: "Accepted",
  merged: "Merged",
  rejected: "Rejected",
  "no-pr": "No PR",
};

export const needsYou = (v: Verdict) => v === "needs-review" || v === "revised" || v === "unopened" || v === "plan";
export const isAccepted = (v: Verdict) => v === "accepted" || v === "merged";
export const isOpen = (v: Verdict) => v === "needs-review" || v === "revised" || v === "changes" || v === "unopened" || v === "plan" || v === "running";

export type RunSummary = {
  task: FactoryTask;
  date: string;
  id: string; // folder and URL segment: the date, or date-suffix
  branch: string;
  title: string;
  summary: string;
  verdict: Verdict;
  pr: GhPull | null;
  hasManifest: boolean;
};

const BRANCH_RE = /^nightly\/([a-z0-9-]+?)-(\d{4}-\d{2}-\d{2})(?:-([a-z0-9][a-z0-9-]*))?$/;
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9][a-z0-9-]*)?$/;

export function parseBranch(ref: string): { taskId: string; date: string; id: string } | null {
  const m = BRANCH_RE.exec(ref);
  if (!m) return null;
  return { taskId: m[1], date: m[2], id: m[3] ? `${m[2]}-${m[3]}` : m[2] };
}

export const branchFor = (taskId: string, id: string) => `nightly/${taskId}-${id}`;
export const isRunId = (id: string) => RUN_ID_RE.test(id);

export function lastNights(n: number, from = new Date()) {
  const out: string[] = [];
  const [y, m, d] = pacificParts(from).date.split("-").map(Number);
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

const hasLabel = (pr: GhPull, name: string) => pr.labels.some((l) => l.name === name);

export function summaryFromBody(body: string | null): string {
  if (!body) return "";
  const paras = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p &&
        !p.startsWith("#") &&
        !p.startsWith("```") &&
        !/^From the nightly\//.test(p) &&
        !/^\*\*Needs a rebase/.test(p) &&
        !/^Applies cleanly/.test(p),
    );
  const flat = (paras[0] ?? "").replace(/\s+/g, " ");
  return flat.length > 320 ? `${flat.slice(0, 317)}…` : flat;
}

export const stripTitle = (t: string) => t.replace(/^\[nightly\/[^\]]+\]\s*/, "");

function verdictFromPr(pr: GhPull): Verdict {
  if (pr.merged_at) return "merged";
  if (pr.state === "closed") return "rejected";
  if (hasLabel(pr, LABELS.accepted)) return "accepted";
  if (hasLabel(pr, LABELS.rejected)) return "rejected";
  if (hasLabel(pr, LABELS.changes)) return "changes";
  return "needs-review";
}

function verdictFromManifest(m: RunManifest | null): Verdict {
  if (!m) return "no-pr";
  if (m.dismissed) return "rejected";
  if (m.status === "running") return "running";
  if (m.kind === "plan") return "plan";
  if (m.patch || m.patchSource) return "unopened";
  return "no-pr";
}

async function refineChanges(pr: GhPull, token?: string): Promise<Verdict> {
  try {
    const [comments, commit] = await Promise.all([
      ghGet<GhComment[]>(`${repoPath()}/issues/${pr.number}/comments?per_page=100`, token),
      ghGet<GhCommit>(`${repoPath()}/commits/${pr.head.sha}`, token),
    ]);
    const lastAsk = comments.filter((c) => c.body.includes(FEEDBACK_MARKER.changes)).map((c) => c.created_at).sort().at(-1);
    if (lastAsk && commit.commit.committer.date > lastAsk) return "revised";
  } catch {}
  return "changes";
}

async function listNightlyPulls(token?: string): Promise<GhPull[]> {
  const since = process.env.FACTORY_SINCE ?? "2026-11-01";
  const out: GhPull[] = [];
  for (let page = 1; page <= 15; page++) {
    const batch = await ghGet<GhPull[]>(`${repoPath()}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}`, token);
    for (const pr of batch) if (parseBranch(pr.head.ref)) out.push(pr);
    if (batch.length < 100 || (batch.at(-1)?.created_at ?? "") < since) break;
  }
  return out;
}

// ---------- the artifacts branch ----------

// Blobs never change, so their contents are cached for the life of the server.
const blobCache = new Map<string, string>();

async function readBlob(sha: string, token?: string): Promise<string> {
  const hit = blobCache.get(sha);
  if (hit !== undefined) return hit;
  const text = await ghGet<string>(`${repoPath()}/git/blobs/${sha}`, token, { raw: true });
  blobCache.set(sha, text);
  return text;
}

// "task/id" -> blob sha of its run.json
async function listManifests(token?: string): Promise<Map<string, string>> {
  const local = await localArtifacts();
  if (local) return new Map([...(await local.list())].map((k) => [k, `local:${k}`]));
  try {
    const tree = await ghGet<GhTree>(`${repoPath()}/git/trees/${factory.artifactsBranch}?recursive=1`, token);
    const out = new Map<string, string>();
    for (const t of tree.tree) {
      const m = /^runs\/([a-z0-9-]+)\/([^/]+)\/run\.json$/.exec(t.path);
      if (t.type === "blob" && m && isRunId(m[2])) out.set(`${m[1]}/${m[2]}`, t.sha);
    }
    return out;
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return new Map();
    throw e;
  }
}

async function manifestFromSha(key: string, sha: string, token?: string): Promise<RunManifest | null> {
  try {
    if (sha.startsWith("local:")) {
      const [task, id] = key.split("/");
      return (await localArtifacts())!.manifest(task, id);
    }
    return parseManifest(JSON.parse(await readBlob(sha, token)));
  } catch {
    return null;
  }
}

export async function readArtifact(path: string, token?: string): Promise<string | null> {
  const local = await localArtifacts();
  if (local) return (await local.file(path))?.toString("utf8") ?? null;
  try {
    return await ghGet<string>(`${repoPath()}/contents/${path}?ref=${factory.artifactsBranch}`, token, { raw: true });
  } catch {
    return null;
  }
}

export async function getManifest(task: string, id: string, token?: string): Promise<RunManifest | null> {
  const local = await localArtifacts();
  if (local) return local.manifest(task, id);
  const raw = await readArtifact(`${manifestDir(task, id)}/run.json`, token);
  try {
    return raw ? parseManifest(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// ---------- all runs ----------

export async function listRuns(token?: string): Promise<{ runs: RunSummary[]; tasks: FactoryTask[] }> {
  const [pulls, manifests, tasks] = await Promise.all([listNightlyPulls(token), listManifests(token), getTasks(token)]);

  const byKey = new Map<string, GhPull>();
  for (const pr of pulls) {
    const p = parseBranch(pr.head.ref)!;
    const key = `${p.taskId}/${p.id}`;
    const prev = byKey.get(key);
    if (!prev || prev.created_at < pr.created_at) byKey.set(key, pr);
  }

  const keys = new Set([...byKey.keys(), ...manifests.keys()]);
  const runs = await pool([...keys], 8, async (key): Promise<RunSummary> => {
    const [taskId, id] = key.split("/");
    const task = taskOrStub(tasks, taskId);
    const pr = byKey.get(key) ?? null;
    const sha = manifests.get(key);
    // Without a PR the manifest decides everything; with one, it's only read for the summary.
    const manifest = sha ? await manifestFromSha(key, sha, token) : null;
    let verdict: Verdict = pr ? verdictFromPr(pr) : verdictFromManifest(manifest);
    if (pr && verdict === "changes") verdict = await refineChanges(pr, token);
    if (pr && manifest?.status === "running") verdict = "running";
    return {
      task,
      date: id.slice(0, 10),
      id,
      branch: branchFor(taskId, id),
      title: stripTitle(manifest?.title ?? pr?.title ?? "Run didn't report"),
      summary: manifest?.summary || summaryFromBody(pr?.body ?? null),
      verdict,
      pr,
      hasManifest: !!manifest,
    };
  });

  runs.sort((a, b) => (a.id === b.id ? a.task.id.localeCompare(b.task.id) : b.id.localeCompare(a.id)));
  return { runs, tasks };
}

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
  diff: DiffFile[];
  diffSource: "pr" | "patch" | null;
  checks: GhCheckRun[];
  commits: GhCommit[];
  feedback: FeedbackItem[];
  bots: BotReport[];
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

export async function getRun(taskId: string, id: string, token?: string): Promise<{ run: RunDetail; tasks: FactoryTask[] } | null> {
  if (!/^[a-z0-9-]+$/.test(taskId) || !isRunId(id)) return null;
  const tasks = await getTasks(token);
  const task = taskOrStub(tasks, taskId);
  const branch = branchFor(taskId, id);
  const { owner } = factory.repo;

  const [pulls, manifest] = await Promise.all([
    ghGet<GhPull[]>(`${repoPath()}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`, token, { fresh: true }),
    getManifest(taskId, id, token),
  ]);
  const listed = pulls.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  if (!listed && !manifest) return null;

  const base = { task, date: id.slice(0, 10), id, branch, hasManifest: !!manifest, manifest };

  if (!listed) {
    const patchText = manifest?.patch ? await readArtifact(`${manifestDir(taskId, id)}/${manifest.patch}`, token) : null;
    return {
      tasks,
      run: {
        ...base,
        title: stripTitle(manifest!.title),
        summary: manifest!.summary,
        verdict: verdictFromManifest(manifest),
        pr: null,
        diff: patchText ? parsePatchFile(patchText) : [],
        diffSource: patchText ? "patch" : null,
        checks: [],
        commits: [],
        feedback: [],
        bots: [],
        previewUrl: manifest?.previewUrl ?? null,
        sessionUrl: manifest?.session ?? null,
      },
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

  let verdict = verdictFromPr(pr);
  if (verdict === "changes") {
    const lastAsk = comments.filter((c) => c.body.includes(FEEDBACK_MARKER.changes)).map((c) => c.created_at).sort().at(-1);
    const lastPush = commits.map((c) => c.commit.committer.date).sort().at(-1);
    if (lastAsk && lastPush && lastPush > lastAsk) verdict = "revised";
  }
  if (manifest?.status === "running") verdict = "running";

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
    tasks,
    run: {
      ...base,
      title: stripTitle(manifest?.title ?? pr.title),
      summary: manifest?.summary || summaryFromBody(pr.body),
      verdict,
      pr,
      diff: fromGitHubFiles(files),
      diffSource: "pr",
      checks: checks.filter((c) => c.conclusion !== "skipped"),
      commits,
      feedback,
      bots: botReports(reviews, inline, comments),
      previewUrl: manifest?.previewUrl ?? (await previewFor(pr.head.sha, token)),
      sessionUrl,
    },
  };
}

// ---------- each task's base branch against main ----------

export type BaseStatus = { ahead: number; behind: number; url: string } | null;

export async function baseStatuses(tasks: FactoryTask[], token?: string): Promise<Record<string, BaseStatus>> {
  const out: Record<string, BaseStatus> = {};
  await Promise.all(
    tasks.map(async (t) => {
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
  task: FactoryTask;
  runs: number;
  accepted: number;
  rejected: number;
  open: number;
  needsYou: number;
  missed: number;
  last: RunSummary | null;
};

export function taskStats(tasks: FactoryTask[], runs: RunSummary[], nights: string[]): TaskStats[] {
  const today = pacificParts().date;
  return tasks.map((task) => {
    const mine = runs.filter((r) => r.task.id === task.id);
    const seen = new Set(mine.map((r) => r.date));
    const first = mine.at(-1)?.date ?? "9999";
    return {
      task,
      runs: mine.length,
      accepted: mine.filter((r) => isAccepted(r.verdict)).length,
      rejected: mine.filter((r) => r.verdict === "rejected").length,
      open: mine.filter((r) => isOpen(r.verdict)).length,
      needsYou: mine.filter((r) => needsYou(r.verdict)).length,
      // Nights with no run at all, since the task's first run (not counting today).
      missed: nights.filter((d) => d >= first && d < today && !seen.has(d)).length,
      last: mine[0] ?? null,
    };
  });
}
