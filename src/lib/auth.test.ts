import { describe, expect, it } from "vitest";
import { scopedUserFilter } from "./auth";

/**
 * scopedUserFilter is the whole of row-level authorisation in this app: it is
 * spread into Prisma `where` clauses so an advisor sees only records assigned
 * to them. A regression here leaks one advisor's clients — including PAN and
 * AUM — to another, silently and with no error.
 */

const session = (role: "ADMIN" | "ADVISOR", id = "user-1") => ({
  user: { id, role }
});

describe("scopedUserFilter", () => {
  it("restricts an advisor to their own assigned records", () => {
    expect(scopedUserFilter(session("ADVISOR", "advisor-7"))).toEqual({
      assignedToId: "advisor-7"
    });
  });

  it("does not restrict an admin", () => {
    // Deliberate: admins have team-wide visibility. The acceptable-use policy
    // has to say so, because the code will not stop them.
    expect(scopedUserFilter(session("ADMIN"))).toEqual({});
  });

  it("scopes to the session's own id and not a fixed value", () => {
    const a = scopedUserFilter(session("ADVISOR", "advisor-a"));
    const b = scopedUserFilter(session("ADVISOR", "advisor-b"));
    expect(a).not.toEqual(b);
  });

  it("never returns an empty filter for a non-admin role", () => {
    // An empty object spread into a Prisma `where` is an unscoped query. For
    // any role that is not ADMIN this must never happen.
    const filter = scopedUserFilter(session("ADVISOR"));
    expect(Object.keys(filter).length).toBeGreaterThan(0);
  });
});
