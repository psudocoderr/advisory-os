import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_UPLOAD_BYTES, objectKey, presignUpload, storageConfig, UPLOAD_TYPES, type UploadType } from "@/lib/storage";

const schema = z.object({
  chapterId: z.string().min(1),
  // Shown back as the download name only; never part of the object key.
  filename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "Invalid filename"),
  contentType: z.enum(Object.keys(UPLOAD_TYPES) as [UploadType, ...UploadType[]]),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES)
});

/**
 * Admin only: records an asset and returns a presigned PUT for it. The file
 * goes straight from the browser to the bucket, so it never passes through
 * this function's body-size limit.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const config = storageConfig();
  if (!config) return NextResponse.json({ error: "File storage is not configured" }, { status: 503 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Upload a PNG, JPEG, WebP or PDF of at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` },
      { status: 400 }
    );
  }
  const { chapterId, filename, contentType, size } = parsed.data;

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { id: true } });
  if (!chapter) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });

  const key = objectKey(chapter.id, contentType);
  // ponytail: the row exists before the upload finishes, so an abandoned upload
  // leaves a row whose file 404s. Add a confirm step if orphans ever matter.
  const asset = await prisma.asset.create({
    data: { chapterId: chapter.id, key, filename, contentType, size, uploadedById: session.user.id }
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: "CREATE",
      entity: "Asset",
      entityId: asset.id,
      summary: `Uploaded ${contentType} (${size} bytes) to chapter ${chapter.id}`
    }
  });

  const upload = await presignUpload(config, key, contentType, size);
  return NextResponse.json({ assetId: asset.id, fileUrl: `/api/files/${asset.id}`, upload });
}
