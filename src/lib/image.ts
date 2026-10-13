/**
 * Resizes and re-encodes a photo on the device before upload:
 *  - keeps uploads small on congested disaster-time networks,
 *  - re-encoding through a canvas strips EXIF metadata (including the
 *    phone's GPS tag) — location is only shared through the explicit
 *    location field the reporter controls.
 */
export interface CompressedImage {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function compressImage(file: File, maxDim = 1280, targetBytes = 600 * 1024): Promise<CompressedImage> {
  if (file.type && !ACCEPTED.includes(file.type)) throw new Error("Please choose a photo (JPEG, PNG or WebP).");
  if (file.size > 25 * 1024 * 1024) throw new Error("That photo is too large. Please choose one under 25 MB.");
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("This photo format isn't supported on your device. Try a JPEG."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  let dim = maxDim;
  let quality = 0.78;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, dim / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the photo on this device.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const bytes = Math.round((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
    if (bytes <= targetBytes || attempt === 5) {
      if ("close" in bitmap) bitmap.close();
      return { dataUrl, bytes, width: w, height: h };
    }
    quality = Math.max(0.5, quality - 0.1);
    dim = Math.round(dim * 0.82);
  }
  throw new Error("Couldn't compress the photo.");
}
