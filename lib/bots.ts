// The repo's own review bots (.github/review-bots): each posts one PR review whose
// body starts "### <bot name>", with its findings as inline comments on that review.
// The coverage bot posts an issue comment carrying <!-- frontend-coverage-bot -->.

export type BotReport = {
  name: string;
  state: "clean" | "findings" | "comment";
  findings: number;
  answered: number;
  summary: string;
  url: string;
  at: string;
};

type User = { login: string; type: string };
type Review = { id: number; body: string | null; user: User; submitted_at: string; html_url: string };
type Inline = { id: number; body: string; user: User; pull_request_review_id: number | null; in_reply_to_id?: number; html_url: string };
type Comment = { body: string; user: User; created_at: string; html_url: string };

const isBot = (u: User) => u.type === "Bot" || u.login.endsWith("[bot]");

const firstLine = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean);

export function botReports(reviews: Review[], inline: Inline[], comments: Comment[]): BotReport[] {
  const latest = new Map<string, BotReport>();

  for (const r of reviews) {
    if (!isBot(r.user) || !r.body) continue;
    const m = /^###\s+(.+)$/m.exec(r.body);
    if (!m) continue;
    const name = m[1].trim();
    const mine = inline.filter((c) => c.pull_request_review_id === r.id && !c.in_reply_to_id);
    const answered = mine.filter((c) => inline.some((x) => x.in_reply_to_id === c.id && !isBot(x.user))).length;
    const clean = r.body.includes("✅") && mine.length === 0;
    const lines = firstLine(r.body).filter((l) => l !== name);
    const report: BotReport = {
      name,
      state: clean ? "clean" : mine.length ? "findings" : "comment",
      findings: mine.length,
      answered,
      summary: lines[0] ?? "",
      url: r.html_url,
      at: r.submitted_at,
    };
    const prev = latest.get(name);
    if (!prev || prev.at < report.at) latest.set(name, report);
  }

  for (const c of comments) {
    if (!isBot(c.user) || !c.body.includes("<!-- frontend-coverage-bot -->")) continue;
    const lines = firstLine(c.body);
    latest.set("Coverage", {
      name: "Coverage",
      state: "comment",
      findings: 0,
      answered: 0,
      summary: lines.find((l) => /%/.test(l)) ?? lines[0] ?? "",
      url: c.html_url,
      at: c.created_at,
    });
  }

  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}
