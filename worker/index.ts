import { createAuth } from "./auth.ts";
import { handleLevelRequest } from "./levels.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      const auth = createAuth(env, url.origin);
      if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
        return auth.handler(request);
      }

      const response = await handleLevelRequest(request, env, ctx, auth);
      return response ?? Response.json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({
        message: "request failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
