// What the factory watches. One entry per scheduled task.
// A run is a pull request whose head branch is `<branchPrefix>YYYY-MM-DD`.

export type TaskConfig = {
  id: string;
  label: string;
  branchPrefix: string;
  // Long-lived branch the task's PRs go into; merged into main by hand.
  baseBranch: string;
  schedule: string;
  blurb: string;
};

const [owner, name] = (process.env.FACTORY_REPO ?? "TuckerBrewer12/BirdieEyeView").split("/");

export const factory = {
  repo: { owner, name },
  // Orphan branch the runs push their run.json and screenshots to.
  artifactsBranch: process.env.FACTORY_ARTIFACTS_BRANCH ?? "factory-artifacts",
  mainBranch: process.env.FACTORY_MAIN_BRANCH ?? "main",
  // How many nights the overview grid shows.
  nights: 14,
  tasks: [
    {
      id: "design",
      label: "Design",
      branchPrefix: "nightly/design-",
      baseBranch: "factory/design",
      schedule: "2:47 AM",
      blurb: "One UX or design improvement, measured against the canvas",
    },
    {
      id: "library-feature",
      label: "Library or feature",
      branchPrefix: "nightly/library-feature-",
      baseBranch: "factory/library-feature",
      schedule: "2:17 AM",
      blurb: "A third-party library, or the first slice of a feature",
    },
    {
      id: "cleanup",
      label: "Cleanup",
      branchPrefix: "nightly/cleanup-",
      baseBranch: "factory/cleanup",
      schedule: "1:47 AM",
      blurb: "One small area of code made better, behavior unchanged",
    },
    {
      id: "speed",
      label: "Speed",
      branchPrefix: "nightly/speed-",
      baseBranch: "factory/speed",
      schedule: "1:17 AM",
      blurb: "One measured performance win",
    },
  ] satisfies TaskConfig[],
};

export const LABELS = {
  accepted: "factory:accepted",
  changes: "factory:changes-requested",
  rejected: "factory:rejected",
} as const;
