import { NextResponse, type NextRequest } from "next/server";
import { LABELS } from "@/factory.config";
import { FEEDBACK_MARKER } from "@/lib/feedback-marker";
import { GitHubError, ghSend, repoPath } from "@/lib/github";
import { getViewer } from "@/lib/session";

type Action = "comment" | "changes" | "accept" | "reject" | "merge" | "reopen";

const HEAD: Record<Exclude<Action, "merge" | "reopen">, string> = {
  comment: "",
  changes: "**Changes requested** (via nightly factory)",
  accept: "**Accepted** (via nightly factory)",
  reject: "**Rejected** (via nightly factory)",
};
const MARK: Record<Exclude<Action, "merge" | "reopen">, string> = {
  comment: FEEDBACK_MARKER.comment,
  changes: FEEDBACK_MARKER.changes,
  accept: FEEDBACK_MARKER.accept,
  reject: FEEDBACK_MARKER.reject,
};

export async function POST(req: NextRequest) {
  // Local dev has no OAuth token, so writes need a real session.
  const viewer = await getViewer();
  if (!viewer?.token) return NextResponse.json({ error: "Sign in with GitHub to leave feedback." }, { status: 401 });

  const { pr, action, text } = (await req.json()) as { pr?: number; action?: Action; text?: string };
  if (!pr || !Number.isInteger(pr) || !action || !(action in HEAD || action === "merge" || action === "reopen")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const body = (text ?? "").trim();
  if ((action === "comment" || action === "changes" || action === "reject") && !body) {
    return NextResponse.json({ error: "Say what you'd like changed." }, { status: 400 });
  }

  const t = viewer.token;
  const issue = `${repoPath()}/issues/${pr}`;
  const removeLabel = (name: string) => ghSend("DELETE", `${issue}/labels/${encodeURIComponent(name)}`, t, undefined, { allow404: true });
  const addLabel = (name: string) => ghSend("POST", `${issue}/labels`, t, { labels: [name] });

  try {
    if (action === "merge") {
      await ghSend("PUT", `${repoPath()}/pulls/${pr}/merge`, t, { merge_method: "squash" });
      await Promise.all([removeLabel(LABELS.changes), removeLabel(LABELS.rejected)]);
      await addLabel(LABELS.accepted);
      return NextResponse.json({ ok: true });
    }
    if (action === "reopen") {
      await ghSend("PATCH", `${repoPath()}/pulls/${pr}`, t, { state: "open" });
      await removeLabel(LABELS.rejected);
      return NextResponse.json({ ok: true });
    }

    if (action !== "accept" || body) {
      const head = HEAD[action];
      await ghSend("POST", `${issue}/comments`, t, { body: [head, body, MARK[action]].filter(Boolean).join("\n\n") });
    } else {
      await ghSend("POST", `${issue}/comments`, t, { body: `${HEAD.accept}\n\n${MARK.accept}` });
    }

    if (action === "changes") {
      await Promise.all([removeLabel(LABELS.accepted), removeLabel(LABELS.rejected)]);
      await addLabel(LABELS.changes);
    } else if (action === "accept") {
      await Promise.all([removeLabel(LABELS.changes), removeLabel(LABELS.rejected)]);
      await addLabel(LABELS.accepted);
    } else if (action === "reject") {
      await Promise.all([removeLabel(LABELS.changes), removeLabel(LABELS.accepted)]);
      await addLabel(LABELS.rejected);
      await ghSend("PATCH", `${repoPath()}/pulls/${pr}`, t, { state: "closed" });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof GitHubError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
