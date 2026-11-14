"use client";

import { useState } from "react";
import { Btn, Result, useAction } from "@/components/RunActions";

// Worker-backed buttons on a run page.

export function OpenPrButton({ task, id, ready }: { task: string; id: string; ready: boolean }) {
  const { act, busy, error, done } = useAction();
  return (
    <div>
      <Btn
        tone="primary"
        disabled={!ready}
        busy={busy === "open"}
        title={ready ? "The worker applies this run's change to the task's branch and opens the draft PR" : "Connect the worker routine first"}
        onClick={() => act("open", { action: "open-pr", task, id }, "Started. The PR shows up here when the worker opens it.")}
      >
        Open PR
      </Btn>
      <Result error={error} done={done} />
    </div>
  );
}

export function BuildPlanButton({ task, id, ready }: { task: string; id: string; ready: boolean }) {
  const { act, busy, error, done } = useAction();
  return (
    <div>
      <Btn tone="primary" disabled={!ready} busy={busy === "plan"} onClick={() => act("plan", { action: "build-plan", task, id }, "Started building the plan as a new run.")}>
        Build this plan
      </Btn>
      <Result error={error} done={done} />
    </div>
  );
}

export function FeedbackNowButton({ task, id, pr, ready }: { task: string; id: string; pr: number; ready: boolean }) {
  const { act, busy, error, done } = useAction();
  return (
    <div>
      <Btn
        disabled={!ready}
        busy={busy === "fb"}
        title="Have the worker answer this PR's open comments now instead of tomorrow night"
        onClick={() => act("fb", { action: "address-feedback", task, id, pr }, "Started. It works on this PR's comments now.")}
      >
        Answer feedback now
      </Btn>
      <Result error={error} done={done} />
    </div>
  );
}

export function DismissButton({ task, id }: { task: string; id: string }) {
  const { act, busy, error, done } = useAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (!asking)
    return (
      <Btn tone="bad" onClick={() => setAsking(true)}>
        Dismiss
      </Btn>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why (optional)"
        className="h-9 w-56 rounded-md border border-line bg-bg px-2 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
      />
      <Btn tone="bad" busy={busy === "dismiss"} onClick={() => act("dismiss", { action: "dismiss", task, id, reason }, "Dismissed.")}>
        Dismiss run
      </Btn>
      <button onClick={() => setAsking(false)} className="text-xs text-ink-3 hover:text-ink">
        Cancel
      </button>
      <Result error={error} done={done} />
    </div>
  );
}

export function NextSteps({ task, id, steps, ready }: { task: string; id: string; steps: string[]; ready: boolean }) {
  const { act, busy, error, done } = useAction();
  return (
    <div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink-2">
            <span className="mt-0.5 font-mono text-ink-3">{i + 2}</span>
            <span className="flex-1">{s}</span>
            <Btn
              disabled={!ready}
              busy={busy === `s${i}`}
              title={ready ? "Start a run that builds this step as its own PR" : "Connect the worker routine first"}
              className="h-7 px-2 text-xs"
              onClick={() => act(`s${i}`, { action: "build-step", task, id, step: i }, `Started building step ${i + 2}.`)}
            >
              Build
            </Btn>
          </li>
        ))}
      </ol>
      <Result error={error} done={done} />
    </div>
  );
}
