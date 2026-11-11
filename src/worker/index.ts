import { pruneExpired } from "./accounts.ts";
import { handleApi } from "./api.ts";
import { fetchActivityBoard, refreshEvents } from "./events.ts";
import { handleMcp } from "./mcp.ts";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    if (pathname === "/mcp") return handleMcp(request, env);
    return new Response(null, { status: 404 });
  },
  /** The daily cron (wrangler.jsonc): the Ingress events from the activity board, and expired sign-ins cleared. */
  async scheduled(...[, env]: [ScheduledController, Env]) {
    const now = Math.floor(Date.now() / 1000);
    await pruneExpired(env.DB, now);
    const result = await refreshEvents(env.DB, fetchActivityBoard, now);
    console.log(`activity board: ${result.events} events stored, ${result.removed} upcoming removed${result.skipped.length > 0 ? `, unreadable: ${result.skipped.join(", ")}` : ""}`);
  },
} satisfies ExportedHandler<Env>;
