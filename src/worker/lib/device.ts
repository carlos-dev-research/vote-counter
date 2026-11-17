import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { signValue, verifyValue } from "./crypto";
import { isHttps } from "./http";

const COOKIE = "vc_device";
const ONE_YEAR = 365 * 24 * 60 * 60;

/**
 * Identifies the voter's device with a signed, HttpOnly cookie. If the cookie is missing or
 * forged, issues a new random id. Sets `c.var.deviceId`.
 */
export const deviceId = createMiddleware<AppEnv>(async (c, next) => {
  const raw = getCookie(c, COOKIE);
  let id = raw ? await verifyValue(raw, c.env.SESSION_SECRET) : null;
  if (!id) {
    id = crypto.randomUUID();
    setCookie(c, COOKIE, await signValue(id, c.env.SESSION_SECRET), {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: "Lax",
      path: "/",
      maxAge: ONE_YEAR,
    });
  }
  c.set("deviceId", id);
  await next();
});
