import { NextResponse, type NextRequest } from "next/server";
import { buildStepAssignment, feedbackAssignment, openPrAssignment, scheduledAssignment } from "@/lib/assignments";
import { getManifest } from "@/lib/runs";
import { getViewer } from "@/lib/session";
import { getTasks, taskOrStub } from "@/lib/tasks";
import { freeRunId, startRun, writeManifest } from "@/lib/worker";

type Body = {
  action?: "run-task" | "build-step" | "build-plan" | "open-pr" | "address-feedback" | "dismiss";
  task?: string;
  id?: string; // the run acted on
  step?: number; // index into the run's "next"
  pr?: number;
  reason?: string;
};

export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.token || viewer.dev) return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });
  const b = (await req.json()) as Body;
  if (!b.action || !b.task || !/^[a-z0-9-]+$/.test(b.task)) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const t = viewer.token;
  const tasks = await getTasks(t);
  const task = taskOrStub(tasks, b.task);
  const origin = (kind: NonNullable<Parameters<typeof startRun>[0]["origin"]>["kind"]) => ({ kind, by: viewer.login, from: b.id });

  try {
    if (b.action === "run-task") {
      if (!tasks.some((x) => x.id === task.id)) return NextResponse.json({ error: "No such task" }, { status: 404 });
      const runId = await freeRunId(task.id, t);
      const { sessionUrl } = await startRun({
        task,
        runId,
        token: t,
        text: scheduledAssignment(task, runId, "manual"),
        title: `${task.label} run started by ${viewer.login}`,
        origin: { kind: "manual", by: viewer.login },
      });
      return NextResponse.json({ ok: true, runId, sessionUrl });
    }

    if (!b.id) return NextResponse.json({ error: "Which run?" }, { status: 400 });
    const m = await getManifest(task.id, b.id, t);

    if (b.action === "build-step" || b.action === "build-plan") {
      const steps = m?.next ?? [];
      const stepText = b.action === "build-plan" ? (m?.plan ?? m?.summary ?? "") : steps[b.step ?? -1];
      if (!stepText) return NextResponse.json({ error: "That step isn't in the run's plan." }, { status: 400 });
      const stepNumber = b.action === "build-plan" ? 1 : (b.step ?? 0) + 2; // the run itself was step 1
      const runId = await freeRunId(task.id, t, b.action === "build-plan" ? "plan" : `step${stepNumber}`);
      const { sessionUrl } = await startRun({
        task,
        runId,
        token: t,
        text: buildStepAssignment(
          task,
          runId,
          { id: b.id, title: m?.title ?? b.id, summary: m?.summary ?? "", pr: m?.pr ?? b.pr ?? null, plan: m?.plan },
          stepText,
          stepNumber,
          viewer.login,
        ),
        title: b.action === "build-plan" ? `Build the plan from ${b.id}` : `Step ${stepNumber}: ${stepText.slice(0, 90)}`,
        summary: stepText,
        origin: origin("build-step"),
      });
      return NextResponse.json({ ok: true, runId, sessionUrl });
    }

    if (b.action === "open-pr") {
      if (!m) return NextResponse.json({ error: "This run has no report to open a PR from." }, { status: 404 });
      const { sessionUrl } = await startRun({
        task,
        runId: b.id,
        token: t,
        existing: true,
        text: openPrAssignment(task, b.id, m, viewer.login),
        title: m.title,
        origin: origin("open-pr"),
      });
      return NextResponse.json({ ok: true, runId: b.id, sessionUrl });
    }

    if (b.action === "address-feedback") {
      if (!b.pr) return NextResponse.json({ error: "Which PR?" }, { status: 400 });
      const { sessionUrl } = await startRun({
        task,
        runId: b.id,
        token: t,
        existing: true,
        text: feedbackAssignment(task, b.id, b.pr, viewer.login),
        title: m?.title ?? `PR #${b.pr}`,
        origin: origin("feedback"),
      });
      return NextResponse.json({ ok: true, runId: b.id, sessionUrl });
    }

    if (b.action === "dismiss") {
      await writeManifest(task.id, b.id, t, () => ({ dismissed: { by: viewer.login, at: new Date().toISOString(), reason: b.reason?.trim() || undefined } }), `run: dismiss ${task.id} ${b.id}`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
