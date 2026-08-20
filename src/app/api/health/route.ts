import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.user.count();
    return NextResponse.json({ ok: true, database: "reachable" });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
