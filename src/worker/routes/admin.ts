import { Hono } from "hono";
import type { AppEnv } from "../env";

/** Back office API. Everything except /login requires a valid admin session cookie. */
export const adminRoutes = new Hono<AppEnv>();

const todo = () => new Response(JSON.stringify({ error: "Not implemented" }), { status: 501 });

adminRoutes.post("/login", todo);
adminRoutes.post("/logout", todo);

// TODO: adminRoutes.use("*", requireAdmin)  (src/worker/lib/auth.ts), after /login

adminRoutes.get("/campaigns", todo);
adminRoutes.post("/campaigns", todo);
adminRoutes.get("/campaigns/:id", todo);
adminRoutes.post("/campaigns/:id/status", todo);
adminRoutes.delete("/campaigns/:id", todo);
adminRoutes.get("/campaigns/:id/qr.svg", todo);

adminRoutes.post("/campaigns/:id/categories", todo);
adminRoutes.delete("/categories/:id", todo);

adminRoutes.post("/categories/:id/candidates", todo);
adminRoutes.delete("/candidates/:id", todo);
