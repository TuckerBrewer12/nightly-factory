"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  }, [theme]);

  return (
    <button
      onClick={() => setTheme(NEXT[theme])}
      title="Switch theme"
      className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-2 hover:text-ink"
    >
      <span aria-hidden className="inline-block size-3 rounded-full border border-ink-3 bg-[linear-gradient(90deg,var(--c-ink)_50%,transparent_50%)]" />
      {LABEL[theme]}
    </button>
  );
}
