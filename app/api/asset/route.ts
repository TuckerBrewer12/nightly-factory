import { NextResponse, type NextRequest } from "next/server";
import { factory } from "@/factory.config";
import { repoPath } from "@/lib/github";
import { localArtifacts } from "@/lib/local-artifacts";
import { getViewer } from "@/lib/session";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

// Screenshots live on the artifacts branch; this serves them to signed-in viewers.
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse("Sign in first", { status: 401 });

  const path = req.nextUrl.searchParams.get("path") ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!path.startsWith("runs/") || path.includes("..") || !TYPES[ext]) return new NextResponse("Bad path", { status: 400 });

  const local = await localArtifacts();
  if (local) {
    const buf = await local.file(path);
    return buf ? new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": TYPES[ext] } }) : new NextResponse("Not found", { status: 404 });
  }

  const token = process.env.GITHUB_TOKEN || viewer.token;
  const res = await fetch(`https://api.github.com${repoPath()}/contents/${path}?ref=${factory.artifactsBranch}`, {
    headers: {
      Accept: "application/vnd.github.raw",
      "User-Agent": "nightly-factory",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: { "Content-Type": TYPES[ext], "Cache-Control": "private, max-age=86400, immutable" },
  });
}
