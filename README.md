# Nightly factory

A review dashboard for the BirdieEyeView nightly runs. Each run is a draft PR plus a `run.json` it pushes. The factory shows:

- **Overview:** what needs your review, accepted vs runs per task, a 14-night grid of every task, and every run with filters.
- **Run page:** the summary, links to the PR, the preview build and the run's session, then tabs for the run as a graph, before/after screenshots, the changed files, and all comments.
- **Feedback:** Accept, Request changes, Comment, Reject (and merge when the PR isn't a draft). These post to the PR as you, and the next nightly run reads them in Step 0.

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
   - `GITHUB_TOKEN` (optional): a fine-grained token with read access to BirdieEyeView (Contents, Pull requests, Issues, Checks, Deployments: read). Reads are then shared and cached across viewers. Without it, each viewer's own token is used.
4. Deploy, then send GuoAn the URL. He signs in with GitHub. His account needs write access to BirdieEyeView for his feedback to post.

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
