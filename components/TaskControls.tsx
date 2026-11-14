"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, Result, useAction } from "@/components/RunActions";
import type { FactoryTask, ScreenshotPolicy } from "@/lib/tasks";

async function taskOp(body: Record<string, unknown>) {
  const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? "That didn't work.");
}

export function TaskRowControls({ task, ready }: { task: FactoryTask; ready: boolean }) {
  const router = useRouter();
  const run = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function op(key: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(key);
    setError(null);
    try {
      await taskOp(body);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Btn
          tone="primary"
          disabled={!ready}
          busy={run.busy === "run"}
          title={ready ? "Start this task now, outside its schedule" : "Connect the worker routine first"}
          onClick={() => run.act("run", { action: "run-task", task: task.id }, "Started.")}
        >
          Run now
        </Btn>
        {task.enabled ? (
          <Btn tone="warn" busy={busy === "pause"} onClick={() => op("pause", { op: "pause", id: task.id })}>
            Pause
          </Btn>
        ) : (
          <Btn tone="ok" busy={busy === "resume"} onClick={() => op("resume", { op: "resume", id: task.id })}>
            Resume
          </Btn>
        )}
        <Btn onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</Btn>
        <Btn tone="bad" busy={busy === "delete"} onClick={() => op("delete", { op: "delete", id: task.id }, `Delete the ${task.label} task? Its runs and branch stay.`)}>
          Delete
        </Btn>
      </div>
      <Result error={run.error ?? error} done={run.done} />
      {editing && (
        <div className="mt-4">
          <TaskForm
            initial={task}
            submitLabel="Save"
            onSubmit={async (t) => {
              await taskOp({ op: "update", id: task.id, task: t });
              setEditing(false);
              router.refresh();
            }}
          />
        </div>
      )}
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const POLICIES: { id: ScreenshotPolicy; label: string }[] = [
  { id: "required", label: "Always (UI work)" },
  { id: "if-visible", label: "When the change is visible" },
  { id: "skip", label: "Never (code only)" },
];

type Draft = Pick<FactoryTask, "label" | "blurb" | "time" | "days" | "prompt" | "screenshots" | "enabled"> & { id?: string };

export function TaskForm({ initial, onSubmit, submitLabel, withId }: { initial?: Partial<FactoryTask>; onSubmit: (t: Draft) => Promise<void>; submitLabel: string; withId?: boolean }) {
  const [d, setD] = useState<Draft>({
    id: initial?.id ?? "",
    label: initial?.label ?? "",
    blurb: initial?.blurb ?? "",
    time: initial?.time ?? "03:13",
    days: initial?.days ?? [],
    prompt: initial?.prompt ?? "",
    screenshots: initial?.screenshots ?? "if-visible",
    enabled: initial?.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const input = "h-9 w-full rounded-md border border-line bg-bg px-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none";

  return (
    <form
      className="space-y-4 rounded-xl border border-line bg-panel p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(d);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-ink-2">
          Name
          <input className={`${input} mt-1`} value={d.label} onChange={(e) => set("label", e.target.value)} placeholder="Accessibility" required />
        </label>
        {withId && (
          <label className="block text-xs text-ink-2">
            Id (branch name)
            <input
              className={`${input} mt-1 font-mono`}
              value={d.id}
              onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              placeholder="accessibility"
              required
            />
            <span className="mt-1 block text-[11px] text-ink-3">PRs come from nightly/{d.id || "<id>"}-DATE into factory/{d.id || "<id>"}, which is created from main.</span>
          </label>
        )}
        <label className="block text-xs text-ink-2 sm:col-span-2">
          One line on what it does
          <input className={`${input} mt-1`} value={d.blurb} onChange={(e) => set("blurb", e.target.value)} placeholder="One screen made easier to use with a screen reader" />
        </label>
        <label className="block text-xs text-ink-2">
          Time (Pacific)
          <input type="time" className={`${input} mt-1`} value={d.time} onChange={(e) => set("time", e.target.value)} required />
        </label>
        <div className="text-xs text-ink-2">
          Days <span className="text-ink-3">(none picked = every day)</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {DAYS.map((name, i) => {
              const on = d.days.includes(i);
              return (
                <button
                  type="button"
                  key={name}
                  onClick={() => set("days", on ? d.days.filter((x) => x !== i) : [...d.days, i])}
                  className={`h-9 rounded-md border px-2.5 text-xs ${on ? "border-line-strong bg-panel-2 text-ink" : "border-line text-ink-3 hover:text-ink"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block text-xs text-ink-2">
          Screenshots
          <select className={`${input} mt-1`} value={d.screenshots} onChange={(e) => set("screenshots", e.target.value as ScreenshotPolicy)}>
            {POLICIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-xs text-ink-2">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Runs on schedule
        </label>
      </div>
      <label className="block text-xs text-ink-2">
        What the task should do each run
        <textarea
          className="mt-1 min-h-48 w-full rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
          value={d.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          placeholder={"Find one place where the app is hard to use with a screen reader or keyboard, and fix it.\n\nLook at…"}
          required
        />
        <span className="mt-1 block text-[11px] text-ink-3">
          Only the task itself. The repo, base branch, Step 0 follow-ups, PR rules, CI and review-bot loop, and the report back to the factory are added to every run.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Btn type="submit" tone="primary" busy={busy} onClick={() => {}}>
          {submitLabel}
        </Btn>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </form>
  );
}

export function NewTask() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Btn tone="primary" onClick={() => setOpen(true)}>
        New task
      </Btn>
    );
  return (
    <div className="w-full">
      <TaskForm
        withId
        submitLabel="Create task"
        onSubmit={async (t) => {
          await taskOp({ op: "create", task: t });
          setOpen(false);
          router.refresh();
        }}
      />
      <button onClick={() => setOpen(false)} className="mt-2 text-xs text-ink-3 hover:text-ink">
        Cancel
      </button>
    </div>
  );
}
