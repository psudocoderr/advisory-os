/**
 * Dashboard follow-ups (flags O18) on a real database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadFollowUps } from "@/lib/follow-ups";
import { prisma } from "@/lib/prisma";
import { createClientFor, createProspectFor, createUser, type TestUser } from "./fixtures";

// 11:30 IST on 19 October 2026.
const NOW = new Date("2026-10-19T06:00:00Z");
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`); // how a form date is stored

let a: TestUser;
let b: TestUser;
let admin: TestUser;
beforeEach(async () => {
  [a, b, admin] = [await createUser(), await createUser(), await createUser("ADMIN")];
});

const meeting = (
  owner: TestUser,
  party: { prospectId?: string; clientId?: string },
  meetingDate: string,
  followUp?: string
) =>
  prisma.meetingLog.create({
    data: {
      kind: party.prospectId ? "PROSPECT" : "CLIENT",
      summary: "Call",
      notes: "",
      ownerId: owner.id,
      meetingDate: day(meetingDate),
      followUpDate: followUp ? day(followUp) : null,
      ...party
    }
  });

const forAdvisor = (user: TestUser) => loadFollowUps({ assignedToId: user.id }, NOW);

describe("loadFollowUps", () => {
  it("shows overdue and today's follow-ups, marked, soonest first", async () => {
    const [p1, p2, c1] = [await createProspectFor(a), await createProspectFor(a), await createClientFor(a)];
    await meeting(a, { prospectId: p1.id }, "2026-10-10", "2026-10-25");
    await meeting(a, { prospectId: p2.id }, "2026-10-10", "2026-10-19");
    await meeting(a, { clientId: c1.id }, "2026-10-10", "2026-10-15");
    const items = await forAdvisor(a);
    expect(items.map((item) => [item.kind, item.when, item.date.toISOString().slice(0, 10)])).toEqual([
      ["client", "overdue", "2026-10-15"],
      ["prospect", "today", "2026-10-19"],
      ["prospect", "upcoming", "2026-10-25"]
    ]);
    expect(items[0].href).toBe(`/clients?q=${encodeURIComponent(c1.name)}`);
  });

  it("includes a prospect's own follow-up date until a meeting with them is logged", async () => {
    const prospect = await createProspectFor(a);
    await prisma.prospect.update({ where: { id: prospect.id }, data: { followUpDate: day("2026-10-20") } });
    expect((await forAdvisor(a)).map((item) => item.key)).toEqual([`prospect:${prospect.id}`]);

    await meeting(a, { prospectId: prospect.id }, "2026-10-18");
    expect(await forAdvisor(a)).toEqual([]);
  });

  it("lets the latest meeting decide: a newer meeting replaces or closes the follow-up", async () => {
    const [kept, closed] = [await createClientFor(a), await createClientFor(a)];
    await meeting(a, { clientId: kept.id }, "2026-10-01", "2026-10-05");
    await meeting(a, { clientId: kept.id }, "2026-10-12", "2026-10-30");
    await meeting(a, { clientId: closed.id }, "2026-10-01", "2026-10-05");
    await meeting(a, { clientId: closed.id }, "2026-10-12");
    const items = await forAdvisor(a);
    expect(items.map((item) => [item.key, item.date.toISOString().slice(0, 10)])).toEqual([
      [`client:${kept.id}`, "2026-10-30"]
    ]);
  });

  it("leaves out onboarded and dropped prospects", async () => {
    const [onboarded, dropped] = [await createProspectFor(a), await createProspectFor(a)];
    await prisma.prospect.update({ where: { id: onboarded.id }, data: { stage: "ONBOARDED" } });
    await prisma.prospect.update({
      where: { id: dropped.id },
      data: { stage: "DROPPED", followUpDate: day("2026-10-20") }
    });
    await meeting(a, { prospectId: onboarded.id }, "2026-10-10", "2026-10-20");
    expect(await forAdvisor(a)).toEqual([]);
  });

  it("belongs to the record's advisor, whoever logged the meeting; an admin sees everyone's", async () => {
    const prospect = await createProspectFor(a);
    await meeting(admin, { prospectId: prospect.id }, "2026-10-10", "2026-10-22");
    expect(await forAdvisor(a)).toHaveLength(1);
    expect(await forAdvisor(b)).toEqual([]);
    expect(await loadFollowUps({}, NOW)).toHaveLength(1);
  });
});
