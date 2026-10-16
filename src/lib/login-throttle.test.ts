import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { clientIp, isThrottled, throttleKeys } = await import("./login-throttle");
const { LOGIN_LIMITS } = await import("./login-limits");

describe("isThrottled", () => {
  it("allows attempts under both limits", () => {
    expect(isThrottled({ email: LOGIN_LIMITS.perEmail - 1, ip: LOGIN_LIMITS.perIp - 1 })).toBe(false);
  });

  it("blocks once either limit is reached", () => {
    expect(isThrottled({ email: LOGIN_LIMITS.perEmail, ip: 0 })).toBe(true);
    expect(isThrottled({ email: 0, ip: LOGIN_LIMITS.perIp })).toBe(true);
  });
});

describe("throttleKeys", () => {
  it("never stores the email or IP itself", () => {
    const keys = throttleKeys("advisor@example.com", "203.0.113.7");
    expect(keys.email).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.ip).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(keys)).not.toContain("advisor");
    expect(JSON.stringify(keys)).not.toContain("203.0.113");
  });

  it("keeps an email and an IP with the same text apart", () => {
    const keys = throttleKeys("same", "same");
    expect(keys.email).not.toBe(keys.ip);
  });

  it("has no IP key when the address is unknown", () => {
    expect(throttleKeys("a@b.co", null).ip).toBeNull();
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIp({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).toBe("203.0.113.7");
    expect(clientIp({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })).toBe("198.51.100.1");
  });

  it("returns null without either header", () => {
    expect(clientIp({})).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});
