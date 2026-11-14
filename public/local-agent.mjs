#!/usr/bin/env node
// Nightly factory local runner.
//
// Lets the factory's "Run locally" button check out a run (a PR, or an unopened
// run's patch) into its own git worktree and start the frontend dev server on it.
//
//   node local-agent.mjs --repo ~/code/BirdieEyeView
//
// Options:
//   --repo <path>     your BirdieEyeView clone (required)
//   --api <url>       where the dev server sends /api (default http://localhost:8000,
//                     i.e. your own backend; use the production URL to review against real data)
//   --backend         also start the PR's backend (uvicorn) from the worktree, using the
//                     clone's .venv and .env, and point /api at it
//   --port <n>        port for this runner (default 4873)
//   --origin <url>    the factory's address (default https://nightly-factory.vercel.app)
//
// Only the factory's own pages can call it (checked by Origin). It runs the PR's code
// on your machine, the same as checking the branch out yourself.

import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { createServer as netServer } from "node:net";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const REPO = opt("repo") && resolve(opt("repo").replace(/^~/, homedir()));
const API = opt("api", "http://localhost:8000");
const BACKEND = flag("backend");
const PORT = Number(opt("port", "4873"));
const ORIGINS = [opt("origin", "https://nightly-factory.vercel.app"), "http://localhost:3000", "http://localhost:3100"];
const HOME = join(homedir(), ".nightly-factory");
const VERSION = 1;

if (!REPO || !existsSync(join(REPO, ".git"))) {
  console.error("Usage: node local-agent.mjs --repo <path to your BirdieEyeView clone>");
  process.exit(1);
}
mkdirSync(join(HOME, "worktrees"), { recursive: true });

const previews = new Map(); // name -> { url, procs, log }

const run = (cmd, argv, cwd, input) =>
  new Promise((ok, fail) => {
    const p = execFile(cmd, argv, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? fail(new Error(`${cmd} ${argv.join(" ")}\n${stderr || err.message}`)) : ok(stdout),
    );
    if (input) {
      p.stdin.write(input);
      p.stdin.end();
    }
  });

const freePort = (from) =>
  new Promise((ok) => {
    const s = netServer();
    s.once("error", () => ok(freePort(from + 1)));
    s.listen(from, () => s.close(() => ok(from)));
  });

const waitFor = async (url, ms = 180_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
};

function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" }).unref();
}

async function prepareWorktree(job) {
  const name = job.kind === "pr" ? `pr-${job.pr}` : `run-${job.task}-${job.id}`;
  const wt = join(HOME, "worktrees", name);
  await run("git", ["fetch", "origin", "--quiet", job.kind === "pr" ? `+pull/${job.pr}/head:refs/factory/${name}` : `+${job.base}:refs/factory/${name}-base`], REPO);
  const ref = job.kind === "pr" ? `refs/factory/${name}` : `refs/factory/${name}-base`;
  if (existsSync(wt)) {
    await run("git", ["am", "--abort"], wt).catch(() => {});
    await run("git", ["checkout", "--quiet", "--force", "--detach", ref], wt);
    await run("git", ["reset", "--quiet", "--hard", ref], wt);
  } else {
    await run("git", ["worktree", "add", "--quiet", "--detach", wt, ref], REPO);
  }
  if (job.kind === "patch") {
    await run("git", ["-c", "user.name=Nightly factory", "-c", "user.email=factory@localhost", "am", "-3", "--quiet"], wt, job.patch);
  }
  return { name, wt };
}

async function installFrontend(wt) {
  const fe = join(wt, "frontend");
  const mine = join(REPO, "frontend");
  const sameLock =
    existsSync(join(mine, "node_modules")) &&
    existsSync(join(mine, "package-lock.json")) &&
    readFileSync(join(mine, "package-lock.json"), "utf8") === readFileSync(join(fe, "package-lock.json"), "utf8");
  if (existsSync(join(fe, "node_modules"))) return "kept";
  if (sameLock) {
    symlinkSync(join(mine, "node_modules"), join(fe, "node_modules"), "dir");
    return "linked";
  }
  await run("npm", ["ci", "--no-audit", "--no-fund", "--prefer-offline"], fe);
  return "installed";
}

