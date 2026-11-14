import { factory } from "@/factory.config";
import { GitHubError, ghGet, ghSend, repoPath } from "@/lib/github";

// The factory's scheduled tasks. Stored as factory.json on the artifacts branch,
// edited from /tasks, and fired by /api/cron/tick through the worker routine.

export type ScreenshotPolicy = "required" | "if-visible" | "skip";

export type FactoryTask = {
  id: string; // also the branch name: nightly/<id>-YYYY-MM-DD, base factory/<id>
  label: string;
  blurb: string;
  time: string; // "HH:MM", Pacific
  days: number[]; // 0 = Sunday … 6; empty = every day
  baseBranch: string;
  enabled: boolean;
  screenshots: ScreenshotPolicy;
  prompt: string; // the task's own instructions; the shared rules are added by lib/assignments.ts
  createdAt: string;
};

export type FactoryState = {
  version: 1;
  tasks: FactoryTask[];
  lastFired: Record<string, string>; // task id -> Pacific date it last fired on schedule
};

export const TASK_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FILE = "factory.json";

const now = "2026-11-03T21:09:00Z";

export const DEFAULT_TASKS: FactoryTask[] = [
  {
    id: "speed",
    label: "Speed",
    blurb: "One measured performance win",
    time: "01:17",
    days: [],
    baseBranch: "factory/speed",
    enabled: false,
    screenshots: "if-visible",
    createdAt: now,
    prompt: `Make the site faster.

Find one concrete way to make it faster, and implement it. Measure before you choose. Places to look:
- Frontend: production build output and bundle size (vite build), large dependencies, code-splitting and lazy routes, unnecessary re-renders, image and asset sizes, waterfalls of requests on page load. Playwright and Chromium are preinstalled if you can run the app locally to time pages.
- Backend: slow endpoints, N+1 queries, missing indexes, serial awaits that could run in parallel, missing caching, large payloads.
- Scan pipeline latency, but only if you can verify that output quality doesn't drop. Run the evals if you touch it.
Pick the highest-impact change that fits in one small, reviewable PR. Put before and after numbers in the PR and in run.json's checks (e.g. {"name": "Entry chunk (gzip)", "status": "pass", "detail": "358.6 → 325.2 kB"}). If you can't measure directly, explain the expected effect and how Tucker can verify it.
PR description: what changed, why, how it was measured, what to review first.`,
  },
  {
    id: "cleanup",
    label: "Cleanup",
    blurb: "One small area of code made better, behavior unchanged",
    time: "01:47",
    days: [],
    baseBranch: "factory/cleanup",
    enabled: false,
    screenshots: "skip",
    createdAt: now,
    prompt: `Clean up one small area of the code.

Pick one small area, a single file or a couple of closely related files, where code quality is weakest, and make it better without changing behavior. Look for: duplicated logic, overly long functions, unclear names, dead code, loose types or \`any\`, inconsistent error handling, and logic that should live in a shared helper or component. Prefer code that's used often or changed often (check git log). If tests for that area are thin, add tests that lock in current behavior before refactoring. In the PR, explain why you picked this area and what's better now.
Don't touch files an open nightly PR is changing. A cleanup should not change any screenshot; if one changes, find out why before going further.
PR description: what changed, why, how behavior was verified to be unchanged, what to review first.`,
  },
  {
    id: "library-feature",
    label: "Library or feature",
    blurb: "A third-party library, or the first slice of a feature",
    time: "02:17",
    days: [],
    baseBranch: "factory/library-feature",
    enabled: false,
    screenshots: "if-visible",
    createdAt: now,
    prompt: `Bring in a useful third-party library, or start a small new feature.

Look at what the app does today and what it's missing, then do ONE of these:
A) Library. Research a third-party library worth adding. It can be dev/ops (testing, CI, observability, error tracking, performance budgets, DB migrations) or user-facing (charts, animation, gestures, offline support, image handling, accessibility). Use web search. Compare 2–3 candidates on maintenance, bundle size or footprint, license, and fit with the stack. Pick one and integrate it minimally somewhere real.
B) Feature. Plan a small new feature a golfer would value, and build the smallest useful slice of it.
Alternate between A and B from night to night (check recent nightly/library-feature PRs to see which was done last). Write the comparison or plan, and why, in the PR description. PR title starts with "[nightly/library]" or "[nightly/feature]".
Don't add secrets or paid-service keys. If a library needs an account or a key, wire it up behind config that's off by default, and explain the setup in the PR. Add tests for new behavior.`,
  },
  {
    id: "design",
    label: "Design",
    blurb: "One UX or design improvement, measured against the canvas",
    time: "02:47",
    days: [],
    baseBranch: "factory/design",
    enabled: false,
    screenshots: "required",
    createdAt: now,
    prompt: `Propose and start one UX or design improvement, using Tucker's design canvas as the reference.

DESIGN CANVAS
Tucker's Claude Design canvas "BirdieEyeView Component Redesign": https://claude.ai/artifact/TQUj2eJoH9AUhKYeRbMTc1 (slug d5d4cc3b-2aa4-4df3-a67d-185de105ae96). Read it with the artifact tools (load them through ToolSearch if they're deferred): get_artifact, then list_files, then read_file ONE path at a time. Start with project/canvas.json, which lists every frame with its title and page. Frames are project/<Name>.dc.html. "*-Current" frames show today's UI and "*-New" (or -A/-B) frames show proposed designs. Read only the frames you need. Don't edit the canvas. If the artifact tools aren't available, say so in the PR and work from the frontend code alone.

TASK
Pick ONE screen, flow, or component where the user experience can be noticeably better. Or pick a component, color token, or animation to add or change. Prefer something whose proposed design isn't in the code yet, or a gap the canvas doesn't cover. Compare the canvas with the real frontend code, then implement the change, or its first step. In the PR, explain: the UX problem, the proposal, which canvas frames it relates to (by title), and how it looks. Check it visually with Playwright (preinstalled).
Design changes will intentionally change screenshots. Update the baselines the way the repo does it, only for the screens you meant to change, and list each changed screenshot and why. If a screenshot you didn't mean to touch changes, fix the cause.`,
  },
];

