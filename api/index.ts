// Alternative deployment target: Vercel Functions (Web-standard handler).
// vercel.json rewrites /api/(.*) here. Netlify is the primary, documented
// target; this adapter exists so the same backend can move hosts.
import { handle } from "../server/router";

export default {
  fetch(request: Request) {
    return handle(request);
  },
};
