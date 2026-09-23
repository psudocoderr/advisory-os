import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./csp";

function directive(policy: string, name: string) {
  return policy.split("; ").find((part) => part.startsWith(`${name} `) || part === name);
}

describe("buildContentSecurityPolicy", () => {
  it("allows scripts only with the request's nonce", () => {
    const script = directive(buildContentSecurityPolicy("abc123"), "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development", () => {
    expect(directive(buildContentSecurityPolicy("n", { dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("refuses framing, plugins and foreign form targets", () => {
    const policy = buildContentSecurityPolicy("n");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
  });

  it("upgrades insecure requests in production but not in development", () => {
    expect(directive(buildContentSecurityPolicy("n"), "upgrade-insecure-requests")).toBeDefined();
    expect(directive(buildContentSecurityPolicy("n", { dev: true }), "upgrade-insecure-requests")).toBeUndefined();
  });
});
