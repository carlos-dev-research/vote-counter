/**
 * Every D1 query lives here. Rule: user input only ever goes through .bind(?) parameters,
 * never into the SQL string.
 */
import type { Campaign, CampaignStatus, CategoryView, MyVotes, VoteInput } from "../../shared/types";
import { buildCategories, type CandidateRow, type CategoryRow } from "./ballot";
import { randomSlug } from "./crypto";

const now = () => new Date().toISOString();

// ── Campaigns ──────────────────────────────────────────────────────────────

export async function listCampaigns(db: D1Database): Promise<(Campaign & { voters: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(DISTINCT v.device_id) FROM votes v WHERE v.campaign_id = c.id) AS voters
         FROM campaigns c
        ORDER BY c.created_at DESC`,
    )
    .all<Campaign & { voters: number }>();
  return results;
}

export async function createCampaign(db: D1Database, name: string): Promise<Campaign> {
  const campaign: Campaign = {
    id: crypto.randomUUID(),
    slug: randomSlug(),
    name,
    status: "draft",
    created_at: now(),
    opened_at: null,
    closed_at: null,
  };
  await db
    .prepare(`INSERT INTO campaigns (id, slug, name, status, created_at) VALUES (?, ?, ?, 'draft', ?)`)
    .bind(campaign.id, campaign.slug, campaign.name, campaign.created_at)
    .run();
  return campaign;
}

export function getCampaignById(db: D1Database, id: string): Promise<Campaign | null> {
  return db.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(id).first<Campaign>();
}

export function getCampaignBySlug(db: D1Database, slug: string): Promise<Campaign | null> {
  return db.prepare(`SELECT * FROM campaigns WHERE slug = ?`).bind(slug).first<Campaign>();
}

export async function setCampaignStatus(db: D1Database, id: string, status: CampaignStatus): Promise<void> {
  if (status === "open") {
    await db
      .prepare(`UPDATE campaigns SET status = 'open', opened_at = ?, closed_at = NULL WHERE id = ?`)
      .bind(now(), id)
      .run();
  } else if (status === "closed") {
    await db.prepare(`UPDATE campaigns SET status = 'closed', closed_at = ? WHERE id = ?`).bind(now(), id).run();
  }
}

export async function deleteCampaign(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM campaigns WHERE id = ?`).bind(id).run(); // cascades
}

// ── Categories and candidates ──────────────────────────────────────────────

/** All categories of a campaign with their candidates and vote counts, in display order. */
export async function getCategoriesWithCounts(db: D1Database, campaignId: string): Promise<CategoryView[]> {
  const [cats, cands] = await db.batch([
    db
      .prepare(`SELECT id, name FROM categories WHERE campaign_id = ? ORDER BY position, rowid`)
      .bind(campaignId),
    db
      .prepare(
        `SELECT cd.id, cd.category_id, cd.name, COUNT(v.id) AS votes
           FROM candidates cd
           JOIN categories ct ON ct.id = cd.category_id
           LEFT JOIN votes v ON v.candidate_id = cd.id
          WHERE ct.campaign_id = ?
          GROUP BY cd.id
          ORDER BY cd.position, cd.rowid`,
      )
      .bind(campaignId),
  ]);
  return buildCategories(
    (cats?.results ?? []) as CategoryRow[],
    (cands?.results ?? []) as CandidateRow[],
  );
}

export async function addCategory(db: D1Database, campaignId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO categories (id, campaign_id, name, position)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM categories WHERE campaign_id = ?))`,
    )
    .bind(id, campaignId, name, campaignId)
    .run();
  return id;
}

/** The category plus the status of its campaign (used for edit rules). */
export function getCategoryContext(
  db: D1Database,
  id: string,
): Promise<{ id: string; campaign_id: string; status: CampaignStatus } | null> {
  return db
    .prepare(
      `SELECT ct.id, ct.campaign_id, cp.status
         FROM categories ct JOIN campaigns cp ON cp.id = ct.campaign_id
        WHERE ct.id = ?`,
    )
    .bind(id)
    .first();
}

export async function deleteCategory(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run();
}

export async function addCandidate(db: D1Database, categoryId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO candidates (id, category_id, name, position)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM candidates WHERE category_id = ?))`,
    )
    .bind(id, categoryId, name, categoryId)
    .run();
  return id;
}

/** The candidate plus the status of its campaign (used for edit rules). */
export function getCandidateContext(
  db: D1Database,
  id: string,
): Promise<{ id: string; campaign_id: string; status: CampaignStatus } | null> {
  return db
    .prepare(
      `SELECT cd.id, ct.campaign_id, cp.status
         FROM candidates cd
         JOIN categories ct ON ct.id = cd.category_id
         JOIN campaigns cp ON cp.id = ct.campaign_id
        WHERE cd.id = ?`,
    )
    .bind(id)
    .first();
}

export async function deleteCandidate(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM candidates WHERE id = ?`).bind(id).run();
}

// ── Votes ──────────────────────────────────────────────────────────────────

export async function countVoters(db: D1Database, campaignId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(DISTINCT device_id) AS n FROM votes WHERE campaign_id = ?`)
    .bind(campaignId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getDeviceVotes(db: D1Database, campaignId: string, deviceId: string): Promise<MyVotes> {
  const { results } = await db
    .prepare(`SELECT category_id, candidate_id FROM votes WHERE campaign_id = ? AND device_id = ?`)
    .bind(campaignId, deviceId)
    .all<{ category_id: string; candidate_id: string }>();
  return Object.fromEntries(results.map((r) => [r.category_id, r.candidate_id]));
}

/**
 * Inserts all votes atomically (D1 batch = one transaction). Returns false if the device already
 * voted in one of the categories (UNIQUE(category_id, device_id)); in that case nothing is saved.
 */
export async function insertVotes(
  db: D1Database,
  campaignId: string,
  deviceId: string,
  votes: VoteInput[],
): Promise<boolean> {
  const createdAt = now();
  const stmt = db.prepare(
    `INSERT INTO votes (id, campaign_id, category_id, candidate_id, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  try {
    await db.batch(
      votes.map((v) => stmt.bind(crypto.randomUUID(), campaignId, v.categoryId, v.candidateId, deviceId, createdAt)),
    );
    return true;
  } catch (err) {
    if (String(err).includes("UNIQUE constraint failed")) return false;
    throw err;
  }
}
