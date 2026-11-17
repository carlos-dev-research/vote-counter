/**
 * End-to-end smoke test against a running server (default: local `bun run dev`).
 *
 *   bun run smoke                         # http://localhost:8787, credentials from .env
 *   BASE_URL=https://… bun run smoke      # another environment
 *   bun run smoke --keep                  # don't delete the test campaign (to look at it in the UI)
 *
 * Bun loads .env automatically, so ADMIN_EMAIL / ADMIN_PASSWORD come from there.
 *
 * `any` is used for response JSON on purpose: this script checks raw API output, not types.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const KEEP = process.argv.includes("--keep");

/** Minimal cookie jar: one per simulated browser/device. */
class Client {
  private cookies = new Map<string, string>();
  constructor(readonly label: string) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        // Browsers send Origin on every non-GET fetch; the CSRF guard relies on it.
        ...(method !== "GET" ? { Origin: BASE } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = (pair ?? "").split("=");
      if (k) this.cookies.set(k.trim(), v.join("="));
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }
}

class CheckFailed extends Error {}

let passed = 0;
/** Set once the test campaign exists, so it is deleted even if a later check fails. */
let cleanup: (() => Promise<unknown>) | null = null;

function check(cond: unknown, label: string, detail?: unknown): void {
  if (!cond) {
    console.error(`  ✗ ${label}`, detail ?? "");
    throw new CheckFailed(label);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);
  const admin = new Client("admin");
  const phoneA = new Client("phone A");
  const phoneB = new Client("phone B");

  console.log("Pages and security");
  const home = await admin.req("GET", "/");
  check(home.status === 200 && home.text.includes("Vote Counter"), "landing page loads");
  check((await admin.req("GET", "/styles.css")).status === 200, "styles.css is served");
  check((await admin.req("GET", "/admin")).status === 200, "admin page loads");
  check((await admin.req("GET", "/api/admin/campaigns")).status === 401, "admin API rejects anonymous requests");
  const formPost = await admin.req("POST", "/api/admin/login", undefined, {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://evil.example",
  });
  check(formPost.status === 403, "cross-site form post is blocked (CSRF)", formPost.status);
  check(
    (await admin.req("POST", "/api/admin/login", { email: "x@y.z", password: "nope" })).status === 401,
    "wrong password is rejected",
  );

  console.log("\nBack office");
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  check((await admin.req("POST", "/api/admin/login", { email, password })).status === 200, "admin signs in");

  // The name contains HTML on purpose: the UI must show it as text (XSS check), never run it.
  const created = await admin.req("POST", "/api/admin/campaigns", {
    name: "[Smoke test] <script>alert(1)</script>",
  });
  check(created.status === 201, "creates a campaign", created.json);
  const { id, slug } = created.json.campaign;
  cleanup = () => admin.req("DELETE", `/api/admin/campaigns/${id}`);

  check(
    (await admin.req("POST", `/api/admin/campaigns/${id}/status`, { status: "open" })).status === 409,
    "can't open a campaign without categories",
  );

  const cats: Record<string, string> = {};
  for (const name of ["Best Speaker", "Best Table Topics", "Best Evaluator"]) {
    const r = await admin.req("POST", `/api/admin/campaigns/${id}/categories`, { name });
    cats[name] = r.json.id;
  }
  check(Object.values(cats).every(Boolean), "adds 3 categories");

  const cands: Record<string, string> = {};
  const roster: Record<string, string[]> = {
    "Best Speaker": ["Ana", "Ben"],
    "Best Table Topics": ["Carla", "Dev"],
    "Best Evaluator": ["Eve", "Finn"],
  };
  for (const [cat, names] of Object.entries(roster)) {
    for (const name of names) {
      const r = await admin.req("POST", `/api/admin/categories/${cats[cat]}/candidates`, { name });
      cands[name] = r.json.id;
    }
  }
  check(Object.keys(cands).length === 6, "adds 6 candidates");

  const draftView = await phoneA.req("GET", `/api/campaigns/${slug}`);
  check(draftView.json?.status === "draft", "voter sees 'not open yet' while draft");
  check(
    (await phoneA.req("POST", `/api/campaigns/${slug}/votes`, { votes: [{ categoryId: cats["Best Speaker"], candidateId: cands.Ana }] })).status === 409,
    "voting is rejected while draft",
  );

  check(
    (await admin.req("POST", `/api/admin/campaigns/${id}/status`, { status: "open" })).status === 200,
    "opens voting",
  );
  const qr = await admin.req("GET", `/api/admin/campaigns/${id}/qr.svg`);
  check(qr.status === 200 && qr.text.startsWith("<svg"), "QR code is an SVG");
  check(
    (await admin.req("DELETE", `/api/admin/candidates/${cands.Ana}`)).status === 409,
    "can't delete candidates once open",
  );

  console.log("\nVoting");
  const votePage = await phoneA.req("GET", `/v/${slug}`);
  check(votePage.status === 200 && votePage.text.includes("vote.js"), "voter page /v/<slug> loads");
  check(votePage.headers.get("content-security-policy")?.includes("script-src 'self'"), "voter page sends a CSP");

  const ballot = await phoneA.req("GET", `/api/campaigns/${slug}`);
  check(ballot.json?.status === "open" && ballot.json.categories.length === 3, "voter gets the ballot");
  check(!JSON.stringify(ballot.json).includes('"votes"'), "ballot does not leak counts");

  const voteA = [
    { categoryId: cats["Best Speaker"], candidateId: cands.Ana },
    { categoryId: cats["Best Table Topics"], candidateId: cands.Carla },
    { categoryId: cats["Best Evaluator"], candidateId: cands.Eve },
  ];
  check((await phoneA.req("POST", `/api/campaigns/${slug}/votes`, { votes: voteA })).status === 201, "phone A votes");
  check(
    (await phoneA.req("POST", `/api/campaigns/${slug}/votes`, { votes: [voteA[0]] })).status === 409,
    "phone A cannot vote twice",
  );
  const mine = await phoneA.req("GET", `/api/campaigns/${slug}`);
  check(Object.keys(mine.json.myVotes).length === 3, "phone A sees its own votes");

  check(
    (await phoneB.req("POST", `/api/campaigns/${slug}/votes`, {
      votes: [{ categoryId: cats["Best Speaker"], candidateId: cands.Carla }],
    })).status === 400,
    "candidate from another category is rejected",
  );
  check(
    (await phoneB.req("POST", `/api/campaigns/${slug}/votes`, {
      votes: [{ categoryId: cats["Best Speaker"], candidateId: cands.Ana }],
    })).status === 201,
    "phone B votes (partial ballot)",
  );
  check(
    (await phoneB.req("POST", `/api/campaigns/${slug}/votes`, {
      votes: [{ categoryId: cats["Best Evaluator"], candidateId: cands.Finn }],
    })).status === 201,
    "phone B comes back for a skipped category",
  );

  const forged = new Client("forged");
  await forged.req("GET", `/api/campaigns/${slug}`); // get a cookie, then tamper with it
  const tampered = await fetch(`${BASE}/api/campaigns/${slug}/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "vc_device=00000000-0000-4000-8000-000000000000.fake" },
    body: JSON.stringify({ votes: [voteA[0]] }),
  });
  check(tampered.status === 201, "forged device cookie is replaced with a fresh one (counts as a new device)");

  const live = await admin.req("GET", `/api/admin/campaigns/${id}`);
  const speaker = live.json.categories.find((c: any) => c.id === cats["Best Speaker"]);
  check(live.json.voters === 3, "admin sees 3 voters live", live.json.voters);
  check(speaker.candidates.find((c: any) => c.name === "Ana").votes === 3, "admin sees live counts");

  console.log("\nResults");
  check(
    (await admin.req("POST", `/api/admin/campaigns/${id}/status`, { status: "closed" })).status === 200,
    "closes voting",
  );
  check(
    (await phoneB.req("POST", `/api/campaigns/${slug}/votes`, {
      votes: [{ categoryId: cats["Best Table Topics"], candidateId: cands.Dev }],
    })).status === 409,
    "voting is rejected after close",
  );
  const results = await phoneB.req("GET", `/api/campaigns/${slug}`);
  check(results.json?.status === "closed", "same link now shows results");
  const sp = results.json.categories.find((c: any) => c.name === "Best Speaker");
  check(sp.candidates[0].name === "Ana" && sp.candidates[0].winner, "Ana wins Best Speaker");
  const ev = results.json.categories.find((c: any) => c.name === "Best Evaluator");
  check(ev.candidates.every((c: any) => c.winner), "Best Evaluator is a tie (both winners)");

  if (KEEP) {
    console.log(`\nKept campaign: ${BASE}/admin#/c/${id}  ·  voter link: ${BASE}/v/${slug}`);
  } else {
    check((await admin.req("DELETE", `/api/admin/campaigns/${id}`)).status === 200, "deletes the test campaign");
  }
  cleanup = null;
  check((await admin.req("POST", "/api/admin/logout")).status === 200, "signs out");

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch(async (err) => {
  if (cleanup && !KEEP) {
    await cleanup().catch(() => {});
    console.error("\n  (test campaign deleted)");
  }
  if (err instanceof CheckFailed) {
    console.error(`\nFailed after ${passed} passing checks.`);
  } else {
    console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
    console.error(`  Is the server running? Start it with: bun run dev`);
  }
  process.exit(1);
});
