// Unified diffs, from GitHub's per-file `patch` or from a `git format-patch` file.

export type DiffLine = { kind: "add" | "del" | "ctx" | "note"; old?: number; new?: number; text: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = {
  path: string;
  oldPath?: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[] | null; // null: binary or too large to show
  commit?: string; // which commit, for a multi-commit patch
  url?: string;
};

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let o = 0;
  let n = 0;
  for (const raw of patch.split("\n")) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      cur = { header: raw, lines: [] };
      hunks.push(cur);
      o = Number(m[1]);
      n = Number(m[2]);
      continue;
    }
    if (!cur) continue;
    const c = raw[0];
    if (c === "+") cur.lines.push({ kind: "add", new: n++, text: raw.slice(1) });
    else if (c === "-") cur.lines.push({ kind: "del", old: o++, text: raw.slice(1) });
    else if (c === "\\") cur.lines.push({ kind: "note", text: raw.slice(1).trim() });
    else if (c === " " || raw === "") {
      // A trailing empty line at the end of the patch isn't context.
      cur.lines.push({ kind: "ctx", old: o++, new: n++, text: raw.slice(1) });
    }
  }
  // Drop a dangling empty context line produced by the final newline.
  for (const h of hunks) {
    const last = h.lines.at(-1);
    if (last && last.kind === "ctx" && last.text === "") h.lines.pop();
  }
  return hunks;
}

const count = (hunks: DiffHunk[], kind: "add" | "del") => hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === kind).length, 0);

// A git format-patch file (one or more commits, mbox style) or a plain `git diff`.
export function parsePatchFile(text: string): DiffFile[] {
  const commits = text.split(/^(?=From [0-9a-f]{7,40} )/m).filter((c) => c.trim());
  const files: DiffFile[] = [];
  const multi = commits.length > 1;
  commits.forEach((commit, i) => {
    const subj = /^Subject: (?:\[PATCH[^\]]*\] )?((?:.*)(?:\n [^\n]*)*)/m.exec(commit)?.[1]?.replace(/\n /g, " ").trim();
    const sections = commit.split(/^(?=diff --git )/m).slice(1);
    for (const sec of sections) {
      const head = /^diff --git a\/(.+?) b\/(.+)$/m.exec(sec);
      if (!head) continue;
      const [, a, b] = head;
      const binary = /^Binary files /m.test(sec) || /^GIT binary patch/m.test(sec);
      const status: DiffFile["status"] = /^new file mode/m.test(sec)
        ? "added"
        : /^deleted file mode/m.test(sec)
          ? "removed"
          : a !== b
            ? "renamed"
            : "modified";
      const body = sec.slice(sec.indexOf("\n@@") + 1);
      const hunks = binary || sec.indexOf("\n@@") < 0 ? null : parseHunks(body.replace(/\n-- \n[\s\S]*$/, "\n"));
      files.push({
        path: b,
        oldPath: a !== b ? a : undefined,
        status,
        additions: hunks ? count(hunks, "add") : 0,
        deletions: hunks ? count(hunks, "del") : 0,
        hunks,
        commit: multi ? `${i + 1}/${commits.length}${subj ? ` · ${subj}` : ""}` : undefined,
      });
    }
  });
  return files;
}

type GhFile = { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string; blob_url: string };

export function fromGitHubFiles(files: GhFile[]): DiffFile[] {
  return files.map((f) => ({
    path: f.filename,
    oldPath: f.previous_filename,
    status: f.status === "added" ? "added" : f.status === "removed" ? "removed" : f.status === "renamed" ? "renamed" : "modified",
    additions: f.additions,
    deletions: f.deletions,
    hunks: f.patch ? parseHunks(f.patch) : null,
    url: f.blob_url,
  }));
}
