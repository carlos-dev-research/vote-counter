import { Hono } from "hono";
import type { PublicCampaign } from "../../shared/types";
import type { AppEnv } from "../env";
import { checkVotes, toBallot, toResults } from "../lib/ballot";
import * as db from "../lib/db";
import { deviceId } from "../lib/device";
import { fail, readJson } from "../lib/http";
import { isSlug, parseVotes } from "../lib/validate";

/** Voter-facing API. No login; every request gets a signed device-ID cookie. */
export const publicRoutes = new Hono<AppEnv>();

publicRoutes.use("*", deviceId);

/** Draft → name only. Open → ballot + this device's votes (no counts). Closed → results. */
publicRoutes.get("/campaigns/:slug", async (c) => {
  const slug = c.req.param("slug");
  const campaign = isSlug(slug) ? await db.getCampaignBySlug(c.env.DB, slug) : null;
  if (!campaign) return fail(c, 404, "Campaign not found");

  let body: PublicCampaign;
  if (campaign.status === "draft") {
    body = { status: "draft", name: campaign.name };
  } else if (campaign.status === "open") {
    const [categories, myVotes] = await Promise.all([
      db.getCategoriesWithCounts(c.env.DB, campaign.id),
      db.getDeviceVotes(c.env.DB, campaign.id, c.var.deviceId),
    ]);
    body = { status: "open", name: campaign.name, categories: toBallot(categories), myVotes };
  } else {
    const [categories, voters] = await Promise.all([
      db.getCategoriesWithCounts(c.env.DB, campaign.id),
      db.countVoters(c.env.DB, campaign.id),
    ]);
    body = { status: "closed", name: campaign.name, voters, categories: toResults(categories) };
  }
  return c.json(body);
});

/** Body: { votes: [{ categoryId, candidateId }] }. 409 if closed or already voted in a category. */
publicRoutes.post("/campaigns/:slug/votes", async (c) => {
  const slug = c.req.param("slug");
  const campaign = isSlug(slug) ? await db.getCampaignBySlug(c.env.DB, slug) : null;
  if (!campaign) return fail(c, 404, "Campaign not found");
  if (campaign.status !== "open") {
    return fail(c, 409, campaign.status === "closed" ? "Voting is closed" : "Voting has not started");
  }

  const body = await readJson(c);
  const votes = body && parseVotes(body);
  if (!votes) return fail(c, 400, "Invalid ballot");

  const categories = await db.getCategoriesWithCounts(c.env.DB, campaign.id);
  const problem = checkVotes(categories, votes);
  if (problem) return fail(c, 400, problem);

  const myVotes = await db.getDeviceVotes(c.env.DB, campaign.id, c.var.deviceId);
  if (votes.some((v) => v.categoryId in myVotes)) {
    return fail(c, 409, "You have already voted in one of these categories");
  }
  // The UNIQUE constraint is the real guard (covers two requests racing each other).
  if (!(await db.insertVotes(c.env.DB, campaign.id, c.var.deviceId, votes))) {
    return fail(c, 409, "You have already voted in one of these categories");
  }
  return c.json({ ok: true }, 201);
});
