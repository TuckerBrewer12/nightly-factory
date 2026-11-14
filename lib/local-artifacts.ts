import { parseManifest } from "@/lib/manifest";

// Development only: read run.json files and screenshots from a local folder laid out
// like the artifacts branch (runs/<task>/<date>/...), set by FACTORY_LOCAL_ARTIFACTS.
export async function localArtifacts() {
  const root = process.env.FACTORY_LOCAL_ARTIFACTS;
  if (!root || process.env.NODE_ENV === "production") return null;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return {
    async list() {
      const out = new Set<string>();
      const runs = path.join(root, "runs");
      for (const task of await fs.readdir(runs).catch(() => [])) {
        for (const date of await fs.readdir(path.join(runs, task)).catch(() => [])) {
          if (await fs.stat(path.join(runs, task, date, "run.json")).catch(() => null)) out.add(`${task}/${date}`);
        }
      }
      return out;
    },
    async manifest(task: string, date: string) {
      const raw = await fs.readFile(path.join(root, "runs", task, date, "run.json"), "utf8").catch(() => null);
      return raw ? parseManifest(JSON.parse(raw)) : null;
    },
    async file(rel: string) {
      return fs.readFile(path.join(root, rel)).catch(() => null);
    },
  };
}
