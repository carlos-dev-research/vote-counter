import { Hono } from "hono";
import type { AppEnv } from "../env";

/** Voter-facing API. No auth; every request gets a signed device-ID cookie. */
export const publicRoutes = new Hono<AppEnv>();

// TODO: publicRoutes.use("*", deviceId)  (src/worker/lib/device.ts)

/** Campaign state: draft → name only, open → ballot + this device's votes, closed → results. */
publicRoutes.get("/campaigns/:slug", (c) => c.json({ error: "Not implemented" }, 501));

/** Body: { votes: [{ categoryId, candidateId }] }. 409 if this device already voted in a category. */
publicRoutes.post("/campaigns/:slug/votes", (c) => c.json({ error: "Not implemented" }, 501));
