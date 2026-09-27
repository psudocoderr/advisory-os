import { AwsClient } from "aws4fetch";

/**
 * Chapter files in a private S3-compatible bucket (Cloudflare R2 today).
 *
 * The bucket is never public. Browsers upload with a short-lived presigned
 * PUT that the server signs for one key, one content type and one exact size,
 * and read files only through the auth-checked /api/files/[id] route.
 *
 * Provider-neutral: any S3-compatible endpoint works through configuration
 * alone. With the settings unset, storage is "not configured" and callers
 * answer 503 instead of crashing.
 */

export const UPLOAD_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf"
} as const;

export type UploadType = keyof typeof UPLOAD_TYPES;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_URL_TTL_SECONDS = 300;

export type StorageConfig = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const endpoint = env.STORAGE_ENDPOINT?.trim();
  const bucket = env.STORAGE_BUCKET?.trim();
  const accessKeyId = env.STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  // Middleware reads this on every page, so a bad value means "not
  // configured", never an exception. Credentials never travel in clear text.
  if (!URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKeyId, secretAccessKey };
}

/** The origin browsers upload to, for the CSP's connect-src. */
export function storageOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const config = storageConfig(env);
  return config ? new URL(config.endpoint).origin : null;
}

/** The server picks every key; nothing from the client reaches it. */
export function objectKey(chapterId: string, contentType: UploadType): string {
  return `chapters/${chapterId}/${crypto.randomUUID()}.${UPLOAD_TYPES[contentType]}`;
}

function client(config: StorageConfig) {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto"
  });
}

function objectUrl(config: StorageConfig, key: string) {
  // Path-style, so the bucket name needs no DNS of its own.
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * A presigned PUT for exactly this key, type and size. Content-Type and
 * Content-Length are both signed, so the bucket rejects any other file.
 */
export async function presignUpload(config: StorageConfig, key: string, contentType: UploadType, size: number) {
  const url = new URL(objectUrl(config, key));
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_TTL_SECONDS));
  const signed = await client(config).sign(url.toString(), {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(size) },
    aws: { signQuery: true, allHeaders: true }
  });
  return { url: signed.url, headers: { "Content-Type": contentType } };
}

export function fetchObject(config: StorageConfig, key: string) {
  return client(config).fetch(objectUrl(config, key), { method: "GET" });
}
