// Hidden markers on the PR comments the factory posts, so it (and the runs)
// can tell a verdict from an ordinary comment.
export const FEEDBACK_MARKER = {
  changes: "<!-- factory:verdict=changes -->",
  accept: "<!-- factory:verdict=accept -->",
  reject: "<!-- factory:verdict=reject -->",
  comment: "<!-- factory:comment -->",
} as const;
