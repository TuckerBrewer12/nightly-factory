# Nightly factory

A review dashboard for the BirdieEyeView nightly runs. Each run is a draft PR plus a `run.json` it pushes. The factory shows:

- **Overview:** what needs your review, accepted vs runs per task, a 14-night grid of every task, and every run with filters.
- **Run page:** the summary, links to the PR, the preview build and the run's session, then tabs for the run as a graph, before/after screenshots, the changed files, and all comments.
- **Feedback:** Accept, Request changes, Comment, Reject (and merge when the PR isn't a draft). These post to the PR as you, and the next nightly run reads them in Step 0. **Answer feedback now** starts a run on it right away.
- **Unopened runs and plans:** a run that couldn't open its PR shows its diff (from its saved patch) with **Open PR**; a plan-only run has **Build this plan**; each "next in the series" step has **Build**. All of these start the worker routine.
- **Run on localhost:** checks the PR (or an unopened run's patch) out into its own worktree and starts the frontend, through the local runner (below).
- **Tasks page:** create, edit, pause, resume, delete and run tasks now. Tasks live in `factory.json` on the artifacts branch.
- Light and dark mode (Auto follows the system).

GitHub is the only store. See [REPORTING.md](REPORTING.md) for what a run writes and how feedback gets back to it.

## Deploy (Vercel)

1. **GitHub OAuth app**: github.com/settings/developers → New OAuth App.
   - Homepage URL: your Vercel URL (e.g. `https://nightly-factory.vercel.app`)
   - Callback URL: `https://<that domain>/api/auth/callback`
2. **Import this repo** in Vercel (framework: Next.js, no build settings to change).
3. **Environment variables** (see `.env.example`):
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` from step 1
   - `ALLOWED_USERS=TuckerBrewer12,GuoAnWang25`
   - `SESSION_SECRET`: `openssl rand -base64 32`
   - `GITHUB_TOKEN`: a fine-grained token on BirdieEyeView with Contents **read and write**, and Pull requests, Issues, Checks, Deployments read. The scheduler needs it to write `factory.json` and mark runs started; page reads use it too, so they're cached across viewers.
   - `FACTORY_ROUTINE_ID` and `FACTORY_ROUTINE_TOKEN`: the worker routine's API trigger (next section).
   - `CRON_SECRET`: any random string. Add the same value as an Actions secret named `CRON_SECRET` in this repo, for the scheduler workflow.
4. Deploy, then send GuoAn the URL. He signs in with GitHub. His account needs write access to BirdieEyeView for his feedback to post.

## The worker routine and the scheduler

Every run is a session of one claude.ai routine, "Nightly factory worker", started through its API trigger with an assignment the factory writes (`lib/assignments.ts`): the task's instructions plus the shared rules, review loop and report. Routines can only be created, paused and given repos in the claude.ai UI, so the factory keeps the tasks and schedule itself and starts the one routine.

1. claude.ai/code/routines → New routine, named "Nightly factory worker", with BirdieEyeView (push access), an **API** trigger only, and the prompt from the setup notes. Generate the token; the trigger id is the `trig_…` part of its URL.
2. `.github/workflows/tick.yml` calls `/api/cron/tick` every 30 minutes; it starts any task whose time has passed today and that hasn't run yet. Set `FACTORY_URL` as an Actions variable if the site isn't at nightly-factory.vercel.app.
3. Tasks start **paused** here. Turn them on under Tasks after you pause the old claude.ai scheduled tasks, so nothing runs twice.

## Local runner

```bash
curl -fsSL https://nightly-factory.vercel.app/local-agent.mjs -o ~/.nightly-factory-agent.mjs
node ~/.nightly-factory-agent.mjs --repo ~/path/to/BirdieEyeView
```

Leave it running. **Run on localhost** then fetches the PR (or applies the run's patch onto its task branch) into `~/.nightly-factory/worktrees/<name>`, reuses your `node_modules` when the lockfile matches, starts Vite on a free port and opens it. `/api` goes to `http://localhost:8000` (your own backend); `--api <url>` points it elsewhere, and `--backend` starts the PR's own backend from the worktree using your clone's `.venv` and `.env`. Only the factory's pages can call it.

## Live preview builds

The **Open preview** button appears when the PR's head commit has a successful non-production GitHub deployment. Turning on PR environments in the BirdieEyeView Railway project does this. Railway already posts deployments to GitHub for production. A run can also set `previewUrl` in its `run.json`.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in, or use the dev shortcut below
npm run dev
```

Dev shortcut, without OAuth: set `FACTORY_DEV_LOGIN=<your login>` (and optionally `GITHUB_TOKEN`). Feedback buttons need a real token. `FACTORY_LOCAL_ARTIFACTS=/path` reads `runs/<task>/<date>/run.json` and screenshots from a local folder instead of the artifacts branch.

## Config

`factory.config.ts` lists the repo, the artifacts branch and the tasks: one per scheduled task, keyed by branch prefix. Add a task there and its runs appear.

Each task has its own long-lived base branch (`factory/design`, `factory/library-feature`, `factory/cleanup`, `factory/speed`). A run's PR goes into its task's branch, so accepted work collects there, and you merge each into main when you're ready. The task cards show how far each branch is ahead of or behind main, linked to the compare view.
