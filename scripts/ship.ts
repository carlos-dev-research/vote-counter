/**
 * One-command production deploy:  bun run ship  [--dry-run] [--smoke]
 *
 * The git repo is the single source of truth. This script only deploys a commit that is on `main`,
 * has no uncommitted changes, and is pushed to origin. It is safe to run again and again:
 *
 *   First run  → logs in, creates the D1 database (or reuses one with the same name), asks for the
 *                production hostname, commits that config, sets the secrets, migrates, deploys.
 *   Later runs → never recreates resources and never overwrites data or existing secrets. Only new
 *                migrations are applied (after a backup), then the new code is deployed.
 *
 *   --dry-run  run every check and the build, show what would happen, change nothing
 *   --smoke    after deploying, run the end-to-end test against production (creates and deletes
 *              a "[Smoke test]" campaign)
 *
 * See docs/DEPLOYMENT.md.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DB_PLACEHOLDER,
  HOST_PLACEHOLDER,
  accountsFromWhoami,
  deployTag,
  destructiveStatements,
  findUuid,
  isEmail,
  isHostname,
  parseJsonc,
  pendingMigrations,
  setAccountId,
  setDatabaseId,
  setHostname,
  type WranglerConfig,
} from "./deploy-lib";

const ROOT = join(import.meta.dir, "..");
const CONFIG = join(ROOT, "wrangler.jsonc");
const WRANGLER = join(ROOT, "node_modules/.bin/wrangler");
const REQUIRED_SECRETS = ["ADMIN_EMAIL", "ADMIN_PASSWORD", "SESSION_SECRET"] as const;
const MIN_PASSWORD = 12;

const argv = new Set(process.argv.slice(2));
const DRY = argv.has("--dry-run");
const SMOKE = argv.has("--smoke");

// ── Output ─────────────────────────────────────────────────────────────────

const c = { bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" };
let stepNo = 0;
const step = (title: string) => console.log(`\n${c.bold}${c.cyan}[${++stepNo}] ${title}${c.reset}`);
const ok = (msg: string) => console.log(`  ${c.green}✓${c.reset} ${msg}`);
const info = (msg: string) => console.log(`  ${c.dim}•${c.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${c.yellow}!${c.reset} ${msg}`);

class Stop extends Error {}
const stop = (msg: string): never => {
  throw new Stop(msg);
};

// ── Processes ──────────────────────────────────────────────────────────────

interface RunResult {
  code: number;
  out: string;
  err: string;
}

/** Runs a command from the repo root. `capture` collects output instead of printing it. */
async function run(
  cmd: string[],
  opts: { capture?: boolean; allowFail?: boolean; stdin?: "inherit" | "ignore"; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdin: opts.stdin ?? "inherit",
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: opts.capture ? "pipe" : "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...opts.env },
  });
  const [out, err] = opts.capture
    ? await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
      ])
    : ["", ""];
  const code = await proc.exited;
  if (code !== 0 && !opts.allowFail) {
    stop(`Command failed (exit ${code}): ${cmd.join(" ")}${out || err ? `\n${(err || out).trim()}` : ""}`);
  }
  return { code, out, err };
}

const wrangler = (args: string[], opts: Parameters<typeof run>[1] = {}) => run([WRANGLER, ...args], opts);
const git = async (...args: string[]) => (await run(["git", ...args], { capture: true })).out.trim();

/** Runs SQL on the production database. Returns rows, or null if the query failed (e.g. no table yet). */
async function remoteQuery<T>(dbName: string, sql: string): Promise<T[] | null> {
  const r = await wrangler(["d1", "execute", dbName, "--remote", "--json", "--command", sql], {
    capture: true,
    allowFail: true,
    stdin: "ignore",
  });
  if (r.code !== 0) return null;
  try {
    const parsed = JSON.parse(r.out) as { results?: T[] }[];
    return parsed[0]?.results ?? [];
  } catch {
    return null;
  }
}

// ── Prompts ────────────────────────────────────────────────────────────────

function requireTty(): void {
  if (!process.stdin.isTTY) stop("This step needs an interactive terminal.");
}

