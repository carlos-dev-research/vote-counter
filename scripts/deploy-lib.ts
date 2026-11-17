/**
 * Pure helpers for scripts/ship.ts (no I/O, unit-tested in test/deploy-lib.test.ts).
 */

export const DB_PLACEHOLDER = "REPLACE_WITH_D1_DATABASE_ID";
export const HOST_PLACEHOLDER = "REPLACE_WITH_HOSTNAME";

// ── wrangler.jsonc ─────────────────────────────────────────────────────────

export interface WranglerConfig {
  name: string;
  account_id?: string;
  routes?: { pattern: string; custom_domain?: boolean }[];
  d1_databases: { binding: string; database_name: string; database_id: string; migrations_dir?: string }[];
}

/** Parses our wrangler.jsonc: full-line // comments and trailing commas are allowed. */
export function parseJsonc<T>(text: string): T {
  const noComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1")) as T;
}

export function setDatabaseId(text: string, id: string): string {
  if (!text.includes(`"${DB_PLACEHOLDER}"`)) throw new Error("database_id placeholder not found in wrangler.jsonc");
  return text.replace(`"${DB_PLACEHOLDER}"`, JSON.stringify(id));
}

export function setHostname(text: string, host: string): string {
  if (!text.includes(`"${HOST_PLACEHOLDER}"`)) throw new Error("hostname placeholder not found in wrangler.jsonc");
  return text.replace(`"${HOST_PLACEHOLDER}"`, JSON.stringify(host));
}

/** Adds "account_id" right after the "name" line (only needed when the login has several accounts). */
export function setAccountId(text: string, accountId: string): string {
  if (/"account_id"\s*:/.test(text)) return text.replace(/("account_id"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(accountId)}`);
  return text.replace(/(\n(\s*)"name"\s*:\s*"[^"]*",)/, `$1\n$2"account_id": ${JSON.stringify(accountId)},`);
}

// ── Validation ─────────────────────────────────────────────────────────────

/** A subdomain hostname like vote.example.org (at least 3 labels, lowercase). */
export function isHostname(v: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/.test(v);
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ── Migrations ─────────────────────────────────────────────────────────────

/** Migration files not yet recorded in the remote d1_migrations table, in order. */
export function pendingMigrations(files: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return files.filter((f) => f.endsWith(".sql") && !done.has(f)).sort();
}

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bALTER\s+TABLE\s+\S+\s+DROP\b/i, "ALTER TABLE … DROP"],
  [/\bALTER\s+TABLE\s+\S+\s+RENAME\b/i, "ALTER TABLE … RENAME"],
  [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
  [/\bUPDATE\s+\S+\s+SET\b/i, "UPDATE … SET"],
  [/\bINSERT\s+OR\s+REPLACE\b/i, "INSERT OR REPLACE"],
  [/\bREPLACE\s+INTO\b/i, "REPLACE INTO"],
];

/** Statements in a migration that can remove or rewrite existing data (comments ignored). */
export function destructiveStatements(sql: string): string[] {
  const code = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return DESTRUCTIVE.filter(([re]) => re.test(code)).map(([, label]) => label);
}

// ── whoami ─────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
}

/** Extracts accounts from `wrangler whoami --json` output, tolerating shape differences. */
export function accountsFromWhoami(json: unknown): Account[] {
  const raw = (json as { accounts?: unknown })?.accounts;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => ({ id: String((a as Account).id ?? ""), name: String((a as Account).name ?? "") }))
    .filter((a) => /^[0-9a-f]{32}$/.test(a.id));
}

/** First UUID in some text (used to read the id printed by `wrangler d1 create`). */
export function findUuid(text: string): string | null {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? null;
}

export function deployTag(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `deploy-${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}
