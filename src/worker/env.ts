/** Bindings and secrets available to the Worker (see wrangler.jsonc and .env.example). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

/** Hono generic: bindings plus per-request variables set by middleware. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by the deviceId middleware on public routes. */
    deviceId: string;
  };
};
