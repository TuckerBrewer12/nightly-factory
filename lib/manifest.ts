// run.json: what a nightly run writes about itself.
// Lives on the artifacts branch at runs/<task>/<date>/run.json,
// with screenshots beside it. See REPORTING.md for the contract.

export type StageStatus = "ok" | "warn" | "fail" | "skipped";
export type CheckStatus = "pass" | "fail" | "skip";

export type Stage = {
  id: string;
  label: string;
  status: StageStatus;
  detail: string;
  seconds?: number;
  rounds?: number;
};

export type Check = { name: string; status: CheckStatus; detail?: string };

export type Shot = { name: string; before?: string | null; after: string; note?: string };

export type RunManifest = {
  version: 1;
  task: string;
  date: string;
  // The run's folder name: the date, or date-suffix for extra runs that day (e.g. 2026-11-14-step2).
  id: string;
  branch: string;
  // "running" while the worker is on it (the factory writes this when it starts a run).
  status?: "running" | "done";
  // "plan" when the run only planned and wrote no code.
  kind?: "change" | "plan";
  // The plan itself, markdown, for a plan-only run.
  plan?: string;
  // The run's commits as a git patch, relative to the run folder (for runs that couldn't open a PR).
  patch?: string;
  // Where an older run's patch and write-up are kept, when they aren't on the branch.
  patchSource?: string;
  reportSource?: string;
  // Set when a reviewer dismissed an unopened run.
  dismissed?: { by: string; at: string; reason?: string };
  // What started the run.
  origin?: { kind: "schedule" | "manual" | "build-step" | "open-pr" | "feedback"; by?: string; from?: string };
  pr?: number | null;
  title: string;
  summary: string;
  reviewFirst?: string[];
  stillOpen?: string[];
  next?: string[];
  session?: string;
  startedAt?: string;
  finishedAt?: string;
  previewUrl?: string | null;
  stages?: Stage[];
  checks?: Check[];
  screenshots?: Shot[];
};

const str = (v: unknown): v is string => typeof v === "string";
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter(str) : undefined;

const STAGE: StageStatus[] = ["ok", "warn", "fail", "skipped"];
const CHECK: CheckStatus[] = ["pass", "fail", "skip"];

// Runs write this file by hand, so read it leniently: keep what's valid, drop the rest.
export function parseManifest(raw: unknown): RunManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!str(m.task) || !str(m.date) || !str(m.title)) return null;

  const stages = Array.isArray(m.stages)
    ? m.stages.flatMap((s): Stage[] => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        if (!str(o.id) || !str(o.label)) return [];
        return [
          {
            id: o.id,
            label: o.label,
            status: STAGE.includes(o.status as StageStatus) ? (o.status as StageStatus) : "ok",
            detail: str(o.detail) ? o.detail : "",
            seconds: typeof o.seconds === "number" ? o.seconds : undefined,
            rounds: typeof o.rounds === "number" ? o.rounds : undefined,
          },
        ];
      })
    : undefined;

  const checks = Array.isArray(m.checks)
    ? m.checks.flatMap((c): Check[] => {
        if (!c || typeof c !== "object") return [];
        const o = c as Record<string, unknown>;
        if (!str(o.name)) return [];
        return [
          {
            name: o.name,
            status: CHECK.includes(o.status as CheckStatus) ? (o.status as CheckStatus) : "skip",
            detail: str(o.detail) ? o.detail : undefined,
          },
        ];
      })
    : undefined;

  const screenshots = Array.isArray(m.screenshots)
    ? m.screenshots.flatMap((s): Shot[] => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        if (!str(o.name) || !str(o.after)) return [];
        return [
          {
            name: o.name,
            after: o.after,
            before: str(o.before) ? o.before : null,
            note: str(o.note) ? o.note : undefined,
          },
        ];
      })
    : undefined;

  const o = m.origin as RunManifest["origin"] | undefined;
  const dis = m.dismissed as RunManifest["dismissed"] | undefined;
  return {
    version: 1,
    task: m.task,
    date: m.date,
    id: str(m.id) ? m.id : m.date,
    status: m.status === "running" ? "running" : m.status === "done" ? "done" : undefined,
    kind: m.kind === "plan" ? "plan" : "change",
    plan: str(m.plan) ? m.plan : undefined,
    patch: str(m.patch) ? m.patch : undefined,
    patchSource: str(m.patchSource) ? m.patchSource : undefined,
    reportSource: str(m.reportSource) ? m.reportSource : undefined,
    dismissed: dis && typeof dis === "object" && str(dis.by) ? dis : undefined,
    origin: o && typeof o === "object" && str(o.kind) ? o : undefined,
    branch: str(m.branch) ? m.branch : "",
    pr: typeof m.pr === "number" ? m.pr : null,
    title: m.title,
    summary: str(m.summary) ? m.summary : "",
    reviewFirst: strList(m.reviewFirst),
    stillOpen: strList(m.stillOpen),
    next: strList(m.next),
    session: str(m.session) ? m.session : undefined,
    startedAt: str(m.startedAt) ? m.startedAt : undefined,
    finishedAt: str(m.finishedAt) ? m.finishedAt : undefined,
    previewUrl: str(m.previewUrl) ? m.previewUrl : null,
    stages,
    checks,
    screenshots,
  };
}

export function manifestDir(task: string, id: string) {
  return `runs/${task}/${id}`;
}