const defaults = (): FactoryState => ({ version: 1, tasks: DEFAULT_TASKS, lastFired: {} });

function normalize(raw: unknown): FactoryState {
  if (!raw || typeof raw !== "object") return defaults();
  const r = raw as Partial<FactoryState>;
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.filter((t): t is FactoryTask => !!t && typeof t === "object" && typeof (t as FactoryTask).id === "string")
    : DEFAULT_TASKS;
  return {
    version: 1,
    tasks: tasks.map((t) => ({
      ...t,
      days: Array.isArray(t.days) ? t.days : [],
      baseBranch: t.baseBranch || `factory/${t.id}`,
      screenshots: t.screenshots ?? "if-visible",
      enabled: !!t.enabled,
    })),
    lastFired: r.lastFired && typeof r.lastFired === "object" ? r.lastFired : {},
  };
}

type ContentFile = { sha: string; content: string; encoding: string };

export async function loadState(token?: string, fresh = false): Promise<{ state: FactoryState; sha: string | null }> {
  try {
    const f = await ghGet<ContentFile>(`${repoPath()}/contents/${FILE}?ref=${factory.artifactsBranch}`, token, { fresh });
    return { state: normalize(JSON.parse(Buffer.from(f.content, "base64").toString("utf8"))), sha: f.sha };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return { state: defaults(), sha: null };
    throw e;
  }
}

export async function getTasks(token?: string): Promise<FactoryTask[]> {
  try {
    return (await loadState(token)).state.tasks;
  } catch {
    return DEFAULT_TASKS;
  }
}

// Read, change, write, with one retry if someone else wrote in between.
export async function updateState(token: string, message: string, change: (s: FactoryState) => FactoryState | void): Promise<FactoryState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, sha } = await loadState(token, true);
    const next = change(structuredClone(state)) ?? state;
    const body = JSON.stringify(next, null, 2) + "\n";
    try {
      await ghSend("PUT", `${repoPath()}/contents/${FILE}`, token, {
        message,
        content: Buffer.from(body).toString("base64"),
        branch: factory.artifactsBranch,
        ...(sha ? { sha } : {}),
      });
      return next;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 409 || e.status === 422) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("Couldn't save factory.json");
}

// Fallback for runs of a task that has since been deleted.
export function taskOrStub(tasks: FactoryTask[], id: string): FactoryTask {
  return (
    tasks.find((t) => t.id === id) ?? {
      id,
      label: id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      blurb: "",
      time: "",
      days: [],
      baseBranch: `factory/${id}`,
      enabled: false,
      screenshots: "if-visible",
      prompt: "",
      createdAt: "",
    }
  );
}

// ---------- schedule maths, in Pacific time ----------

export function pacificParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: factory.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), dow };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const runsOn = (t: FactoryTask, dow: number) => t.days.length === 0 || t.days.includes(dow);

// Due now: enabled, scheduled today, its time has passed (within 6 hours), not yet fired today.
export function dueTasks(state: FactoryState, at = new Date()): FactoryTask[] {
  const { date, minutes, dow } = pacificParts(at);
  return state.tasks.filter((t) => {
    if (!t.enabled || !t.time || !runsOn(t, dow)) return false;
    const late = minutes - toMinutes(t.time);
    return late >= 0 && late < 360 && state.lastFired[t.id] !== date;
  });
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeSchedule(t: FactoryTask) {
  if (!t.time) return "No schedule";
  const [h, m] = t.time.split(":").map(Number);
  const time = new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  const days = t.days.length === 0 || t.days.length === 7 ? "Daily" : [...t.days].sort().map((d) => DAY_NAMES[d]).join(", ");
  return `${days} at ${time}`;
}
