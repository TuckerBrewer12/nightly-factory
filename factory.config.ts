// Fixed settings. The tasks themselves live in factory.json on the artifacts
// branch, so they can be created, edited, paused and deleted from the UI
// (see lib/tasks.ts). DEFAULT_TASKS there seeds that file the first time.

const [owner, name] = (process.env.FACTORY_REPO ?? "TuckerBrewer12/BirdieEyeView").split("/");

export const factory = {
  repo: { owner, name },
  // Orphan branch for run reports, screenshots, patches and factory.json.
  artifactsBranch: process.env.FACTORY_ARTIFACTS_BRANCH ?? "factory-artifacts",
  mainBranch: process.env.FACTORY_MAIN_BRANCH ?? "main",
  timezone: "America/Los_Angeles",
  // How many nights the overview grid shows.
  nights: 14,
  // People whose comments count as review feedback (the runs open PRs under the first one).
  reviewers: (process.env.ALLOWED_USERS ?? "TuckerBrewer12,GuoAnWang25")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export const LABELS = {
  accepted: "factory:accepted",
  changes: "factory:changes-requested",
  rejected: "factory:rejected",
} as const;
