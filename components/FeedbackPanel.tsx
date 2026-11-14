"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Action = "comment" | "changes" | "accept" | "reject" | "merge" | "reopen";

export function FeedbackPanel({
  pr,
  open,
  draft,
  merged,
  canWrite,
}: {
  pr: number;
  open: boolean;
  draft: boolean;
  merged: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [, startTransition] = useTransition();

  async function send(action: Action) {
    setError(null);
    setDone(null);
    if ((action === "changes" || action === "reject" || action === "comment") && !text.trim()) {
      setError(action === "reject" ? "Say why, so the run doesn't propose it again." : "Write what you'd like changed first.");
      return;
    }
    if (action === "merge" && !confirm(`Squash-merge #${pr}?`)) return;
    setBusy(action);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pr, action, text }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't post that.");
      setText("");
      setDone(
        {
          comment: "Comment posted.",
          changes: "Sent. The next run picks it up in Step 0.",
          accept: "Marked accepted.",
          reject: "Closed and marked rejected.",
          merge: "Merged.",
          reopen: "Reopened.",
        }[action],
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (merged) {
    return <p className="text-sm text-ink-2">Merged. Nothing left to review.</p>;
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canWrite}
        rows={5}
        placeholder={open ? "What should change? Be specific: the run reads this tomorrow night." : "Why it was rejected"}
        className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none disabled:opacity-50"
      />
      {open ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Btn onClick={() => send("accept")} busy={busy === "accept"} disabled={!canWrite} tone="ok">
              Accept
            </Btn>
            <Btn onClick={() => send("changes")} busy={busy === "changes"} disabled={!canWrite} tone="warn">
              Request changes
            </Btn>
            <Btn onClick={() => send("comment")} busy={busy === "comment"} disabled={!canWrite}>
              Comment
            </Btn>
            <Btn onClick={() => send("reject")} busy={busy === "reject"} disabled={!canWrite} tone="bad">
              Reject
            </Btn>
          </div>
          {!draft && (
            <Btn onClick={() => send("merge")} busy={busy === "merge"} disabled={!canWrite} className="mt-2 w-full">
              Squash and merge
            </Btn>
          )}
        </>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Btn onClick={() => send("comment")} busy={busy === "comment"} disabled={!canWrite}>
            Comment
          </Btn>
          <Btn onClick={() => send("reopen")} busy={busy === "reopen"} disabled={!canWrite}>
            Reopen
          </Btn>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {done && <p className="mt-2 text-xs text-ok">{done}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        {canWrite
          ? `Posts on #${pr} as you. Accept and reject only label the PR (and reject closes it); merging is separate.`
          : "Sign in with GitHub to leave feedback."}
      </p>
    </div>
  );
}

function Btn({
  children,
  onClick,
  busy,
  disabled,
  tone,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "ok" | "warn" | "bad";
  className?: string;
}) {
  const color =
    tone === "ok"
      ? "border-ok/40 text-ok hover:bg-ok/10"
      : tone === "warn"
        ? "border-warn/40 text-warn hover:bg-warn/10"
        : tone === "bad"
          ? "border-bad/40 text-bad hover:bg-bad/10"
          : "border-line-strong text-ink hover:bg-panel-2";
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`h-9 whitespace-nowrap rounded-md border px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${color} ${className}`}
    >
      {busy ? "…" : children}
    </button>
  );
}
