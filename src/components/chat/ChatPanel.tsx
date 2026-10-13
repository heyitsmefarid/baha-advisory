import React, { useEffect, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePlatform } from "../../contexts/PlatformContext";
import { api, ApiError, errorMessage } from "../../lib/api";
import { Badge, Segmented, Spinner } from "../ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  fallbackReason?: string | null;
}

interface ChatReply {
  reply: string;
  provider: "groq" | "gemini" | "simulated";
  model: string;
  fallbackReason: string | null;
  groundedOn: number;
  quota: { usedDay: number; usedMonth: number; limitDay: number | null; limitMonth: number | null } | null;
}

const SUGGESTIONS = {
  en: ["Is it safe to drive to Bucayao now?", "Where is the nearest open evacuation center?", "What should I pack in a go-bag?", "Are there active flood alerts near Calapan?"],
  fil: ["Ligtas bang dumaan sa Bucayao ngayon?", "Saan ang pinakamalapit na bukas na evacuation center?", "Ano ang dapat laman ng go-bag?", "May aktibong babala ba sa baha sa Calapan?"],
};

function providerBadge(m: Msg) {
  if (m.provider === "simulated") return <Badge tone="neutral">Offline answer — verified records only</Badge>;
  if (m.provider === "groq") return <Badge tone="tide">Baha AI · Groq</Badge>;
  if (m.provider === "gemini") return <Badge tone="tide">Baha AI · Gemini</Badge>;
  return null;
}

/**
 * Baha AI chat. Grounded on Bahadvisory's verified records server-side;
 * works for guests (anonymous session for the free daily quota) and falls
 * back to a records-only answer when AI providers are unavailable.
 */
export default function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { currentUser, isAnonymous } = useAuth();
  const platform = usePlatform();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"auto" | "en" | "fil">("auto");
  const [shareLoc, setShareLoc] = useState(false);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<ChatReply["quota"]>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore recent history for registered users.
  useEffect(() => {
    if (!currentUser || isAnonymous || compact) return;
    getDocs(query(collection(db, "ai_chat_history", currentUser.uid, "messages"), orderBy("createdAt", "desc"), limit(12)))
      .then((snap) => {
        const rows = snap.docs.map((d) => ({ role: d.get("role"), content: d.get("content"), provider: d.get("provider") }) as Msg).reverse();
        if (rows.length) setMessages(rows);
      })
      .catch(() => undefined);
  }, [currentUser, isAnonymous, compact]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    if (!shareLoc || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lat: Math.round(p.coords.latitude * 1000) / 1000, lng: Math.round(p.coords.longitude * 1000) / 1000 }),
      () => setShareLoc(false),
      { timeout: 10_000, maximumAge: 120_000 }
    );
  }, [shareLoc]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      const res = await api<ChatReply>("/ai/chat", { body: { message: q, history, language: lang, location: shareLoc ? loc : null }, timeoutMs: 60_000 });
      setMessages((m) => [...m, { role: "assistant", content: res.reply, provider: res.provider, fallbackReason: res.fallbackReason }]);
      if (res.quota) setQuota(res.quota);
    } catch (err) {
      const msg = err instanceof ApiError && err.code === "ai_quota_exceeded" ? err.message : errorMessage(err);
      setError(msg);
      setMessages((m) => m.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
    }
  };

  if (!platform.aiEnabled || !platform.chatbotEnabled) {
    return (
      <div className="chat chat--off">
        <p>The AI assistant is switched off right now. Flood map, alerts, navigation and evacuation information are still available. In an emergency call 911.</p>
      </div>
    );
  }

  const suggestions = lang === "fil" ? SUGGESTIONS.fil : SUGGESTIONS.en;
  return (
    <div className={`chat ${compact ? "chat--compact" : ""}`}>
      <div className="chat__toolbar">
        <Segmented
          label="Answer language"
          value={lang}
          onChange={setLang}
          options={[
            { id: "auto", label: "Auto" },
            { id: "en", label: "English" },
            { id: "fil", label: "Filipino" },
          ]}
        />
        <label className="check-row tiny">
          <input type="checkbox" checked={shareLoc} onChange={(e) => setShareLoc(e.target.checked)} /> Use my approximate location
        </label>
      </div>

      <div className="chat__log" role="log" aria-live="polite" aria-label="Conversation with Baha AI">
        {messages.length === 0 && (
          <div className="chat__intro">
            <p>
              Ask about flooding, roads, evacuation or preparedness. Answers use DRRM-verified Bahadvisory records — Baha AI won't
              guess flood levels or road status.
            </p>
            <div className="chip-row">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip-btn" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat__msg chat__msg--${m.role}`}>
            {m.role === "assistant" && <div className="chat__meta">{providerBadge(m)}</div>}
            <div className="chat__bubble">{m.content}</div>
          </div>
        ))}
        {busy && (
          <div className="chat__msg chat__msg--assistant">
            <div className="chat__bubble chat__bubble--typing">
              <Spinner /> Checking verified records…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="field__error">{error}</p>}
      <form
        className="chat__input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={lang === "fil" ? "Magtanong tungkol sa baha…" : "Ask about floods, roads, evacuation…"}
          maxLength={1500}
          aria-label="Message"
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
      <p className="tiny chat__fine">
        AI can make mistakes. Official DRRM advisories take priority. Emergency: <a href="tel:911">911</a>.
        {quota && (
          <span className="mono">
            {" "}
            · {quota.limitDay != null ? `${quota.usedDay}/${quota.limitDay} today` : `${quota.usedMonth}/${quota.limitMonth} this month`}
          </span>
        )}
        {!currentUser || isAnonymous ? " Guest sessions get the free daily limit." : ""}
      </p>
    </div>
  );
}
