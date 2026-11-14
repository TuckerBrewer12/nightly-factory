import { factory } from "@/factory.config";
import { manifestDir } from "@/lib/manifest";
import type { FactoryTask, ScreenshotPolicy } from "@/lib/tasks";

// The text the worker routine is started with. One function per kind of job;
// they share the repo, rules, review loop and report sections.

const REPO = `https://github.com/${factory.repo.owner}/${factory.repo.name}`;
const API_REPO = `repos/${factory.repo.owner}/${factory.repo.name}`;
const REVIEWERS = factory.reviewers.join(" or ");

function header(kind: string, task: FactoryTask, runId: string) {
  return `NIGHTLY FACTORY ASSIGNMENT
Kind: ${kind}
Task: ${task.id} (${task.label})
Run id: ${runId}
Branch for this run: nightly/${task.id}-${runId}
Base branch: ${task.baseBranch}

REPO
${REPO} — golf scorecard scanning app. FastAPI/Python backend, React + TypeScript + Vite + Tailwind web frontend, PostgreSQL, a React Native mobile client in progress. Scanning pipeline: Mistral OCR, then Gemini Flash, with an eval suite. Check the repo itself for the real layout.
If the repo isn't already in this session, attach it with add_repo (owner ${factory.repo.owner}, repo ${factory.repo.name}, access "push") and clone it.
BASE BRANCH: this task's work collects on its own long-lived branch, \`${task.baseBranch}\`. Fetch it and create this run's branch from it. Tucker merges it into main himself: don't merge main into it and never push to it directly. If it doesn't exist, don't pick another base: write the factory report with the "pr" stage failed and say why.`;
}

const STEP0 = (task: FactoryTask) => `STEP 0: FOLLOW UP ON EARLIER PRs
Before new work, look at this task's earlier open PRs (branches nightly/${task.id}-*). If any have failing checks, or review comments from the bots or from ${REVIEWERS} that nobody has answered, handle those first: push fixes to that PR's branch and reply to each comment. Spend at most about a third of the run on this.
Feedback from the nightly factory arrives as ordinary PR comments. A comment containing \`<!-- factory:verdict=changes -->\` (and the label \`factory:changes-requested\`) is a change request: do it before anything else, push to that PR's branch, then reply saying what changed. \`factory:accepted\` means done: touch it only if a check fails. A closed PR labelled \`factory:rejected\` has the reason in its last factory comment: don't propose that idea again. Never add or remove \`factory:*\` labels yourself.`;

const RULES = (task: FactoryTask, runId: string, title: string) => `RULES
- Open exactly ONE new DRAFT pull request from nightly/${task.id}-${runId} into ${task.baseBranch} (gh pr create --draft --base ${task.baseBranch}). Never merge it, and never push directly to ${task.baseBranch}, main, or any other base branch.
- PR title starts with "${title}".
- Before choosing work, check open and recently closed PRs on nightly/* branches (gh pr list --state all --search "head:nightly/" --limit 30). Don't duplicate or conflict with open ones, and don't re-propose ideas from closed ones.
- For anything bigger than one small PR, plan it as a numbered series, implement only PR 1, and write the full plan in the PR description: every step, why, and the risks. Put the remaining steps in run.json's "next" so they can be built from the factory with one click.
- Before opening the PR, run whichever of the project's checks apply locally: lint, type check, unit tests, screenshot tests, build. If the change intentionally changes the UI, update the screenshot baselines the way the repo does it and list which changed and why.
- Plain, direct language with no filler, in the PR and in run.json.

CHECKS AND REVIEWERS (the run isn't done when the PR is opened)
The repo runs CI, including screenshot tests, and several review bots on every PR (Brand Kit Bot, MVVM Bot, UI Test Checker, the coverage comment).
1. After opening the draft PR, wait for CI (gh pr checks <number> --watch). Then keep polling for a few minutes until the review bots have posted. Read general comments (gh pr view <number> --comments) and inline review comments (gh api ${API_REPO}/pulls/<number>/comments).
2. Fix every failing check with new commits on the PR branch.
3. Answer every review comment. If it's right, fix it and reply saying what changed. If you disagree, reply with a short explanation. Resolve threads you've addressed.
4. Repeat 1–3, up to 3 rounds. If something is still failing after that, keep the PR as a draft and put a "Still open" section at the top of the description.
- Never disable, skip, or loosen tests, lint rules, screenshot thresholds, or bot checks to get a green build.`;

const SHOTS: Record<ScreenshotPolicy, string> = {
  required: "Required: this task changes the UI.",
  "if-visible": "Take them when the change is something a golfer can see; skip otherwise.",
  skip: "This task shouldn't change the UI, so skip them unless it did (and then say why under stillOpen).",
};

