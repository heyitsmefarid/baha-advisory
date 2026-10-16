import { useEffect, useState } from "react";
import { flushDrafts, listDrafts, onDraftsChanged, type ReportDraft } from "../services/reportQueue";
import { useToast } from "../components/ui";

/** Live list of offline report drafts. */
export function useDrafts(): ReportDraft[] {
  const [drafts, setDrafts] = useState<ReportDraft[]>([]);
  useEffect(() => {
    const load = () => listDrafts().then(setDrafts);
    load();
    return onDraftsChanged(load);
  }, []);
  return drafts;
}

/**
 * Sends queued offline reports when connectivity returns (and every
 * minute while drafts remain). Mounted once at the app root.
 */
export function useDraftSync() {
  const toast = useToast();
  useEffect(() => {
    let busy = false;
    const sync = async () => {
      if (busy || !navigator.onLine) return;
      busy = true;
      try {
        const { sent, failed } = await flushDrafts();
        if (sent) toast(`${sent} saved flood report${sent > 1 ? "s were" : " was"} sent.`, "safe");
        if (failed) toast(`${failed} saved report${failed > 1 ? "s" : ""} couldn't be sent — open Report to review.`, "caution");
      } finally {
        busy = false;
      }
    };
    sync();
    window.addEventListener("online", sync);
    const t = setInterval(sync, 60_000);
    return () => {
      window.removeEventListener("online", sync);
      clearInterval(t);
    };
  }, [toast]);
}