async function start(job) {
  const { name, wt } = await prepareWorktree(job);
  const old = previews.get(name);
  if (old) old.procs.forEach((p) => p.kill());
  const procs = [];
  let api = API;

  if (BACKEND) {
    const bePort = await freePort(8100);
    const py = existsSync(join(REPO, ".venv/bin/python")) ? join(REPO, ".venv/bin/python") : "python3";
    const env = { ...process.env };
    if (existsSync(join(REPO, ".env"))) {
      for (const line of readFileSync(join(REPO, ".env"), "utf8").split("\n")) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    procs.push(spawn(py, ["-m", "uvicorn", "api.main:app", "--port", String(bePort)], { cwd: wt, env, stdio: "ignore" }));
    api = `http://localhost:${bePort}`;
    await waitFor(`${api}/docs`, 60_000);
  }

  const install = await installFrontend(wt);
  const fe = join(wt, "frontend");
  writeFileSync(
    join(fe, "vite.factory.config.ts"),
    `import { mergeConfig } from "vite";\nimport base from "./vite.config";\nexport default mergeConfig(base as any, { server: { proxy: { "/api": { target: ${JSON.stringify(api)}, changeOrigin: true, secure: true } } } });\n`,
  );
  const port = await freePort(5180);
  procs.push(spawn("npx", ["vite", "--config", "vite.factory.config.ts", "--port", String(port), "--strictPort"], { cwd: fe, stdio: "ignore" }));
  const url = `http://localhost:${port}`;
  const up = await waitFor(url);
  if (!up) throw new Error("The dev server didn't come up within 3 minutes.");
  previews.set(name, { url, procs, worktree: wt });
  openBrowser(url);
  return { name, url, worktree: wt, install, api };
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    return true;
  }
  return false;
}

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(allowed ? 204 : 403).end();
  if (!allowed) return send(res, 403, { error: "Only the factory can call this runner." });

  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, version: VERSION, repo: REPO, api: BACKEND ? "backend from the PR" : API, previews: [...previews].map(([n, p]) => ({ name: n, url: p.url })) });
  }
  if (req.method === "POST" && req.url === "/run") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const job = JSON.parse(raw);
      if (job.kind === "pr" && !Number.isInteger(job.pr)) throw new Error("pr must be a number");
      if (job.kind === "patch" && (typeof job.patch !== "string" || !/^[\w./-]+$/.test(job.base) || !/^[\w-]+$/.test(job.task) || !/^[\w-]+$/.test(job.id))) throw new Error("bad patch job");
      if (job.kind !== "pr" && job.kind !== "patch") throw new Error("unknown kind");
      console.log(`▶ ${job.kind === "pr" ? `PR #${job.pr}` : `${job.task} ${job.id} (patch onto ${job.base})`}`);
      const out = await start(job);
      console.log(`  ${out.url}  (${out.worktree}, packages ${out.install})`);
      return send(res, 200, out);
    } catch (e) {
      console.error(`  failed: ${e.message}`);
      return send(res, 500, { error: e.message });
    }
  }
  if (req.method === "POST" && req.url === "/stop") {
    previews.forEach((p) => p.procs.forEach((x) => x.kill()));
    previews.clear();
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Nightly factory local runner on http://localhost:${PORT}`);
  console.log(`  repo: ${REPO}`);
  console.log(`  /api goes to: ${BACKEND ? "each PR's own backend" : API}`);
  console.log(`  worktrees: ${join(HOME, "worktrees")}`);
});

const stopAll = () => {
  previews.forEach((p) => p.procs.forEach((x) => x.kill()));
  process.exit(0);
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
