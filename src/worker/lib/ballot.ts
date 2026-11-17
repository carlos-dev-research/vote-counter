import type {
  BallotCategory,
  CandidateView,
  CategoryView,
  ResultCategory,
  VoteInput,
} from "../../shared/types";

export interface CategoryRow {
  id: string;
  name: string;
}
export interface CandidateRow {
  id: string;
  category_id: string;
  name: string;
  votes: number;
}

/** Groups candidate rows under their categories, keeping the order of both inputs. */
export function buildCategories(categories: CategoryRow[], candidates: CandidateRow[]): CategoryView[] {
  const byCategory = new Map<string, CandidateView[]>();
  for (const cat of categories) byCategory.set(cat.id, []);
  for (const c of candidates) {
    byCategory.get(c.category_id)?.push({ id: c.id, name: c.name, votes: Number(c.votes) });
  }
  return categories.map((cat) => ({ id: cat.id, name: cat.name, candidates: byCategory.get(cat.id) ?? [] }));
}

/** Ballot for voters: same structure, counts removed. */
export function toBallot(categories: CategoryView[]): BallotCategory[] {
  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    candidates: cat.candidates.map(({ id, name }) => ({ id, name })),
  }));
}

/** Results: candidates sorted by votes (stable), every top candidate with > 0 votes is a winner. */
export function toResults(categories: CategoryView[]): ResultCategory[] {
  return categories.map((cat) => {
    const max = Math.max(0, ...cat.candidates.map((c) => c.votes));
    const sorted = [...cat.candidates].sort((a, b) => b.votes - a.votes);
    return {
      id: cat.id,
      name: cat.name,
      totalVotes: cat.candidates.reduce((sum, c) => sum + c.votes, 0),
      candidates: sorted.map((c) => ({ ...c, winner: max > 0 && c.votes === max })),
    };
  });
}

/** Returns an error message if any vote is for an unknown category or a candidate outside its category. */
export function checkVotes(categories: CategoryView[], votes: VoteInput[]): string | null {
  const candidatesByCategory = new Map(
    categories.map((cat) => [cat.id, new Set(cat.candidates.map((c) => c.id))]),
  );
  for (const v of votes) {
    const allowed = candidatesByCategory.get(v.categoryId);
    if (!allowed) return "Unknown category";
    if (!allowed.has(v.candidateId)) return "Candidate does not belong to that category";
  }
  return null;
}
