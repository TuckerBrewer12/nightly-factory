import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-ink-3">Not found</p>
        <p className="mt-2 text-ink-2">No run for that task and night.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-info hover:underline">Back to all runs</Link>
      </div>
    </main>
  );
}
