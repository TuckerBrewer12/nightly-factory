import { factory } from "@/factory.config";
import { ghGet, ghSend, GitHubError, repoPath } from "@/lib/github";
import { manifestDir, type RunManifest } from "@/lib/manifest";
import { pacificParts, type FactoryTask } from "@/lib/tasks";

// Starts the "Nightly factory worker" routine on claude.ai with an assignment,
// then marks the run as running on the artifacts branch so the factory shows it.

export function workerConfigured() {
  return !!(process.env.FACTORY_ROUTINE_ID && process.env.FACTORY_ROUTINE_TOKEN);
}

export async function fireWorker(text: string): Promise<{ sessionUrl: string }> {
  const id = process.env.FACTORY_ROUTINE_ID;
  const token = process.env.FACTORY_ROUTINE_TOKEN;
  if (!id || !token) throw new Error("The worker routine isn't set up: add FACTORY_ROUTINE_ID and FACTORY_ROUTINE_TOKEN in Vercel.");
  if (text.length > 65_536) throw new Error("Assignment is over the routine's 65,536-character limit.");
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(id)}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { claude_code_session_url?: string; error?: { message?: string } };
  if (!res.ok || !json.claude_code_session_url) {
    throw new Error(`Routine fire failed (${res.status}): ${json.error?.message ?? "no session returned"}`);
  }
  return { sessionUrl: json.claude_code_session_url };
}

// A free run id for this task today: the date, then date-2, date-3…, or date-<suffix>.
export async function freeRunId(taskId: string, token: string, suffix?: string): Promise<string> {
  const date = pacificParts().date;
  const taken = async (id: string) => {
    try {
      await ghGet(`${repoPath()}/contents/${manifestDir(taskId, id)}/run.json?ref=${factory.artifactsBranch}`, token, { fresh: true });
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) {
        const pulls = await ghGet<unknown[]>(`${repoPath()}/pulls?state=all&head=${factory.repo.owner}:nightly/${taskId}-${id}`, token, { fresh: true });
        return pulls.length > 0;
      }
      throw e;
    }
  };
  const first = suffix ? `${date}-${suffix}` : date;
  if (!(await taken(first))) return first;
  for (let i = 2; i < 20; i++) {
    const id = `${first}-${i}`;
    if (!(await taken(id))) return id;
  }
  throw new Error("Too many runs for this task today");
}

type ContentFile = { sha: string; content: string };

// Write (or merge into) a run's run.json on the artifacts branch.
export async function writeManifest(taskId: string, id: string, token: string, patch: (prev: Partial<RunManifest> | null) => Partial<RunManifest>, message: string) {
  const path = `${manifestDir(taskId, id)}/run.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let prev: Partial<RunManifest> | null = null;
    let sha: string | undefined;
    try {
      const f = await ghGet<ContentFile>(`${repoPath()}/contents/${path}?ref=${factory.artifactsBranch}`, token, { fresh: true });
      sha = f.sha;
      prev = JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
    const next = { ...(prev ?? {}), ...patch(prev) };
    try {
      await ghSend("PUT", `${repoPath()}/contents/${path}`, token, {
        message,
        content: Buffer.from(JSON.stringify(next, null, 2) + "\n").toString("base64"),
        branch: factory.artifactsBranch,
        ...(sha ? { sha } : {}),
      });
      return;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 409 || e.status === 422) && attempt < 2) continue;
      throw e;
    }
  }
}

export async function startRun(opts: {
  task: FactoryTask;
  runId: string;
  text: string;
  token: string;
  title: string;
  summary?: string;
  origin: RunManifest["origin"];
  // Existing run being continued (open-pr / feedback): keep its manifest and only mark it running.
  existing?: boolean;
}) {
  const { sessionUrl } = await fireWorker(opts.text);
  await writeManifest(
    opts.task.id,
    opts.runId,
    opts.token,
    (prev) =>
      opts.existing && prev
        ? { status: "running", session: sessionUrl, origin: opts.origin }
        : {
            version: 1,
            task: opts.task.id,
            id: opts.runId,
            date: opts.runId.slice(0, 10),
            branch: `nightly/${opts.task.id}-${opts.runId}`,
            pr: null,
            title: opts.title,
            summary: opts.summary ?? "",
            status: "running",
            session: sessionUrl,
            startedAt: new Date().toISOString(),
            origin: opts.origin,
          },
    `run: start ${opts.task.id} ${opts.runId}`,
  );
  return { sessionUrl };
}

// Create the task's base branch from main if it doesn't exist yet.
export async function ensureBaseBranch(branch: string, token: string) {
  try {
    await ghGet(`${repoPath()}/git/ref/heads/${branch}`, token, { fresh: true });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e;
    const main = await ghGet<{ object: { sha: string } }>(`${repoPath()}/git/ref/heads/${factory.mainBranch}`, token, { fresh: true });
    await ghSend("POST", `${repoPath()}/git/refs`, token, { ref: `refs/heads/${branch}`, sha: main.object.sha });
  }
}
