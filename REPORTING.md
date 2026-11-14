# How a run reports to the factory

The factory reads three things from GitHub. Nothing else is needed.

1. **The pull request.** Its head branch names the run: `nightly/<task>-<run id>`, where the run id is the Pacific date, or the date plus a suffix for extra runs that day (`2026-11-15-step2`).
2. **`run.json`**, screenshots and (for a run that couldn't open its PR) `run.patch`, on the orphan branch `factory-artifacts`, in `runs/<task>/<run id>/`. The worker's assignment spells out exactly what to write.
3. **GitHub's own data** for the PR: check runs on the head commit, comments, files, and deployments (a preview deploy shows up as the **Open preview** button).

A run without `run.json` still shows up. Its summary is then the first paragraph of the PR body, and the graph only has what GitHub knows.

## run.json

```json
{
  "version": 1,
  "task": "design",
  "date": "2026-11-14",
  "branch": "nightly/design-2026-11-14",
  "pr": 701,
  "title": "[nightly/design] Dashboard: offer a new golfer their first scan instead of empty figures",
  "summary": "A golfer with no rounds sees one card, \"Scan your first round\", instead of four empty figure cards. Once a round is saved the dashboard is unchanged.",
  "reviewFirst": ["hasRounds: a failed load must still show the error, not the first-run card."],
  "stillOpen": ["Four new screenshot baselines need CI's macOS renders."],
  "next": ["The empty handicap tile on a phone.", "The same first-run card on Rounds, Analytics and Career."],
  "session": "https://claude.ai/code/session_…",
  "startedAt": "2026-11-14T10:47:43Z",
  "finishedAt": "2026-11-14T11:07:08Z",
  "previewUrl": null,
  "stages": [
    { "id": "followup", "label": "Earlier PRs", "status": "ok", "detail": "Answered 2 bot comments on #574", "seconds": 95 },
    { "id": "context", "label": "Canvas and code", "status": "ok", "detail": "Read 6 Dashboard frames", "seconds": 180 },
    { "id": "build", "label": "Builder", "status": "ok", "detail": "12 files, +237 −15", "seconds": 410 },
    { "id": "pr", "label": "Pull request", "status": "ok", "detail": "Draft #701 into frontend-refactor" },
    { "id": "fix", "label": "Fixer", "status": "ok", "detail": "Fixed 1 failing check, answered 3 comments", "rounds": 2 }
  ],
  "checks": [
    { "name": "Lint", "status": "pass" },
    { "name": "Unit tests", "status": "pass", "detail": "809 passed" },
    { "name": "Screenshots", "status": "pass", "detail": "12/12 unchanged" }
  ],
  "screenshots": [
    { "name": "Dashboard, no rounds (desktop)", "before": "shots/dashboard-desktop-before.png", "after": "shots/dashboard-desktop-after.png" },
    { "name": "Dashboard, no rounds (mobile)", "before": "shots/dashboard-mobile-before.png", "after": "shots/dashboard-mobile-after.png" }
  ]
}
```

| Field | Meaning |
|---|---|
| `summary` | 1–3 plain sentences. What a golfer or developer will notice, not how it was done. The first thing a reviewer reads. |
| `reviewFirst` | Where to look first in the diff, most important first. |
| `stillOpen` | Anything unfinished or failing. Shown as a warning on the run page. |
| `next` | The rest of the series when this is PR 1 of several. |
| `stages` | `status` is `ok`, `warn`, `fail` or `skipped`. Known `id`s go in fixed places in the graph: `followup` (Step 0), `context`, `build`, `pr`, `fix`. Any other id is drawn after Build. |
| `checks` | Checks the run ran locally. `status` is `pass`, `fail` or `skip`. |
| `screenshots` | Paths are relative to the run's folder, or full `https://` URLs. `before` is null for a new screen. |
| `previewUrl` | Optional. Otherwise the factory looks for a non-production GitHub deployment on the head commit (Railway and Vercel PR environments post these). |
| `id` | The run id (folder name). Defaults to `date`. |
| `status` | `running` while the worker is on it (the factory writes this when it starts a run), then `done`. |
| `kind` | `change`, or `plan` for a run that only planned; then `plan` holds the plan as markdown and the page offers **Build this plan**. |
| `patch` | `run.patch`, the run's commits from `git format-patch`, when the PR couldn't be opened. The Changes tab shows it and **Open PR** applies it. |
| `origin` | Who or what started the run (`schedule`, `manual`, `build-step`, `open-pr`, `feedback`). The factory writes it; the worker keeps it. |

Unknown fields are ignored and malformed entries are dropped, so a slightly wrong file still renders.

## Pushing it

Each run writes only its own folder, so concurrent runs never conflict; a rejected push just needs a rebase.

```bash
git fetch --depth=1 origin factory-artifacts
git worktree add --detach /tmp/fa origin/factory-artifacts
mkdir -p /tmp/fa/runs/$TASK/$DATE/shots
cp run.json /tmp/fa/runs/$TASK/$DATE/
cp shots/*.png /tmp/fa/runs/$TASK/$DATE/shots/
cd /tmp/fa && git add runs/$TASK/$DATE && git commit -m "run: $TASK $DATE"
for i in 1 2 3; do
  git push origin HEAD:factory-artifacts && break
  git fetch --depth=1 origin factory-artifacts && git rebase origin/factory-artifacts
done
```

The branch has no workflow files, so pushes to it don't start CI.

## Feedback the runs read back

Feedback from the factory lands on the PR as an ordinary comment by the reviewer, with a label and a hidden marker:

| Button | Comment marker | Label | Also |
|---|---|---|---|
| Request changes | `<!-- factory:verdict=changes -->` | `factory:changes-requested` | |
| Accept | `<!-- factory:verdict=accept -->` | `factory:accepted` | |
| Reject | `<!-- factory:verdict=reject -->` | `factory:rejected` | closes the PR |
| Comment | `<!-- factory:comment -->` | | |

Labels are used instead of GitHub review states because the runs open PRs under Tucker's account, and GitHub doesn't let you approve or request changes on your own PR.

A run's Step 0 treats a `changes` comment as its first job. When it pushes after the request, the factory shows the run as **Revised, needs review**.
