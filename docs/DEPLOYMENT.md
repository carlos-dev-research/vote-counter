# Deploying to Cloudflare

**One command:** `bun run ship`

The git repository is the single source of truth. The script deploys only a commit that is
on `main`, has no uncommitted changes, and is pushed to GitHub. The GitHub repo is **not**
connected to Cloudflare; deploys happen only when you run the script.

| | What `bun run ship` does |
|---|---|
| **First run** | Logs you in, creates the D1 database, asks for your subdomain, commits that config, asks for the admin email and password, creates the tables, deploys, and checks the site. |
| **Every later run** | Checks, applies **new** migrations only (after a backup), deploys the new code. Never recreates the database, never overwrites data or existing secrets. |

```sh
bun run ship:check   # dry run: every check + build, shows what would happen, changes nothing
bun run ship         # deploy
bun run ship --smoke # deploy, then run the end-to-end test against production
```

---

## What the script does, step by step

| # | Step | Stops the deploy if… |
|---|---|---|
| 1 | **Local checks**: Bun version = `BUN_VERSION`, packages match `bun.lock`, on `main`, nothing uncommitted | anything differs |
| 2 | **Cloudflare login**: opens the browser the first time (`wrangler login`); asks which account if you have several | login fails |
| 3 | **Resources**: D1 database `vote-counter` (creates it **once**, or reuses an existing one with that name), production hostname (asked **once**) | the database id in the config isn't in your account |
| 4 | **Repository**: if step 3 changed `wrangler.jsonc`, commits it; pushes unpushed commits (asks first) | `origin/main` has commits you don't have, or has diverged |
| 5 | **Typecheck, unit tests, build** (`bun run ci:build`) | any check fails |
| 6 | **Production database**: lists pending migrations; **asks you to type `MODIFY DATA`** if one could delete or rewrite data; warns if a campaign is open | you don't confirm |
| 7 | **Secrets**: keeps every existing secret; asks only for missing ones (email, hidden password); generates `SESSION_SECRET` | |
| 8 | **Summary** and final confirmation | you say no |
| 9 | **Backup + migrations**: exports the database to `backups/` (git-ignored) if there is data, then applies only new migrations | |
| 10 | **Deploy**: labelled with the commit hash and message; new secrets are uploaded with it | |
| 11 | **Verify**: pages load, and the API, database and secrets respond | (warns; on the first deploy it waits for DNS and the certificate) |
| 12 | **Record**: git tag `deploy-YYYYMMDD-HHMMSS` pushed to GitHub | |

Nothing in production changes before step 9. If you cancel or anything fails earlier,
production is untouched.

---

## First deploy

### Before you start

- A Cloudflare account that has **your domain** (the zone must be active in Cloudflare DNS).
- Choose a subdomain, e.g. `vote.yourclub.org`. It must **not** already have a DNS record:
  Cloudflare creates the record and the HTTPS certificate itself.
- Everything committed and pushed (`git status` is clean).

### Run it

```sh
bun run ship:check   # optional: see what will happen
bun run ship
```

You'll be asked, in order:

1. **Browser login**: click *Allow*.
2. **Account**: only if your login has several Cloudflare accounts.
3. **Create the D1 database?** Answer yes.
4. **Production hostname**: e.g. `vote.yourclub.org`.
5. **Commit this production config?** Answer yes. It saves the database id and hostname in
   `wrangler.jsonc`; neither is a secret.
6. **Push to origin/main?** Answer yes.
7. **Admin email** and **admin password** (hidden, typed twice, at least 12 characters).
   They go only to Cloudflare, encrypted, and are never written to the repo or to disk.
8. **Deploy?** Answer yes.

The first verification can take a few minutes while Cloudflare creates the certificate for
your subdomain. Then open `https://vote.yourclub.org/admin` and sign in.

