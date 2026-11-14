const ERRORS: Record<string, string> = {
  state: "That sign-in link expired. Try again.",
  token: "GitHub didn't hand back a token. Try again.",
  denied: "isn't on this factory's list. Ask Tucker to add you.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; who?: string; next?: string }> }) {
  const { error, who, next } = await searchParams;
  const message = error === "denied" ? `${who || "That account"} ${ERRORS.denied}` : error ? ERRORS[error] : null;
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-8">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-3">Nightly factory</p>
        <h1 className="mt-2 text-xl font-medium">Sign in to review runs</h1>
        <p className="mt-2 text-sm text-ink-2">Your GitHub account is used to read the PRs and to post your feedback on them.</p>
        {message && <p className="mt-4 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{message}</p>}
        <a
          href={`/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="mt-6 flex h-10 items-center justify-center rounded-md bg-ink text-sm font-medium text-bg hover:bg-white"
        >
          Continue with GitHub
        </a>
      </div>
    </main>
  );
}
