import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.user.count();
    return NextResponse.json({ ok: true, database: "reachable" });
  } catch (error) {
    // Logged, not returned: the server log needs the cause, the public
    // response must not carry it (flags S6).
    console.error("[health] database check failed:", error);
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
