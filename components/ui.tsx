import { GitHubError } from "@/lib/github";
import Link from "next/link";
import { cookies } from "next/headers";
import { factory } from "@/factory.config";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Verdict } from "@/lib/runs";
import { VERDICT_TEXT } from "@/lib/runs";
import type { Viewer } from "@/lib/session";

const VERDICT_STYLE: Record<Verdict, string> = {
  "needs-review": "text-warn border-warn/30 bg-warn/10",
  revised: "text-warn border-warn/30 bg-warn/10",
  unopened: "text-warn border-warn/30 bg-warn/10",
  plan: "text-info border-info/30 bg-info/10",
  running: "text-info border-info/30 bg-info/10",
  changes: "text-info border-info/25 bg-info/10",
  accepted: "text-ok border-ok/30 bg-ok/10",
  merged: "text-ok border-ok/30 bg-ok/10",
  rejected: "text-ink-3 border-line-strong bg-panel-2",
  "no-pr": "text-bad border-bad/30 bg-bad/10",
};

export const VERDICT_DOT: Record<Verdict, string> = {
  "needs-review": "bg-warn",
  revised: "bg-warn",
  unopened: "bg-warn/60",
  plan: "bg-info/70",
  running: "bg-info",
  changes: "bg-info",
  accepted: "bg-ok",
  merged: "bg-ok",
  rejected: "bg-ink-3",
  "no-pr": "bg-bad",
};

export function VerdictPill({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium ${VERDICT_STYLE[verdict]} ${className}`}>
      <span className={`size-1.5 rounded-full ${VERDICT_DOT[verdict]} ${verdict === "running" ? "animate-pulse" : ""}`} />
      {VERDICT_TEXT[verdict]}
    </span>
  );
}

export function TaskTag({ label }: { label: string }) {
  return <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border border-line bg-panel-2 px-2 font-mono text-[11px] text-ink-2">{label}</span>;
}

export async function Header({ viewer, crumbs, wide }: { viewer: Viewer; crumbs?: { href?: string; label: string }[]; wide?: boolean }) {
  const { owner, name } = factory.repo;
  const theme = (await cookies()).get("theme")?.value;
  const initial = theme === "light" || theme === "dark" ? theme : "system";
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
      <div className={`mx-auto flex h-14 items-center gap-3 px-5 ${wide ? "max-w-none" : "max-w-6xl"}`}>
        <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium">
          <span className="grid size-6 place-items-center rounded-md border border-line-strong bg-panel-2 font-mono text-[11px]">nf</span>
          Nightly factory
        </Link>
        <span className="hidden text-ink-3 sm:inline">/</span>
        <a href={`https://github.com/${owner}/${name}`} className="hidden font-mono text-xs text-ink-2 hover:text-ink sm:inline">
          {owner}/{name}
        </a>
        {crumbs?.map((c) => (
          <span key={c.label} className="hidden items-center gap-3 md:flex">
            <span className="text-ink-3">/</span>
            {c.href ? (
              <Link href={c.href} className="text-sm text-ink-2 hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className="text-sm text-ink-2">{c.label}</span>
            )}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <Link href="/tasks" className="text-sm text-ink-2 hover:text-ink">
            Tasks
          </Link>
          <ThemeToggle initial={initial} />
          {viewer.avatar ? <img src={viewer.avatar} alt="" className="size-6 rounded-full" /> : null}
          <span className="hidden text-sm text-ink-2 lg:inline">{viewer.login}</span>
          <form action="/api/auth/logout" method="post">
            <button className="whitespace-nowrap text-xs text-ink-3 hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function formatNight(date: string, style: "short" | "long" = "short") {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: style === "long" ? "long" : "short", month: "short", day: "numeric" });
}

export function runLabel(id: string) {
  const extra = id.slice(11);
  return extra ? `${formatNight(id)} · ${extra}` : formatNight(id);
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink-3">{children}</h2>
      {right}
    </div>
  );
}

export function ErrorPanel({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GitHubError && error.status === 401) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm text-ink-2">
        <p className="font-medium text-ink">Your GitHub sign-in has expired.</p>
        <p className="mt-1">GitHub stopped accepting the token from when you last signed in. Signing in again takes a second.</p>
        <a href="/api/auth/login" className="mt-3 inline-block rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-bg">
          Sign in again
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-bad/30 bg-bad/10 p-4 text-sm text-bad">
      <p className="font-medium">Couldn&apos;t load from GitHub.</p>
      <p className="mt-1 font-mono text-xs opacity-80">{message}</p>
    </div>
  );
}
