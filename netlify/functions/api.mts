// Netlify Functions v2 entry point — routes every /api/* request through
// the shared, platform-agnostic router. Runs on Netlify's free tier; no
// Firebase Blaze plan required.
import { handle } from "../../server/router";

export default async (req: Request, context: { ip?: string }) => handle(req, { ip: context?.ip });

export const config = { path: "/api/*" };
