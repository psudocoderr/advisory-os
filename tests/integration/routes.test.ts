/**
 * The non-certify API routes on a real database: uploads, files, the admin
 * CSV report and the health check. Storage's network calls are mocked; with
 * fake STORAGE_* values even an unmocked call could only fail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as upload } from "@/app/api/uploads/route";
import { GET as file } from "@/app/api/files/[id]/route";
import { GET as report } from "@/app/api/reports/[userId]/route";
import { GET as health } from "@/app/api/health/route";
import { fetchObject, MAX_UPLOAD_BYTES } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { createTopic, createUser, post, signIn } from "./fixtures";

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  fetchObject: vi.fn()
}));
const fetchMock = vi.mocked(fetchObject);

const FAKE_STORAGE = {
  STORAGE_ENDPOINT: "https://storage.invalid",
  STORAGE_BUCKET: "bucket",
  STORAGE_ACCESS_KEY_ID: "fake-key-id",
  STORAGE_SECRET_ACCESS_KEY: "fake-secret"
};
const withStorage = () => Object.assign(process.env, FAKE_STORAGE);

afterEach(() => {
  for (const name of Object.keys(FAKE_STORAGE)) delete process.env[name];
  fetchMock.mockReset();
});

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

describe("POST /api/uploads", () => {
  const body = (chapterId: string, over: Record<string, unknown> = {}) => ({
    chapterId,
    filename: "Guide.pdf",
    contentType: "application/pdf",
    size: 1024,
    ...over
  });

  it("is for admins only", async () => {
    const topic = await createTopic({ size: 0 });
    withStorage();
    expect((await post(upload, body(topic.chapterId))).status).toBe(401);
    signIn(await createUser());
    expect((await post(upload, body(topic.chapterId))).status).toBe(403);
    expect(await prisma.asset.count()).toBe(0);
  });

  it("answers 503 when storage is not configured", async () => {
    const topic = await createTopic({ size: 0 });
    signIn(await createUser("ADMIN"));
    expect((await post(upload, body(topic.chapterId))).status).toBe(503);
  });

  it.each([
    ["an HTML file", { contentType: "text/html", filename: "x.html" }],
    ["an SVG", { contentType: "image/svg+xml", filename: "x.svg" }],
    ["a file over the limit", { size: MAX_UPLOAD_BYTES + 1 }],
    ["a control character in the name", { filename: "bad\u0000name.pdf" }],
    ["an empty name", { filename: "  " }]
  ])("refuses %s", async (_name, over) => {
    const topic = await createTopic({ size: 0 });
    withStorage();
    signIn(await createUser("ADMIN"));
    expect((await post(upload, body(topic.chapterId, over))).status).toBe(400);
    expect(await prisma.asset.count()).toBe(0);
  });

  it("answers 404 for an unknown chapter", async () => {
    withStorage();
    signIn(await createUser("ADMIN"));
    expect((await post(upload, body("no-such-chapter"))).status).toBe(404);
  });

  it("picks the object key itself and signs the exact type and size", async () => {
    const topic = await createTopic({ size: 0 });
    withStorage();
    signIn(await createUser("ADMIN"));
    const result = await post(upload, body(topic.chapterId, { filename: "../../etc/passwd.pdf" }));
    expect(result.status).toBe(200);

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: result.body.assetId } });
    expect(asset.key).toMatch(new RegExp(`^chapters/${topic.chapterId}/[0-9a-f-]{36}\\.pdf$`));
    expect(asset.filename).toBe("../../etc/passwd.pdf"); // kept only as the download name
    expect(result.body.fileUrl).toBe(`/api/files/${asset.id}`);

    const signed = new URL(result.body.upload.url);
    expect(signed.origin).toBe(FAKE_STORAGE.STORAGE_ENDPOINT);
    expect(signed.pathname).toBe(`/bucket/${asset.key}`);
    expect(signed.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(signed.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(JSON.stringify(result.body)).not.toContain(FAKE_STORAGE.STORAGE_SECRET_ACCESS_KEY);
    expect(await prisma.auditLog.count({ where: { entity: "Asset", entityId: asset.id } })).toBe(1);
  });
});

describe("GET /api/files/[id]", () => {
  /** A topic whose first chapter carries a file, plus a second chapter with one. */
  async function filesInTopic() {
    const topic = await createTopic({ size: 0 });
    const admin = await createUser("ADMIN");
    const second = await prisma.chapter.create({
      data: { topicId: topic.topicId, slug: "second", title: "Second", order: 2, isPublished: true }
    });
    const asset = (chapterId: string, filename: string) =>
      prisma.asset.create({
        data: {
          chapterId,
          key: `chapters/${chapterId}/k.pdf`,
          filename,
          contentType: "application/pdf",
          size: 3,
          uploadedById: admin.id
        }
      });
    return {
      admin,
      open: await asset(topic.chapterId, "Notes ü.pdf"),
      locked: await asset(second.id, "Later.pdf")
    };
  }

  const upstream = (status: number, text = "%PDF", type = "text/html") =>
    fetchMock.mockResolvedValue(
      new Response(status === 200 ? text : "<Error>bucket secret detail</Error>", {
        status,
        headers: { "content-type": type }
      })
    );

  it("refuses anyone signed out, and answers 503 without storage", async () => {
    const { open, admin } = await filesInTopic();
    expect((await file(new Request("http://t"), params({ id: open.id }))).status).toBe(401);
    signIn(admin);
    expect((await file(new Request("http://t"), params({ id: open.id }))).status).toBe(503);
  });

  it("serves an open chapter's file with fixed, safe headers", async () => {
    const { open } = await filesInTopic();
    withStorage();
    upstream(200);
    signIn(await createUser());
    const response = await file(new Request("http://t"), params({ id: open.id }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("%PDF");
    // The upload allowlist decides the type, not what the bucket says.
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("content-disposition")).toBe(`inline; filename*=UTF-8''Notes%20%C3%BC.pdf`);
  });

  it("answers 404 for a locked chapter's file and for an unknown id, without touching storage", async () => {
    const { locked } = await filesInTopic();
    withStorage();
    signIn(await createUser());
    expect((await file(new Request("http://t"), params({ id: locked.id }))).status).toBe(404);
    expect((await file(new Request("http://t"), params({ id: "no-such-file" }))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets an admin open any file", async () => {
    const { locked, admin } = await filesInTopic();
    withStorage();
    upstream(200);
    signIn(admin);
    expect((await file(new Request("http://t"), params({ id: locked.id }))).status).toBe(200);
  });

  it("never passes the bucket's error body through", async () => {
    const { open, admin } = await filesInTopic();
    withStorage();
    signIn(admin);
    upstream(404);
    expect((await file(new Request("http://t"), params({ id: open.id }))).status).toBe(404);
    upstream(500);
    const failed = await file(new Request("http://t"), params({ id: open.id }));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("bucket secret");
  });
});

describe("GET /api/reports/[userId]", () => {
  it("is for admins only, and 404s an unknown trainee", async () => {
    const trainee = await createUser();
    const call = (userId: string) => report(new Request("http://t"), params({ userId }));
    expect((await call(trainee.id)).status).toBe(401);
    signIn(trainee);
    expect((await call(trainee.id)).status).toBe(403);
    signIn(await createUser("ADMIN"));
    expect((await call("no-such-user")).status).toBe(404);
  });

  it("downloads the attempts as CSV with formula-looking text neutralised", async () => {
    const topic = await createTopic({ size: 0 });
    await prisma.topic.update({ where: { id: topic.topicId }, data: { title: '=HYPERLINK("x")' } });
    const trainee = await createUser();
    await prisma.testSession.create({
      data: { userId: trainee.id, trackId: topic.trackId, topicId: topic.topicId, status: "ABANDONED" }
    });
    signIn(await createUser("ADMIN"));
    const response = await report(new Request("http://t"), params({ userId: trainee.id }));
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="User-\d+-tests\.csv"$/);
    const [header, row] = (await response.text()).trim().split("\r\n");
    expect(header).toBe("Test,Attempt,Date,Status,Level,Theta,SE,Percent correct,Questions");
    expect(row).toMatch(/^"'=HYPERLINK\(""x""\)",1,\d{4}-\d\d-\d\d,ABANDONED,,,,,0$/);
  });
});

describe("GET /api/health", () => {
  it("reports the database reachable, or 503 without detail when it is not", async () => {
    expect(await (await health()).json()).toEqual({ ok: true, database: "reachable" });
    vi.spyOn(prisma.user, "count").mockRejectedValueOnce(new Error("connection refused at 10.0.0.1"));
    const down = await health();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false, database: "unreachable" });
  });
});
