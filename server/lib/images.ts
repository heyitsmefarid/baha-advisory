import { HttpError } from "./http";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export interface DecodedImage {
  mime: ImageMime;
  bytes: Buffer;
  base64: string;
}

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Accepts only real JPEG/PNG/WebP images (checked by magic bytes, not the
 * declared type) under the size cap. Rejects SVG/HTML/anything else, so an
 * uploaded "image" can never be active content.
 */
export function decodeImageDataUrl(dataUrl: unknown, maxBytes = MAX_IMAGE_BYTES): DecodedImage {
  if (typeof dataUrl !== "string") throw new HttpError(400, "Photo must be sent as a data URL.", "invalid_image");
  const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw new HttpError(400, "Only JPEG, PNG or WebP photos are accepted.", "invalid_image");
  const base64 = m[2].replace(/\s/g, "");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) throw new HttpError(400, "The photo is empty.", "invalid_image");
  if (bytes.length > maxBytes) throw new HttpError(413, `Photo is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`, "image_too_large");
  const mime = sniff(bytes);
  if (!mime) throw new HttpError(400, "The file is not a valid JPEG, PNG or WebP image.", "invalid_image");
  return { mime, bytes, base64 };
}

export function sniff(b: Buffer): ImageMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a) return "image/png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
