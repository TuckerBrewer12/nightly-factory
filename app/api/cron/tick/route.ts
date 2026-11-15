import { NextResponse, type NextRequest } from "next/server";
import { scheduledAssignment } from "@/lib/assignments";
import { serverToken } from "@/lib/github";
import { dueTasks, loadState, pacificParts, updateState } from "@/lib/tasks";
import { freeRunId, startRun, workerConfigured } from "@/lib/worker";

// Called every 30 minutes by .github/workflows/tick.yml. Starts any task whose
// time has come today and hasn't run yet. Needs CRON_SECRET and a GITHUB_TOKEN
// that can write to the artifacts branch.

async function tick(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = serverToken();
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN isn't set" }, { status: 500 });
  const check = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, "User-Agent": "nightly-factory" } });
  if (check.status === 401) return NextResponse.json({ error: "GITHUB_TOKEN was rejected by GitHub (401): it's mistyped, expired or revoked." }, { status: 500 });
  if (!workerConfigured()) return NextResponse.json({ skipped: "worker routine not configured" });

  const { state } = await loadState(token, true);
  const due = dueTasks(state);
  const today = pacificParts().date;
  const started: { task: string; runId: string; sessionUrl?: string; error?: string }[] = [];

  for (const task of due) {
    // Mark it fired first, so a slow or failed start isn't retried every tick.
    await updateState(token, `tick: ${task.id} ${today}`, (s) => {
      s.lastFired[task.id] = today;
    });
    try {
      const runId = await freeRunId(task.id, token);
      const { sessionUrl } = await startRun({
        task,
        runId,
        token,
        text: scheduledAssignment(task, runId, "schedule"),
        title: `${task.label} nightly run`,
        origin: { kind: "schedule" },
      });
      started.push({ task: task.id, runId, sessionUrl });
    } catch (e) {
      started.push({ task: task.id, runId: "", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ at: new Date().toISOString(), due: due.map((t) => t.id), started });
}

export const GET = tick;
export const POST = tick;
