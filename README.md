# vote-counter

A simple app for voting during Toastmasters sessions, hosted on Cloudflare (Worker + D1).

- Agents: start with [CLAUDE.md](CLAUDE.md)
- Every file is described in [MAP.md](MAP.md)
- Design details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Deploying to Cloudflare: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Run locally

```sh
bun run setup      # creates .env from .env.example, installs, creates the local database
                   # then edit .env: ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
bun run dev        # http://localhost:8787
```

- Back office: http://localhost:8787/admin (sign in with the values in `.env`)
- Voters: scan the QR code shown in the back office

## Test

```sh
bun run typecheck && bun test   # types + unit tests
bun run smoke                   # end-to-end, with `bun run dev` running in another terminal
bun run smoke --keep            # same, but keeps the campaign so you can look at it in the UI
```

To try it from a phone on the same Wi-Fi: `bunx wrangler dev --ip 0.0.0.0`, then open the back
office at `http://<your-computer-ip>:8787/admin` so the QR code contains that address.

## Deploy

```sh
bun run ship:check   # dry run: all checks, nothing changes
bun run ship         # deploy committed + pushed main to Cloudflare
```

The first run creates the Cloudflare resources (database, custom domain, secrets); later runs
only deploy new code and new migrations, never overwriting data. Details:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
