import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";

/**
 * Renders a report photo from Cloudinary (URL) or the inline fallback
 * (report_media/{id}, readable under the same rules as the report).
 */
export default function ReportPhoto({
  reportId,
  photoUrl,
  storage,
  alt,
  className = "report-photo",
}: {
  reportId: string;
  photoUrl?: string | null;
  storage?: "cloudinary" | "inline" | null;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(storage === "cloudinary" ? photoUrl ?? null : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (storage !== "inline") return;
    let cancelled = false;
    getDoc(doc(db, "report_media", reportId))
      .then((snap) => {
        if (!cancelled) setSrc((snap.get("dataUrl") as string) ?? null);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [reportId, storage]);

  if (!photoUrl) return null;
  if (failed) return <div className={`${className} report-photo--missing`}>Photo unavailable</div>;
  if (!src) return <div className={`${className} report-photo--loading`} aria-label="Loading photo" />;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}
