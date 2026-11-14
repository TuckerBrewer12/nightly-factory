import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/session";
import { TASK_ID_RE, updateState, type FactoryTask, type ScreenshotPolicy } from "@/lib/tasks";
import { ensureBaseBranch } from "@/lib/worker";

type Body = { op?: "create" | "update" | "delete" | "pause" | "resume"; id?: string; task?: Partial<FactoryTask> };

const POLICIES: ScreenshotPolicy[] = ["required", "if-visible", "skip"];

function clean(t: Partial<FactoryTask>): Partial<FactoryTask> {
  const out: Partial<FactoryTask> = {};
  if (typeof t.label === "string") out.label = t.label.trim().slice(0, 60);
  if (typeof t.blurb === "string") out.blurb = t.blurb.trim().slice(0, 140);
  if (typeof t.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) out.time = t.time;
  if (Array.isArray(t.days)) out.days = [...new Set(t.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (typeof t.prompt === "string") out.prompt = t.prompt.slice(0, 40_000);
  if (typeof t.screenshots === "string" && POLICIES.includes(t.screenshots)) out.screenshots = t.screenshots;
  if (typeof t.enabled === "boolean") out.enabled = t.enabled;
  return out;
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.token || viewer.dev) return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });
  const b = (await req.json()) as Body;
  const t = viewer.token;

  try {
    if (b.op === "create") {
      const id = (b.task?.id ?? "").trim();
      if (!TASK_ID_RE.test(id) || id.length > 40) return NextResponse.json({ error: "Id: lowercase letters, numbers and dashes, starting with a letter." }, { status: 400 });
      const fields = clean(b.task ?? {});
      if (!fields.label || !fields.prompt || !fields.time) return NextResponse.json({ error: "Name, time and instructions are required." }, { status: 400 });
      const baseBranch = `factory/${id}`;
      await ensureBaseBranch(baseBranch, t);
      await updateState(t, `tasks: create ${id} (${viewer.login})`, (s) => {
        if (s.tasks.some((x) => x.id === id)) throw new Error(`A task called ${id} already exists.`);
        s.tasks.push({
          id,
          label: fields.label!,
          blurb: fields.blurb ?? "",
          time: fields.time!,
          days: fields.days ?? [],
          baseBranch,
          enabled: fields.enabled ?? true,
          screenshots: fields.screenshots ?? "if-visible",
          prompt: fields.prompt!,
          createdAt: new Date().toISOString(),
        });
      });
      return NextResponse.json({ ok: true, id });
    }

    const id = b.id ?? "";
    if (!TASK_ID_RE.test(id)) return NextResponse.json({ error: "Which task?" }, { status: 400 });

    await updateState(t, `tasks: ${b.op} ${id} (${viewer.login})`, (s) => {
      const i = s.tasks.findIndex((x) => x.id === id);
      if (i < 0) throw new Error(`No task called ${id}.`);
      if (b.op === "delete") s.tasks.splice(i, 1);
      else if (b.op === "pause") s.tasks[i].enabled = false;
      else if (b.op === "resume") s.tasks[i].enabled = true;
      else if (b.op === "update") s.tasks[i] = { ...s.tasks[i], ...clean(b.task ?? {}) };
      else throw new Error("Unknown operation");
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
