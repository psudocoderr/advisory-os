import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));

const { authOptions, scopedUserFilter } = await import("./auth");

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

/**
 * S1/S2: the JWT outlives the account state it was issued for. The jwt
 * callback re-reads the account on every session read, so a deactivated user
 * is signed out and a changed role applies on their next request.
 */
describe("jwt callback on an existing session", () => {
  const refresh = (token: object) =>
    authOptions.callbacks!.jwt!({ token: { id: "user-1", role: "ADMIN", ...token } } as never);

  beforeEach(() => findUnique.mockReset());

  it("keeps an active account and picks up its current role", async () => {
    findUnique.mockResolvedValue({ isActive: true, role: "ADVISOR" });
    await expect(refresh({})).resolves.toMatchObject({ id: "user-1", role: "ADVISOR" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
  });

  it("revokes a deactivated account", async () => {
    findUnique.mockResolvedValue({ isActive: false, role: "ADMIN" });
    await expect(refresh({})).rejects.toThrow(/revoked/);
  });

  it("revokes a deleted account", async () => {
    findUnique.mockResolvedValue(null);
    await expect(refresh({})).rejects.toThrow(/revoked/);
  });

  it("revokes a token with no user id without querying", async () => {
    await expect(refresh({ id: undefined })).rejects.toThrow(/revoked/);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("reads the account at sign-in too, so a temporary password is flagged from the first request", async () => {
    findUnique.mockResolvedValue({ role: "ADMIN", isActive: true, passwordChangedAt: null });
    const token = await authOptions.callbacks!.jwt!({
      token: {},
      user: { id: "user-2", role: "ADMIN" }
    } as never);
    expect(token).toMatchObject({ id: "user-2", role: "ADMIN", mustChangePassword: true });
    expect(token.signedInAt).toEqual(expect.any(Number));
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
