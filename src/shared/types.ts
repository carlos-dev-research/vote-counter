/** Types shared by the worker (src/worker) and the browser scripts (src/client). */

export type CampaignStatus = "draft" | "open" | "closed";

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  status: CampaignStatus;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
}

export interface CandidateView {
  id: string;
  name: string;
  votes: number;
}

export interface CategoryView {
  id: string;
  name: string;
  candidates: CandidateView[];
}

/** Ballot as shown to voters while open: no counts. */
export interface BallotCategory {
  id: string;
  name: string;
  candidates: { id: string; name: string }[];
}

export interface ResultCategory {
  id: string;
  name: string;
  totalVotes: number;
  /** Sorted by votes, descending. `winner` is true for every top candidate with > 0 votes (ties). */
  candidates: (CandidateView & { winner: boolean })[];
}

export interface VoteInput {
  categoryId: string;
  candidateId: string;
}

/** categoryId -> candidateId this device voted for. */
export type MyVotes = Record<string, string>;

// ── API responses ──────────────────────────────────────────────────────────

export interface AdminCampaignList {
  campaigns: (Campaign & { voters: number })[];
}

export interface AdminCampaignDetail {
  campaign: Campaign;
  categories: CategoryView[];
  voters: number;
  voteUrl: string;
}

export type PublicCampaign =
  | { status: "draft"; name: string }
  | { status: "open"; name: string; categories: BallotCategory[]; myVotes: MyVotes }
  | { status: "closed"; name: string; voters: number; categories: ResultCategory[] };

export interface ApiErrorBody {
  error: string;
}
