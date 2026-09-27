import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./csp";
import { objectKey, presignUpload, storageConfig, storageOrigin, UPLOAD_URL_TTL_SECONDS } from "./storage";

const env = {
  STORAGE_ENDPOINT: "https://acct.r2.cloudflarestorage.com/",
  STORAGE_BUCKET: "content",
  STORAGE_ACCESS_KEY_ID: "AKID",
  STORAGE_SECRET_ACCESS_KEY: "secret"
};

describe("storageConfig", () => {
  it("is null unless every setting is present", () => {
    expect(storageConfig({})).toBeNull();
    expect(storageConfig({ ...env, STORAGE_BUCKET: " " })).toBeNull();
  });

  it("refuses a plain-http or malformed endpoint instead of throwing", () => {
    expect(storageConfig({ ...env, STORAGE_ENDPOINT: "http://acct.r2.cloudflarestorage.com" })).toBeNull();
    expect(storageConfig({ ...env, STORAGE_ENDPOINT: "not a url" })).toBeNull();
  });

  it("gives the bare origin for the CSP", () => {
    expect(storageOrigin(env)).toBe("https://acct.r2.cloudflarestorage.com");
    const csp = buildContentSecurityPolicy("n", { storageOrigin: storageOrigin(env) });
    expect(csp).toContain("connect-src 'self' https://acct.r2.cloudflarestorage.com;");
    expect(buildContentSecurityPolicy("n")).toContain("connect-src 'self';");
  });
});

describe("objectKey", () => {
  it("is server-chosen: chapter prefix, random name, extension from the type", () => {
    const key = objectKey("ch1", "image/jpeg");
    expect(key).toMatch(/^chapters\/ch1\/[0-9a-f-]{36}\.jpg$/);
    expect(objectKey("ch1", "image/jpeg")).not.toBe(key);
  });
});

describe("presignUpload", () => {
  it("signs a short-lived PUT bound to the content type and exact size", async () => {
    const { url, headers } = await presignUpload(storageConfig(env)!, "chapters/ch1/a.pdf", "application/pdf", 1234);
    const signed = new URL(url);
    expect(signed.origin + signed.pathname).toBe("https://acct.r2.cloudflarestorage.com/content/chapters/ch1/a.pdf");
    expect(signed.searchParams.get("X-Amz-Expires")).toBe(String(UPLOAD_URL_TTL_SECONDS));
    expect(signed.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(headers).toEqual({ "Content-Type": "application/pdf" });
  });
});
