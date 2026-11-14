"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Buttons that start work: the worker routine (open a PR, build a plan, answer
// feedback) or the local runner on your own machine.

type Action = "build-step" | "build-plan" | "open-pr" | "address-feedback" | "dismiss" | "run-task";

export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; url?: string } | null>(null);

  async function act(key: string, body: Record<string, unknown> & { action: Action }, okText: string) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string; sessionUrl?: string; runId?: string };
      if (!res.ok) throw new Error(json.error ?? "That didn't work.");
      setDone({ text: okText, url: json.sessionUrl });
      router.refresh();
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return { act, busy, error, done };
}

export function Btn({
  children,
  onClick,
  busy,
  disabled,
  tone,
  title,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  type?: "button" | "submit";
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "ok" | "warn" | "bad";
  title?: string;
  className?: string;
}) {
  const color =
    tone === "primary"
      ? "border-accent bg-accent text-on-accent hover:opacity-90"
      : tone === "ok"
        ? "border-ok/40 text-ok hover:bg-ok/10"
        : tone === "warn"
          ? "border-warn/40 text-warn hover:bg-warn/10"
          : tone === "bad"
            ? "border-bad/40 text-bad hover:bg-bad/10"
            : "border-line-strong text-ink hover:bg-panel-2";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${color} ${className}`}
    >
      {busy ? <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

export function Result({ error, done }: { error: string | null; done: { text: string; url?: string } | null }) {
  if (error) return <p className="mt-2 text-xs text-bad">{error}</p>;
  if (done)
    return (
      <p className="mt-2 text-xs text-ok">
        {done.text}{" "}
        {done.url && (
          <a href={done.url} target="_blank" rel="noreferrer" className="underline">
            Watch the session ↗
          </a>
        )}
      </p>
    );
  return null;
}

// ---------- the local runner ----------

const AGENT = "http://localhost:4873";
type AgentState = { status: "checking" | "missing" | "ready"; repo?: string; api?: string };

export function LocalRun({ job, factoryOrigin }: { job: { kind: "pr"; pr: number } | { kind: "patch"; task: string; id: string; base: string; patchUrl: string }; factoryOrigin: string }) {
  const [agent, setAgent] = useState<AgentState>({ status: "checking" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(`${AGENT}/health`)
        .then((r) => r.json())
        .then((j: { repo?: string; api?: string }) => alive && setAgent({ status: "ready", repo: j.repo, api: j.api }))
        .catch(() => alive && setAgent({ status: "missing" }));
    check();
    const t = setInterval(check, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      let body: unknown = job;
      if (job.kind === "patch") {
        const patch = await fetch(job.patchUrl).then((r) => {
          if (!r.ok) throw new Error("Couldn't load the run's patch.");
          return r.text();
        });
        body = { kind: "patch", task: job.task, id: job.id, base: job.base, patch };
      }
      const res = await fetch(`${AGENT}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { url?: string; error?: string; install?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "The runner couldn't start it.");
      setMsg({ ok: true, text: `Running at ${json.url}${json.install === "installed" ? " (installed packages first)" : ""}. It should have opened in your browser.`, url: json.url });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const cmd = `curl -fsSL ${factoryOrigin}/local-agent.mjs -o ~/.nightly-factory-agent.mjs && node ~/.nightly-factory-agent.mjs --repo ~/path/to/BirdieEyeView`;

  return (
    <div>
      <Btn onClick={agent.status === "ready" ? go : () => setHelp((h) => !h)} busy={busy} tone={agent.status === "ready" ? "primary" : undefined} title={agent.status === "ready" ? `Runner: ${agent.repo}` : "Start the local runner first"}>
        {agent.status === "ready" ? "Run on localhost" : agent.status === "checking" ? "Run on localhost" : "Run on localhost (set up)"}
      </Btn>
      {busy && <p className="mt-2 text-xs text-ink-3">Checking out and starting the dev server. The first run of a branch can take a minute.</p>}
      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>
          {msg.text}{" "}
          {msg.url && (
            <a href={msg.url} target="_blank" rel="noreferrer" className="underline">
              Open ↗
            </a>
          )}
        </p>
      )}
      {help && agent.status !== "ready" && (
        <div className="mt-3 max-w-xl rounded-lg border border-line bg-panel-2 p-3 text-xs text-ink-2">
          <p>The local runner isn&apos;t running. Start it once in a terminal and leave it open:</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-ink">{cmd}</pre>
          <p className="mt-2">
            It checks the run out into its own worktree under ~/.nightly-factory, starts the frontend, and opens it. /api goes to your local backend on :8000;
            add <code className="inline">--api https://your-api</code> to use another, or <code className="inline">--backend</code> to start the PR&apos;s own backend too.
          </p>
          <button onClick={() => navigator.clipboard.writeText(cmd)} className="mt-2 text-ink hover:underline">
            Copy command
          </button>
        </div>
      )}
    </div>
  );
}
