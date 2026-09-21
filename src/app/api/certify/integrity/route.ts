import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Records that the candidate left the exam surface.
 *
 * This is a record, not a control. No browser API prevents a screenshot, a
 * phone camera, a second device or a screen recorder, and fullscreen can
 * always be exited -- browsers guarantee that deliberately. So this does not
 * pretend to stop anything. It makes what happened visible to a reviewer.
 */
const schema = z.object({
  sessionId: z.string(),
  kind: z.enum(["FULLSCREEN_EXIT", "FULLSCREEN_ENTER", "TAB_HIDDEN", "WINDOW_BLUR", "COPY", "PASTE", "CONTEXT_MENU"])
});

/**
 * Events are client-driven, so the volume is client-controlled. Cap it: a page
 * holding a key down could otherwise write unbounded rows. Past the cap the
 * behaviour is already established and more rows add nothing.
 */
const MAX_EVENTS_PER_SESSION = 200;

export async function POST(request: Request) {
  const auth = await getServerSession(authOptions);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid event" }, { status: 400 });

  const testSession = await prisma.testSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { id: true, userId: true, status: true }
  });
  if (!testSession || testSession.userId !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (testSession.status !== "IN_PROGRESS") {
    // Not worth surfacing as an error: a blur event can land just after the
    // test closes. Accept it quietly and record nothing.
    return NextResponse.json({ recorded: false, strikes: 0 });
  }

  const existing = await prisma.integrityEvent.count({ where: { sessionId: testSession.id } });
  if (existing >= MAX_EVENTS_PER_SESSION) {
    return NextResponse.json({ recorded: false, strikes: existing, capped: true });
  }

  await prisma.integrityEvent.create({
    data: { sessionId: testSession.id, kind: parsed.data.kind }
  });

  // Re-entering fullscreen is kept for the timeline but is not a strike.
  const strikes = await prisma.integrityEvent.count({
    where: { sessionId: testSession.id, kind: { not: "FULLSCREEN_ENTER" } }
  });

  return NextResponse.json({ recorded: true, strikes });
}
