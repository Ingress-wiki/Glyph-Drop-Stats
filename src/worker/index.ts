import { handleApi } from "./api.ts";

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
