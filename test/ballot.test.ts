import { expect, test } from "bun:test";
import { buildCategories, checkVotes, toBallot, toResults } from "../src/worker/lib/ballot";

const cats = buildCategories(
  [{ id: "c1", name: "Best Speaker" }, { id: "c2", name: "Best Evaluator" }, { id: "c3", name: "Empty" }],
  [
    { id: "a", category_id: "c1", name: "Ana", votes: 3 },
    { id: "b", category_id: "c1", name: "Ben", votes: 5 },
    { id: "x", category_id: "c2", name: "Xi", votes: 2 },
    { id: "y", category_id: "c2", name: "Yo", votes: 2 },
  ],
);

test("buildCategories groups candidates and keeps order", () => {
  expect(cats.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  expect(cats[0]?.candidates.map((c) => c.name)).toEqual(["Ana", "Ben"]);
  expect(cats[2]?.candidates).toEqual([]);
});

test("toBallot hides counts", () => {
  expect(JSON.stringify(toBallot(cats))).not.toContain("votes");
});

test("toResults sorts, totals and marks winners including ties", () => {
  const [speaker, evaluator, empty] = toResults(cats);
  expect(speaker?.candidates.map((c) => [c.name, c.winner])).toEqual([["Ben", true], ["Ana", false]]);
  expect(speaker?.totalVotes).toBe(8);
  expect(evaluator?.candidates.every((c) => c.winner)).toBe(true);
  expect(empty?.totalVotes).toBe(0);
});

test("toResults: zero votes means no winner", () => {
  const [r] = toResults(buildCategories([{ id: "c", name: "C" }], [{ id: "a", category_id: "c", name: "A", votes: 0 }]));
  expect(r?.candidates[0]?.winner).toBe(false);
});

test("checkVotes rejects candidates from another category", () => {
  expect(checkVotes(cats, [{ categoryId: "c1", candidateId: "a" }])).toBeNull();
  expect(checkVotes(cats, [{ categoryId: "c1", candidateId: "x" }])).toBe("Candidate does not belong to that category");
  expect(checkVotes(cats, [{ categoryId: "zz", candidateId: "a" }])).toBe("Unknown category");
});
