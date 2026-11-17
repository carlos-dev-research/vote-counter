import { Hono, type Context } from "hono";
import type { AdminCampaignDetail, AdminCampaignList } from "../../shared/types";
import type { AppEnv } from "../env";
import { checkCredentials, clearSession, issueSession, requireAdmin } from "../lib/auth";
import * as db from "../lib/db";
import { fail, readJson } from "../lib/http";
import { qrSvg } from "../lib/qr";
import { canTransition, cleanName, isUuid } from "../lib/validate";

/** Back office API under /api/admin. Everything except /login and /logout requires a session. */
export const adminRoutes = new Hono<AppEnv>();

const voteUrl = (c: Context, slug: string) => `${new URL(c.req.url).origin}/v/${slug}`;

// ── Session ────────────────────────────────────────────────────────────────

adminRoutes.post("/login", async (c) => {
  const body = await readJson(c);
  if (!body) return fail(c, 400, "Expected a JSON body");
  if (!checkCredentials(c.env, body.email, body.password)) {
    return fail(c, 401, "Invalid email or password");
  }
  await issueSession(c);
  return c.json({ ok: true });
});

adminRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

adminRoutes.use("*", requireAdmin);

adminRoutes.get("/session", (c) => c.json({ ok: true }));

// ── Campaigns ──────────────────────────────────────────────────────────────

adminRoutes.get("/campaigns", async (c) => {
  const body: AdminCampaignList = { campaigns: await db.listCampaigns(c.env.DB) };
  return c.json(body);
});

adminRoutes.post("/campaigns", async (c) => {
  const body = await readJson(c);
  const name = cleanName(body?.name);
  if (!name) return fail(c, 400, "Campaign name is required (max 80 characters)");
  const campaign = await db.createCampaign(c.env.DB, name);
  return c.json({ campaign }, 201);
});

adminRoutes.get("/campaigns/:id", async (c) => {
  const id = c.req.param("id");
  const campaign = isUuid(id) ? await db.getCampaignById(c.env.DB, id) : null;
  if (!campaign) return fail(c, 404, "Campaign not found");
  const [categories, voters] = await Promise.all([
    db.getCategoriesWithCounts(c.env.DB, id),
    db.countVoters(c.env.DB, id),
  ]);
  const body: AdminCampaignDetail = { campaign, categories, voters, voteUrl: voteUrl(c, campaign.slug) };
  return c.json(body);
});

adminRoutes.post("/campaigns/:id/status", async (c) => {
  const id = c.req.param("id");
  const campaign = isUuid(id) ? await db.getCampaignById(c.env.DB, id) : null;
  if (!campaign) return fail(c, 404, "Campaign not found");
  const body = await readJson(c);
  const to = body?.status;
  if (!canTransition(campaign.status, to)) {
    return fail(c, 409, `Cannot change status from ${campaign.status} to ${String(to)}`);
  }
  if (to === "open") {
    const categories = await db.getCategoriesWithCounts(c.env.DB, id);
    if (categories.length === 0) return fail(c, 409, "Add at least one category before opening");
    const empty = categories.find((cat) => cat.candidates.length === 0);
    if (empty) return fail(c, 409, `Add at least one candidate to "${empty.name}" before opening`);
  }
  await db.setCampaignStatus(c.env.DB, id, to);
  return c.json({ ok: true, status: to });
});

adminRoutes.delete("/campaigns/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return fail(c, 404, "Campaign not found");
  await db.deleteCampaign(c.env.DB, id);
  return c.json({ ok: true });
});

adminRoutes.get("/campaigns/:id/qr.svg", async (c) => {
  const id = c.req.param("id");
  const campaign = isUuid(id) ? await db.getCampaignById(c.env.DB, id) : null;
  if (!campaign) return fail(c, 404, "Campaign not found");
  return c.body(qrSvg(voteUrl(c, campaign.slug)), 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
  });
});

// ── Categories ─────────────────────────────────────────────────────────────

adminRoutes.post("/campaigns/:id/categories", async (c) => {
  const id = c.req.param("id");
  const campaign = isUuid(id) ? await db.getCampaignById(c.env.DB, id) : null;
  if (!campaign) return fail(c, 404, "Campaign not found");
  if (campaign.status === "closed") return fail(c, 409, "Campaign is closed");
  const name = cleanName((await readJson(c))?.name);
  if (!name) return fail(c, 400, "Category name is required (max 80 characters)");
  return c.json({ id: await db.addCategory(c.env.DB, id, name) }, 201);
});

adminRoutes.delete("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const ctx = isUuid(id) ? await db.getCategoryContext(c.env.DB, id) : null;
  if (!ctx) return fail(c, 404, "Category not found");
  if (ctx.status !== "draft") return fail(c, 409, "Categories can only be removed while the campaign is a draft");
  await db.deleteCategory(c.env.DB, id);
  return c.json({ ok: true });
});

// ── Candidates ─────────────────────────────────────────────────────────────

adminRoutes.post("/categories/:id/candidates", async (c) => {
  const id = c.req.param("id");
  const ctx = isUuid(id) ? await db.getCategoryContext(c.env.DB, id) : null;
  if (!ctx) return fail(c, 404, "Category not found");
  if (ctx.status === "closed") return fail(c, 409, "Campaign is closed");
  const name = cleanName((await readJson(c))?.name);
  if (!name) return fail(c, 400, "Candidate name is required (max 80 characters)");
  return c.json({ id: await db.addCandidate(c.env.DB, id, name) }, 201);
});

adminRoutes.delete("/candidates/:id", async (c) => {
  const id = c.req.param("id");
  const ctx = isUuid(id) ? await db.getCandidateContext(c.env.DB, id) : null;
  if (!ctx) return fail(c, 404, "Candidate not found");
  if (ctx.status !== "draft") return fail(c, 409, "Candidates can only be removed while the campaign is a draft");
  await db.deleteCandidate(c.env.DB, id);
  return c.json({ ok: true });
});
