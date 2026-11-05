import { handleApi } from "./api.ts";
import { fetchActivityBoard, refreshEvents } from "./events.ts";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    return new Response(null, { status: 404 });
  },
  /** The daily cron (wrangler.jsonc): the Ingress events from the activity board. */
  async scheduled(...[, env]: [ScheduledController, Env]) {
    const result = await refreshEvents(env.DB, fetchActivityBoard, Math.floor(Date.now() / 1000));
    console.log(`activity board: ${result.events} events stored, ${result.removed} upcoming removed${result.skipped.length > 0 ? `, unreadable: ${result.skipped.join(", ")}` : ""}`);
  },
} satisfies ExportedHandler<Env>;
