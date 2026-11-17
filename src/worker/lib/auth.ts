import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Env } from "../env";
import { safeEqual, signValue, verifyValue } from "./crypto";
import { fail, isHttps } from "./http";

const COOKIE = "vc_admin";
const COOKIE_PATH = "/api/admin";
const SESSION_SECONDS = 12 * 60 * 60;

/** Checks email (case-insensitive) and password against the secrets, in constant time. */
export function checkCredentials(env: Env, email: unknown, password: unknown): boolean {
  if (typeof email !== "string" || typeof password !== "string") return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), env.ADMIN_EMAIL.trim().toLowerCase());
  const passOk = safeEqual(password, env.ADMIN_PASSWORD);
  return emailOk && passOk;
}

/** Sets the signed session cookie: "<expiresAtSeconds>.<hmac>". */
export async function issueSession(c: Context<AppEnv>): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  setCookie(c, COOKIE, await signValue(String(expiresAt), c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: COOKIE_PATH,
    maxAge: SESSION_SECONDS,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE, { path: COOKIE_PATH, secure: isHttps(c) });
}

/** Rejects with 401 unless the request carries a valid, unexpired session cookie. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const raw = getCookie(c, COOKIE);
  const value = raw ? await verifyValue(raw, c.env.SESSION_SECRET) : null;
  if (!value || Number(value) < Date.now() / 1000) return fail(c, 401, "Not signed in");
  await next();
});