To test the live site end to end: `bun run ship --smoke`, or later
`BASE_URL=https://vote.yourclub.org ADMIN_EMAIL=… ADMIN_PASSWORD=… bun run smoke`.
The test creates a `[Smoke test]` campaign and always deletes it.

---

## Everyday workflow

```sh
bun run dev                        # work locally: http://localhost:8787
bun run typecheck && bun test      # quick checks
bun run smoke                      # end-to-end against the dev server

git add -A && git commit -m "…"
git push origin main               # (or let ship push for you)
bun run ship                       # deploy
```

## Keeping data safe

- **Deploys never touch data.** Code and data are separate: deploying replaces the Worker's
  code, while campaigns and votes live in D1 and stay as they are.
- **Migrations only add.** Write migrations that add tables, add columns that are nullable or
  have a default, or add indexes. The script flags anything else (`DROP`, `DELETE`, `UPDATE`,
  `RENAME`, …) and requires you to type `MODIFY DATA`.
- **Never edit a migration that was already deployed.** Add the next numbered file
  (`0002_…sql`) and test it locally first: `bun run db:migrate:local && bun run smoke`.
- **Backups:** before applying migrations, the script exports the database to
  `backups/deploy-…-before-migrations.sql`. D1 also keeps 30 days of point-in-time history
  (*Time Travel*, see Operations).
- **Secrets are never overwritten** by the script. To change one, see Operations.

## Undoing a deploy

```sh
bunx wrangler rollback          # back to the previous code version (seconds)
```

Then fix the problem in the repo and run `bun run ship` again. A rollback does **not** undo
migrations; because migrations are additive, the old code keeps working with the new schema.

---

## Operations

| Task | Command |
|---|---|
| What's live? | `git tag -l "deploy-*"` (latest = live) · `bunx wrangler deployments list` |
| Live logs | `bunx wrangler tail` (or Dashboard → Workers & Pages → vote-counter → Observability) |
| Change the admin password | `bunx wrangler secret put ADMIN_PASSWORD` |
| Change the admin email | `bunx wrangler secret put ADMIN_EMAIL` |
| Back up the database | `bunx wrangler d1 export vote-counter --remote --output backups/manual.sql` |
| Restore to an earlier time | `bunx wrangler d1 time-travel info vote-counter`, then `bunx wrangler d1 time-travel restore vote-counter --timestamp=<ISO time>` |
| Query production | `bunx wrangler d1 execute vote-counter --remote --command "SELECT name, status FROM campaigns"` |
| Update Bun | Change `BUN_VERSION` in `.env.example` **and** `packageManager` in `package.json`, then commit |

**About `SESSION_SECRET`:** changing it signs the admin out and gives **every voter's device
a new identity**, so people could vote again in an open campaign. Only rotate it when no
campaign is open: `bunx wrangler secret put SESSION_SECRET` with the output of
`openssl rand -base64 32`.

### Optional: limit login attempts

Dashboard → your domain → **Security → WAF → Rate limiting rules** → Create:
if URI Path *equals* `/api/admin/login` **and** Method *equals* `POST`, then block at about
5 requests per minute per IP (the free plan offers fixed periods; pick the closest).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| *"There are uncommitted changes"* | Commit or stash; the script deploys only committed code |
| *"origin/main has commits you don't have"* | `git pull`, then run again |
| *"database_id … is not in this Cloudflare account"* | You're logged in to a different account: `bunx wrangler logout`, then run again |
| Deploy fails: *hostname already has a DNS record* | Delete that record in Dashboard → your domain → DNS (or choose another subdomain: edit `routes` in `wrangler.jsonc`, commit) |
| Deploy fails: *zone not found* | The parent domain isn't in this Cloudflare account, or isn't active yet |
| Verify step keeps waiting on the first deploy | A new certificate can take a few minutes; open the site in a browser shortly |
| *"secrets are missing"* | `bunx wrangler secret list`, then `bunx wrangler secret put <NAME>` |
| Sign-in fails with the right password | Secrets are case- and space-sensitive; set it again with `secret put` |