const REPORT = (task: FactoryTask, runId: string) => {
  const dir = manifestDir(task.id, runId);
  return `FACTORY REPORT (the last step, including when the PR couldn't be opened)
Tucker and GuoAn review this run in the nightly factory, which reads a run.json you push.
1. SCREENSHOTS. ${SHOTS[task.screenshots]} With Playwright, against the same fixtures and data, capture each screen or state you changed at 1280×800 and 390×844: on the base commit ("before") and on your branch ("after"). A new screen has no before. PNG, at most 8 pairs, each under 1.5 MB, named <screen>-<desktop|mobile>-<before|after>.png.
2. PATCH. If the PR couldn't be opened, save your commits as run.patch (git format-patch --stdout ${task.baseBranch}..HEAD > run.patch) so the factory can show the diff and open the PR later.
3. WRITE run.json:
   - version: 1, task: "${task.id}", id: "${runId}", date: "${runId.slice(0, 10)}", branch: "nightly/${task.id}-${runId}", pr: the PR number or null, title: the PR title, status: "done".
   - kind: "change", or "plan" if this run only planned and wrote no code (then put the plan, as markdown, in "plan").
   - summary: 1–3 plain sentences a reviewer reads first: what a golfer or developer will notice and why it matters, not how it was built.
   - reviewFirst: where to look first in the diff. stillOpen: anything failing or unfinished. next: the remaining steps of a series, one sentence each.
   - session: this session's URL (https://claude.ai/code/session_...). startedAt / finishedAt: ISO times. previewUrl: null unless you know one. patch: "run.patch" if you saved one.
   - stages: [{id, label, status: "ok"|"warn"|"fail"|"skipped", detail: one short line, seconds?, rounds?}] with ids "followup" (Step 0), "context" (what you read and why you picked this), "build" (files and size), "pr" (opening the PR), "fix" (CI and bot rounds).
   - checks: what you ran locally, [{name, status: "pass"|"fail"|"skip", detail?}].
   - screenshots: [{name, before: "shots/<file>" or null, after: "shots/<file>", note?}], or [].
   Keep the "origin" field already in the run.json the factory wrote, if there is one.
4. PUSH to the orphan branch ${factory.artifactsBranch}, folder ${dir}/ (run.json and run.patch at the top, PNGs in shots/). Touch nothing outside that folder:
   git fetch --depth=1 origin ${factory.artifactsBranch} && git worktree add --detach /tmp/fa origin/${factory.artifactsBranch}
   copy the files into /tmp/fa/${dir}/, then in /tmp/fa: git add ${dir} && git commit -m "run: ${task.id} ${runId}"
   git push origin HEAD:${factory.artifactsBranch}. If it's rejected, git fetch --depth=1 origin ${factory.artifactsBranch} && git rebase origin/${factory.artifactsBranch}, and push again, up to 3 tries.`;
};

const titlePrefix = (task: FactoryTask) => `[nightly/${task.id}]`;

export function scheduledAssignment(task: FactoryTask, runId: string, why: "schedule" | "manual") {
  return [
    header(why === "schedule" ? "scheduled run" : "run started by hand from the factory", task, runId),
    STEP0(task),
    `TASK\n${task.prompt}`,
    RULES(task, runId, titlePrefix(task)),
    REPORT(task, runId),
  ].join("\n\n");
}

export function buildStepAssignment(
  task: FactoryTask,
  runId: string,
  from: { id: string; title: string; summary: string; pr?: number | null; plan?: string },
  step: string,
  stepNumber: number,
  by: string,
) {
  return [
    header(`build a step ${by} approved in the factory`, task, runId),
    `TASK
Build step ${stepNumber} of the plan from the "${task.label}" run ${from.id}: "${from.title}".
That run: ${from.summary}${from.pr ? `\nIts PR: ${REPO}/pull/${from.pr}. If it isn't merged into ${task.baseBranch} yet and this step needs it, branch from that PR's branch instead and say so in the PR.` : ""}
${from.plan ? `\nThe plan it wrote:\n${from.plan}\n` : ""}
The step to build now:
${step}

Skip Step 0 for this run. Build only this step, as one reviewable PR. Read the earlier run's PR or write-up first so this fits what it did.`,
    RULES(task, runId, titlePrefix(task)),
    REPORT(task, runId),
  ].join("\n\n");
}

export function openPrAssignment(task: FactoryTask, runId: string, m: { title: string; summary: string; patch?: string; patchSource?: string; reportSource?: string }, by: string) {
  const dir = manifestDir(task.id, runId);
  const where = m.patch
    ? `Its commits are saved as a patch on the ${factory.artifactsBranch} branch at ${dir}/${m.patch}. Apply it with git am -3 onto a new branch nightly/${task.id}-${runId} cut from ${task.baseBranch}.`
    : `Its commits were saved in the BirdieEyeView Project as ${m.patchSource ?? "a patch"}${m.reportSource ? `, with the full write-up in ${m.reportSource}` : ""}. If this session has the Projects tool, read both there and apply the patch with git am -3. Otherwise rebuild the change from the write-up and the summary below.`;
  return [
    header(`open the PR for an earlier run that couldn't open one (${by} asked from the factory)`, task, runId),
    `TASK
The ${task.label} run ${runId} produced "${m.title}" but couldn't open its PR.
Summary: ${m.summary}
${where}
${task.baseBranch} has moved since that run, so resolve conflicts against it, keep the change's intent, and re-run the checks. Then open the draft PR and run the review loop. Skip Step 0 for this run.
In run.json, keep the existing fields and update pr, stages, checks, screenshots and stillOpen; remove "patch" once the PR is open.`,
    RULES(task, runId, `${titlePrefix(task)}`),
    REPORT(task, runId),
  ].join("\n\n");
}

export function feedbackAssignment(task: FactoryTask, runId: string, pr: number, by: string) {
  return [
    header(`answer review feedback now (${by} asked from the factory)`, task, runId),
    `TASK
PR #${pr} (${REPO}/pull/${pr}) has new feedback. Do Step 0 for this PR only: read every unanswered comment from the review bots and from ${REVIEWERS}, including any \`<!-- factory:verdict=changes -->\` comment, make the changes on the PR's own branch, reply to each comment, and run the review loop until checks pass. Don't open a new PR.`,
    STEP0(task),
    `CHECKS\nRun the project's checks that apply before pushing, and wait for CI after. Never loosen tests, lint rules, screenshot thresholds or bot checks.`,
    `REPORT\nUpdate ${manifestDir(task.id, runId)}/run.json on ${factory.artifactsBranch} if it exists: add a "fix" stage for this round and refresh stillOpen. Touch nothing else on that branch.`,
  ].join("\n\n");
}
