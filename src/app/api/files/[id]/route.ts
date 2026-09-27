import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadTrackProgress } from "@/lib/knowledge";
import { fetchObject, storageConfig } from "@/lib/storage";

/**
 * Streams a chapter file from the private bucket. A trainee gets it only when
 * they may open the chapter itself (published, active track, not locked);
 * admins get every file. Anything else is a 404, so ids can't be probed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = storageConfig();
  if (!config) return NextResponse.json({ error: "File storage is not configured" }, { status: 503 });

  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: { chapter: { select: { id: true, module: { select: { trackId: true } } } } }
  });
  if (!asset) return notFound;

  if (session.user.role !== "ADMIN") {
    const standing = await loadTrackProgress({ id: asset.chapter.module.trackId }, session.user);
    const state = standing?.progress
      .flatMap((module) => module.chapters)
      .find((chapter) => chapter.id === asset.chapter.id)?.state;
    if (!state || state === "locked") return notFound;
  }

  const upstream = await fetchObject(config, asset.key);
  if (!upstream.ok || !upstream.body) {
    // Never pass the bucket's error body through.
    return upstream.status === 404 ? notFound : NextResponse.json({ error: "File unavailable" }, { status: 502 });
  }

  const headers = new Headers({
    // From the upload allowlist, not from the bucket.
    "Content-Type": asset.contentType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff"
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
}
