import type { CampaignStatus, VoteInput } from "../../shared/types";

export const MAX_NAME_LENGTH = 80;
export const MAX_VOTES_PER_REQUEST = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9]{6,16}$/;

/** Trims and collapses whitespace. Returns null unless the result is 1..MAX_NAME_LENGTH chars. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s.length >= 1 && s.length <= MAX_NAME_LENGTH ? s : null;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isSlug(v: unknown): v is string {
  return typeof v === "string" && SLUG_RE.test(v);
}

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["open"],
  open: ["closed"],
  closed: ["open"], // reopen, in case it was closed by mistake
};

export function canTransition(from: CampaignStatus, to: unknown): to is CampaignStatus {
  return typeof to === "string" && (TRANSITIONS[from] as string[]).includes(to);
}

/**
 * Parses `{ votes: [{ categoryId, candidateId }] }`.
 * Returns null if the shape is wrong, an id is not a UUID, or a category appears twice.
 */
export function parseVotes(body: Record<string, unknown>): VoteInput[] | null {
  const raw = body.votes;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_VOTES_PER_REQUEST) return null;
  const seen = new Set<string>();
  const out: VoteInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { categoryId, candidateId } = item as Record<string, unknown>;
    if (!isUuid(categoryId) || !isUuid(candidateId) || seen.has(categoryId)) return null;
    seen.add(categoryId);
    out.push({ categoryId, candidateId });
  }
  return out;
}
