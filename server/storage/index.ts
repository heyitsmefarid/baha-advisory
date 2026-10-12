import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { env } from "../lib/env";
import { getDb } from "../lib/firebaseAdmin";
import type { DecodedImage } from "../lib/images";
import type { GeographicReference } from "../../shared/geography";

/**
 * Image storage adapter.
 *  - Cloudinary (free tier, signed server-side upload) when configured.
 *    Firebase Storage needs the Blaze plan for new projects, so it is not
 *    used by default.
 *  - Inline fallback: the (already client-compressed) image is kept in
 *    report_media/{id} — suitable for demos, capped at ~700 KB.
 */
export type StoredImage = { url: string; storage: "cloudinary" | "inline" };

export const INLINE_MAX_BYTES = 700 * 1024;

export function cloudinaryConfigured(): boolean {
  return Boolean(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET"));
}

/** Cloudinary signature: SHA-1 of sorted params + API secret. */
export function cloudinarySignature(params: Record<string, string | number>, secret: string): string {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== "" && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + secret).digest("hex");
}

async function uploadToCloudinary(publicId: string, folder: string, image: DecodedImage): Promise<string> {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: `${env("CLOUDINARY_FOLDER", "bahadvisory")}/${folder}`, public_id: publicId, timestamp, overwrite: "false" };
  const signature = cloudinarySignature(params, env("CLOUDINARY_API_SECRET"));
  const form = new FormData();
  form.set("file", `data:${image.mime};base64,${image.base64}`);
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  form.set("api_key", env("CLOUDINARY_API_KEY"));
  form.set("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: form });
  const data = (await res.json()) as { secure_url?: string; error?: { message: string } };
  if (!res.ok || !data.secure_url) throw new Error(`Cloudinary upload failed: ${data.error?.message ?? res.status}`);
  return data.secure_url;
}

export async function storeReportImage(
  reportId: string,
  image: DecodedImage,
  meta: { reporterUid: string } & GeographicReference
): Promise<StoredImage> {
  if (cloudinaryConfigured()) {
    try {
      return { url: await uploadToCloudinary(reportId, "reports", image), storage: "cloudinary" };
    } catch (err) {
      console.error("[storage] Cloudinary failed, using inline fallback", err);
    }
  }
  if (image.bytes.length > INLINE_MAX_BYTES) {
    throw new Error("Photo too large for inline storage — configure Cloudinary or compress further.");
  }
  await getDb()
    .doc(`report_media/${reportId}`)
    .set({
      dataUrl: `data:${image.mime};base64,${image.base64}`,
      bytes: image.bytes.length,
      reporterUid: meta.reporterUid,
      regionPsgcCode: meta.regionPsgcCode,
      provincePsgcCode: meta.provincePsgcCode,
      municipalityPsgcCode: meta.municipalityPsgcCode,
      barangayPsgcCode: meta.barangayPsgcCode,
      locationAssignment: meta.locationAssignment,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  return { url: `inline:report_media/${reportId}`, storage: "inline" };
}