function askLine(question: string): Promise<string> {
  requireTty();
  process.stdout.write(`  ${c.bold}?${c.reset} ${question} `);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buf = "";
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        stdin.off("data", onData);
        stdin.pause();
        resolve(buf.slice(0, nl).trim());
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

function askHidden(question: string): Promise<string> {
  requireTty();
  process.stdout.write(`  ${c.bold}?${c.reset} ${question} `);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n") return done(), resolve(value);
        if (ch === "\u0003") return done(), reject(new Stop("Cancelled."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.resume();
  });
}

async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const a = (await askLine(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"}`)).toLowerCase();
  return a === "" ? defaultYes : a === "y" || a === "yes";
}

// ── Main ───────────────────────────────────────────────────────────────────

let secretsDir: string | null = null; // temp dir holding new secrets; always removed

async function main(): Promise<void> {
  console.log(`${c.bold}Vote Counter · production deploy${DRY ? " (dry run: nothing will change)" : ""}${c.reset}`);

  // 1 ── Local checks ─────────────────────────────────────────────────────
  step("Local checks");
  const pinned = readFileSync(join(ROOT, ".env.example"), "utf8").match(/^BUN_VERSION=(\S+)/m)?.[1];
  if (pinned && Bun.version !== pinned) stop(`Bun ${Bun.version} is running, but the project pins ${pinned} (.env.example).`);
  ok(`Bun ${Bun.version}`);
  await run(["bun", "install", "--frozen-lockfile"], { capture: true });
  ok("Dependencies match bun.lock");

  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") stop(`You are on "${branch}". Deploys only happen from main.`);
  if (await git("status", "--porcelain")) {
    stop("There are uncommitted changes. Commit (and push) them first: production must match the repo.");
  }
  ok("On main with no uncommitted changes");

  // 2 ── Cloudflare login ─────────────────────────────────────────────────
  step("Cloudflare login");
  const whoami = async () => {
    const r = await wrangler(["whoami", "--json"], { capture: true, allowFail: true, stdin: "ignore" });
    try {
      return JSON.parse(r.out) as { loggedIn?: boolean; email?: string; accounts?: unknown };
    } catch {
      return { loggedIn: false };
    }
  };
  let who = await whoami();
  if (!who.loggedIn) {
    if (DRY) stop("Not logged in. Run: bunx wrangler login");
    info("Not logged in, opening the browser (click Allow)…");
    await wrangler(["login"]);
    who = await whoami();
    if (!who.loggedIn) stop("Login did not complete.");
  }
  ok(`Logged in${who.email ? ` as ${who.email}` : ""}`);

  let configText = readFileSync(CONFIG, "utf8");
  let config = parseJsonc<WranglerConfig>(configText);
  const configChanges: string[] = [];

  if (config.account_id) {
    process.env.CLOUDFLARE_ACCOUNT_ID = config.account_id;
  } else {
    const accounts = accountsFromWhoami(who);
    if (accounts.length > 1) {
      info("Your login has several Cloudflare accounts:");
      accounts.forEach((a, i) => info(`  ${i + 1}) ${a.name} (${a.id})`));
      const pick = Number(await askLine(`Which one hosts vote-counter? [1-${accounts.length}]`));
      const account = accounts[pick - 1] ?? stop("Invalid choice.");
      configText = setAccountId(configText, account.id);
      process.env.CLOUDFLARE_ACCOUNT_ID = account.id;
      configChanges.push(`account_id → ${account.name}`);
    } else if (accounts[0]) {
      ok(`Account: ${accounts[0].name}`);
    }
  }

  // 3 ── Resources (create once, then reuse) ─────────────────────────────
  step("Cloudflare resources");
  const db = config.d1_databases.find((d) => d.binding === "DB") ?? stop('No "DB" binding in wrangler.jsonc.');
  const listed = await wrangler(["d1", "list", "--json"], { capture: true, stdin: "ignore" });
  const databases = (JSON.parse(listed.out) as Record<string, string>[]).map((d) => ({
    id: d.uuid ?? d.id ?? d.database_id ?? "",
    name: d.name ?? "",
  }));

  let firstDeploy = false;
  if (db.database_id === DB_PLACEHOLDER) {
    const existing = databases.find((d) => d.name === db.database_name);
    if (existing) {
      ok(`D1 database "${db.database_name}" already exists: reusing it, data untouched`);
      configText = setDatabaseId(configText, existing.id);
      configChanges.push(`database_id → ${existing.id}`);
    } else if (DRY) {
      info(`Would create D1 database "${db.database_name}"`);
    } else {
      if (!(await confirm(`Create the D1 database "${db.database_name}"?`, true))) stop("Cancelled.");
      const created = await wrangler(["d1", "create", db.database_name], { capture: true, stdin: "ignore" });
      const id = findUuid(created.out + created.err) ?? stop("Could not read the new database id from wrangler.");
      ok(`Created D1 database "${db.database_name}" (${id})`);
      configText = setDatabaseId(configText, id);
      configChanges.push(`database_id → ${id}`);
      firstDeploy = true;
    }
  } else if (!databases.some((d) => d.id === db.database_id)) {
    stop(`database_id ${db.database_id} in wrangler.jsonc is not in this Cloudflare account.`);
  } else {
    ok(`D1 database "${db.database_name}" (${db.database_id})`);
  }

  let host = config.routes?.[0]?.pattern ?? stop("No route in wrangler.jsonc.");
  if (host === HOST_PLACEHOLDER) {
    if (DRY) {
      info("Would ask for the production hostname (e.g. vote.yourclub.org)");
    } else {
      info("Which subdomain should serve the app? Its parent domain must be in this Cloudflare account.");
      for (;;) {
        host = (await askLine("Production hostname (e.g. vote.yourclub.org):")).toLowerCase();
        if (isHostname(host)) break;
        warn("That doesn't look like a subdomain such as vote.yourclub.org");
      }
      configText = setHostname(configText, host);
      configChanges.push(`hostname → ${host}`);
    }
  } else {
    ok(`Hostname: ${host}`);
  }

  if (configChanges.length) {
    if (DRY) {
      info(`Would save to wrangler.jsonc and commit: ${configChanges.join(", ")}`);
    } else {
      writeFileSync(CONFIG, configText);
      config = parseJsonc<WranglerConfig>(configText);
      await run(["git", "--no-pager", "diff", "--", "wrangler.jsonc"]);
      if (!(await confirm("Commit this production config to the repo?", true))) {
        await run(["git", "checkout", "--", "wrangler.jsonc"]);
        stop("Cancelled. wrangler.jsonc was restored.");
      }
      await run(["git", "add", "wrangler.jsonc"], { capture: true });
      await run(["git", "commit", "-m", `Configure production: ${configChanges.join(", ")}`], { capture: true });
      ok("Committed wrangler.jsonc");
    }
  }

  // 4 ── Git: deploy exactly what's on origin/main ─────────────────────────
  step("Repository");
  await run(["git", "fetch", "--quiet", "origin", "main"], { capture: true });
  const local = await git("rev-parse", "HEAD");
  const remote = await git("rev-parse", "origin/main");
  const base = await git("merge-base", "HEAD", "origin/main");
  if (local !== remote) {
    if (base === local) stop("origin/main has commits you don't have. Run: git pull");
    if (base !== remote) stop("Your main and origin/main have diverged. Reconcile them first.");
    const ahead = await git("rev-list", "--count", "origin/main..HEAD");
    if (DRY) {
      info(`Would push ${ahead} commit(s) to origin/main`);
    } else {
      if (!(await confirm(`Push ${ahead} unpushed commit(s) to origin/main?`, true))) stop("Cancelled: deploys must match origin/main.");
      await run(["git", "push", "--quiet", "origin", "main"]);
    }
  }
  const sha = (await git("rev-parse", "--short=10", "HEAD")) || stop("No commit.");
  const subject = await git("log", "-1", "--format=%s");
  ok(`Deploying ${sha}  "${subject}"`);

  // 5 ── Build ────────────────────────────────────────────────────────────
  step("Typecheck, tests, build");
  await run(["bun", "run", "ci:build"]);
  ok("All checks passed");

  // 6 ── Production database ─────────────────────────────────────────────
  step("Production database");
  const dbReady = config.d1_databases[0]?.database_id !== DB_PLACEHOLDER;
  const files = readdirSync(join(ROOT, "migrations"));
  const applied = dbReady
    ? ((await remoteQuery<{ name: string }>(db.database_name, "SELECT name FROM d1_migrations ORDER BY id")) ?? []).map((r) => r.name)
    : [];
  const pending = pendingMigrations(files, applied);
  const campaigns = dbReady
    ? await remoteQuery<{ total: number; open: number }>(
        db.database_name,
        "SELECT COUNT(*) AS total, COALESCE(SUM(status = 'open'), 0) AS open FROM campaigns",
      )
    : null;
  const hasData = !!campaigns && (campaigns[0]?.total ?? 0) > 0;
  const openCount = campaigns?.[0]?.open ?? 0;

  if (campaigns) info(`${campaigns[0]?.total ?? 0} campaign(s) in production (data is never modified by deploys)`);
  if (pending.length === 0) ok("Schema is up to date: no migrations to apply");
  for (const f of pending) {
    const risky = destructiveStatements(readFileSync(join(ROOT, "migrations", f), "utf8"));
    if (risky.length === 0) {
      info(`Pending migration: ${f} (additive)`);
    } else {
      warn(`Pending migration ${f} can change or remove existing data: ${risky.join(", ")}`);
      if (!DRY && (await askLine(`Type MODIFY DATA to allow it:`)) !== "MODIFY DATA") stop("Cancelled.");
    }
  }
  if (openCount > 0) {
    warn(`${openCount} campaign(s) are OPEN right now. Votes are kept, but voters may see a brief hiccup.`);
    if (!DRY && !(await confirm("Deploy anyway?"))) stop("Cancelled.");
  }

  // 7 ── Secrets (only add missing ones, never overwrite) ──────────────────
  step("Secrets");
  const listedSecrets = await wrangler(["secret", "list", "--format", "json"], {
    capture: true,
    allowFail: true,
    stdin: "ignore",
  });
  let existing: string[] = [];
  if (listedSecrets.code === 0) {
    existing = (JSON.parse(listedSecrets.out) as { name: string }[]).map((s) => s.name);
  } else if (!/10007|does not exist|not found/i.test(listedSecrets.out + listedSecrets.err)) {
    stop(`Could not list secrets:\n${(listedSecrets.err || listedSecrets.out).trim()}`);
  } else {
    firstDeploy = true;
    info("The Worker doesn't exist yet: this is the first deploy");
  }
  const missing = REQUIRED_SECRETS.filter((n) => !existing.includes(n));
  for (const n of REQUIRED_SECRETS) if (existing.includes(n)) ok(`${n} is set (kept as is)`);

  const newSecrets: Record<string, string> = {};
  if (missing.length) {
    if (DRY) {
      info(`Would ask for: ${missing.join(", ")}`);
    } else {
      info(`Missing: ${missing.join(", ")}. They are sent to Cloudflare only, never written to the repo.`);
      if (missing.includes("ADMIN_EMAIL")) {
        for (;;) {
          const email = await askLine("Admin email (back office username):");
          if (isEmail(email)) {
            newSecrets.ADMIN_EMAIL = email;
            break;
          }
          warn("Not a valid email.");
        }
      }
      if (missing.includes("ADMIN_PASSWORD")) {
        for (;;) {
          const pw = await askHidden(`Admin password (min ${MIN_PASSWORD} characters, hidden):`);
          if (pw.length < MIN_PASSWORD) {
            warn(`Too short: use at least ${MIN_PASSWORD} characters.`);
            continue;
          }
          if ((await askHidden("Repeat the password:")) !== pw) {
            warn("The passwords don't match.");
            continue;
          }
          newSecrets.ADMIN_PASSWORD = pw;
          break;
        }
      }
      if (missing.includes("SESSION_SECRET")) {
        newSecrets.SESSION_SECRET = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
        ok("SESSION_SECRET generated");
      }
    }
  }

  // 8 ── Summary ──────────────────────────────────────────────────────────
  step("Summary");
  const url = host === HOST_PLACEHOLDER ? "(hostname to be chosen)" : `https://${host}`;
  info(`Commit:      ${sha}  ${subject}`);
  info(`URL:         ${url}`);
  info(`Database:    ${db.database_name}${pending.length ? `, apply ${pending.join(", ")}` : ", no schema changes"}`);
  if (pending.length && hasData) info("Backup:      export the database before migrating");
  if (missing.length) info(`Secrets:     add ${missing.join(", ")}`);

  if (DRY) {
    await wrangler(["deploy", "--dry-run"], { capture: true, stdin: "ignore" });
    ok("Worker bundle compiles (wrangler deploy --dry-run)");
    console.log(`\n${c.green}Dry run complete. Nothing was changed.${c.reset}`);
    return;
  }
  if (!(await confirm(`Deploy ${sha} to ${url}?`, true))) stop("Cancelled.");

  // 9 ── Backup + migrations ─────────────────────────────────────────────
  const tag = deployTag();
  if (pending.length) {
    step("Migrations");
    if (hasData) {
      mkdirSync(join(ROOT, "backups"), { recursive: true });
      const backup = join("backups", `${tag}-before-migrations.sql`);
      await wrangler(["d1", "export", db.database_name, "--remote", "--output", backup], { capture: true, stdin: "ignore" });
      ok(`Backup saved: ${backup}`);
    }
    await wrangler(["d1", "migrations", "apply", db.database_name, "--remote"], { stdin: "ignore" });
    ok(`Applied ${pending.length} migration(s)`);
  }

  // 10 ── Deploy ──────────────────────────────────────────────────────────
  step("Deploy");
  const deployArgs = ["deploy", "--message", `${sha} ${subject}`.slice(0, 100), "--tag", sha];
  if (Object.keys(newSecrets).length) {
    secretsDir = mkdtempSync(join(tmpdir(), "vote-ship-"));
    const file = join(secretsDir, "secrets.json");
    writeFileSync(file, JSON.stringify(newSecrets), { mode: 0o600 });
    deployArgs.push("--secrets-file", file); // additive: existing secrets are not touched
  }
  await wrangler(deployArgs, { stdin: "ignore" });
  if (secretsDir) {
    rmSync(secretsDir, { recursive: true, force: true });
    secretsDir = null;
  }
  ok("Deployed");

  // 11 ── Verify ──────────────────────────────────────────────────────────
  step("Verify production");
  const healthy = await healthCheck(url, firstDeploy);

  // 12 ── Record ──────────────────────────────────────────────────────────
  await run(["git", "tag", "-a", tag, "-m", `Deployed ${sha} to ${url}`], { capture: true });
  await run(["git", "push", "--quiet", "origin", tag], { capture: true });
  ok(`Tagged ${tag} (git tag -l "deploy-*" lists every deploy)`);

  if (SMOKE && healthy) {
    step("End-to-end test against production");
    const email = newSecrets.ADMIN_EMAIL ?? (await askLine("Admin email:"));
    const password = newSecrets.ADMIN_PASSWORD ?? (await askHidden("Admin password (hidden):"));
    await run(["bun", "run", "scripts/smoke.ts"], {
      env: { BASE_URL: url, ADMIN_EMAIL: email, ADMIN_PASSWORD: password },
    });
  }

  console.log(`\n${c.green}${c.bold}Done.${c.reset} ${url}  ·  back office: ${url}/admin`);
}

/** Checks pages and API. On the first deploy, DNS and the certificate can take a few minutes. */
async function healthCheck(url: string, patient: boolean): Promise<boolean> {
  const attempts = patient ? 30 : 6;
  for (let i = 1; i <= attempts; i++) {
    try {
      const page = await fetch(url, { redirect: "manual" });
      const api = await fetch(`${url}/api/campaigns/healthcheck`);
      const body = await api.text();
      if (api.status === 500 && body.includes("not configured")) stop("The app is up but secrets are missing.");
      if (page.status === 200 && api.status === 404 && body.includes("Campaign not found")) {
        ok("Pages load; API, database and secrets respond");
        return true;
      }
      info(`Not ready yet (page ${page.status}, api ${api.status})…`);
    } catch (e) {
      if (e instanceof Stop) throw e;
      info(patient ? "Waiting for DNS and the certificate…" : "Not reachable yet…");
    }
    await Bun.sleep(10_000);
  }
  warn(
    patient
      ? `${url} isn't answering yet. A new custom domain can take a few more minutes; open it in a browser shortly.`
      : `${url} did not pass the health check. Check: bunx wrangler tail`,
  );
  return false;
}

main()
  .catch((err) => {
    console.error(`\n${c.red}✗ ${err instanceof Error ? err.message : String(err)}${c.reset}`);
    if (!(err instanceof Stop)) console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
    process.stdin.pause();
  });
