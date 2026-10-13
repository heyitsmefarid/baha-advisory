# AI integration

All AI runs on the backend. The Groq and Gemini keys are server-side
environment variables and are never sent to the browser. Every core flood
feature works with AI switched off or unavailable.

## Providers and tasks

| Task | Endpoint | Primary | Fallbacks |
|---|---|---|---|
| Baha AI chatbot (English / Filipino) | `POST /api/ai/chat` | Groq `GROQ_MODEL` | Groq `GROQ_FALLBACK_MODEL` → Gemini text → template |
| Advisory draft | `POST /api/ai/advisory-draft` | Groq | same |
| Incident summary | `POST /api/ai/incident-summary` | Groq | same |
| Route explanation | `POST /api/ai/explain-route` | Groq | same (cached) |
| Flood photo analysis | inside `POST /api/reports` | Gemini `GEMINI_MODEL` | Gemini `GEMINI_FALLBACK_MODEL` → "not analyzed" |

Default models are set in `.env.example`:

| Provider | Primary | Fallback |
|---|---|---|
| Groq | `llama-3.3-70b-versatile` | `llama-3.1-8b-instant` |
| Gemini | `gemini-3.8-flash` | `gemini-3.5-flash-lite` |

Model IDs and free-tier limits change, so check Groq's console and Google AI
Studio for the current values before a demo. Providers are called over
plain HTTPS from `server/ai/providers.ts`; no SDK is needed.

## Safety rules

- **Verified records are the only source of truth.** The chatbot and drafts
  are grounded on verified zones, roads, centers and alerts loaded by
  `server/ai/context.ts`. When those records say nothing, the AI must say it
  doesn't know.
- **AI never decides routes or road conditions.** The route explainer
  receives the routing engine's computed result and only rewrites it.
- **Photo analysis is a suggestion for moderators.** The UI states: "AI
  suggestion only. A photo cannot determine actual water depth." Only DRRM
  verification changes the map.
- **User-written text is treated as data, not instructions.** That includes
  report descriptions and chat messages (`server/ai/prompts.ts`).
- **Every response carries `provider` and `model`.** Template output is
  labelled as such in the UI.

## Quotas

Quotas are counted in Firestore transactions (`server/ai/quota.ts`), in
`ai_usage_records/{user_<uid>_<period>}` or `{org_<orgId>_<period>}`.
Periods are a day or a month in Manila time.

| Who | Quota |
|---|---|
| Citizens, guests, staff of unpaid orgs | Citizen Free: 10 chats and 3 photo analyses per day, per person |
| Members of an org with an active paid plan | The org's plan quota, shared by all members (for example LGU Pro: 500 chats and 500 photos per month) |
| Super Admin | Enterprise fair-use limits, never unlimited |

- **The Super Admin edits limits** in `/super/plans`.
- **Failed calls cost nothing.** If every provider fails, the reserved quota
  is refunded and the deterministic fallback is used.
- **Reports are never blocked by quota.** Over quota, a report is accepted
  as "not analyzed".
- **Burst limit:** there is also a per-user limit, by default 8 AI calls per
  minute, set in `/super/ai`.

## Caching and cost tracking

- **Caching.** Route explanations, which are deterministic inputs that repeat
  often, are cached in `ai_cache`. The default TTL is 6 hours, configurable.
  Chat is never cached because it is personal.
- **Usage log.** Every call is logged in `ai_usage_log`: task, provider,
  model, token counts, latency, status (`ok`, `fallback`, `cached`,
  `quota_blocked`, `error`) and an **estimated** USD cost. The estimate uses
  per-model prices in `platform_settings/ai`, set through
  `POST /api/admin/settings` (there is no form for them yet); free-tier calls
  are still counted. The Super Admin sees totals at `/super/ai`.
- **Kill switches.** The Super Admin can switch off all AI, or just the
  chatbot or photo analysis, in `/super/settings`.

## Privacy

| Data | What happens to it |
|---|---|
| Chat (signed-in users) | Stored in `ai_chat_history/{uid}/messages`, readable and deletable only by that user. |
| Chat (guests) | Not stored. |
| Photos | Sent to Gemini for analysis. Stored only in Cloudinary or `report_media`, which is visible to the reporter, LGU staff and, once verified, the public. |
| Usage log | Holds counts and cost, **not** message text. |

The providers' own terms apply to prompts sent to them. Read Groq's and
Google's data-use terms for the free tiers; some free tiers may use
submitted data to improve their services.

## Without keys

With no `GROQ_API_KEY` or `GEMINI_API_KEY`, everything still works:

| Feature | Behaviour without keys |
|---|---|
| Chatbot | Answers from verified records with a template, labelled "simulated". |
| Advisory draft | Built from verified data with a template. |
| Route explanation | Uses the routing engine's own text. |
| Photos | Marked "not analyzed". |

This is how the project was developed and tested. **Live Groq and Gemini
calls have not been verified with real keys**; the adapters are unit-tested
with mocked HTTP responses (`tests/unit/ai-providers.test.ts`).
