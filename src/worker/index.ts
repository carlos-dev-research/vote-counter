import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env";
import { fail } from "./lib/http";
import { adminRoutes } from "./routes/admin";
import { publicRoutes } from "./routes/public";

const app = new Hono<AppEnv>();

// Security headers on every Worker response (static files get the same via public/_headers).
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "same-origin",
  }),
);

// API: reject cross-site form posts, fail clearly if secrets are missing, never cache.
app.use("/api/*", csrf());
app.use("/api/*", async (c, next) => {
  if (!c.env.SESSION_SECRET || !c.env.ADMIN_EMAIL || !c.env.ADMIN_PASSWORD) {
    return fail(c, 500, "Server is not configured: missing ADMIN_EMAIL, ADMIN_PASSWORD or SESSION_SECRET");
  }
  await next();
  c.header("Cache-Control", "no-store");
});

app.route("/api/admin", adminRoutes);
app.route("/api", publicRoutes);

// Voter page: the QR code points here. The page script reads the slug from the URL.
app.get("/v/:slug", async (c) => {
  const page = await c.env.ASSETS.fetch(new URL("/vote", c.req.url));
  return new Response(page.body, page); // copy so headers are mutable for secureHeaders
});

app.notFound((c) => fail(c, 404, "Not found"));
app.onError((err, c) => {
  // Thrown by middleware such as csrf() (403): keep the status, use our JSON error shape.
  if (err instanceof HTTPException) return fail(c, err.status, err.status === 403 ? "Forbidden" : err.message);
  console.error(err);
  return fail(c, 500, "Internal error");
});

export default app;
