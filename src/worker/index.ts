import { Hono } from "hono";
import type { AppEnv } from "./env";
import { adminRoutes } from "./routes/admin";
import { publicRoutes } from "./routes/public";

const app = new Hono<AppEnv>();

app.route("/api/admin", adminRoutes);
app.route("/api", publicRoutes);

// Voter page: the QR code points here. The page script reads the slug from the URL.
app.get("/v/:slug", (c) => c.env.ASSETS.fetch(new URL("/vote", c.req.url)));

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
