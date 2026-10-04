import { handleApi } from "./api.ts";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
