import { describe, expect, test } from "bun:test";
import { canTransition, cleanName, isSlug, isUuid, parseVotes } from "../src/worker/lib/validate";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("cleanName trims, collapses spaces, enforces length", () => {
  expect(cleanName("  Best   Speaker ")).toBe("Best Speaker");
  expect(cleanName("")).toBeNull();
  expect(cleanName("   ")).toBeNull();
  expect(cleanName("x".repeat(81))).toBeNull();
  expect(cleanName(42)).toBeNull();
  expect(cleanName("'); DROP TABLE votes;--")).toBe("'); DROP TABLE votes;--"); // stored as text, never SQL
});

test("isUuid / isSlug", () => {
  expect(isUuid(A)).toBe(true);
  expect(isUuid("not-a-uuid")).toBe(false);
  expect(isSlug("abcd2345")).toBe(true);
  expect(isSlug("../etc")).toBe(false);
});

test("canTransition follows the lifecycle", () => {
  expect(canTransition("draft", "open")).toBe(true);
  expect(canTransition("draft", "closed")).toBe(false);
  expect(canTransition("open", "closed")).toBe(true);
  expect(canTransition("open", "draft")).toBe(false);
  expect(canTransition("closed", "open")).toBe(true);
  expect(canTransition("open", "bogus")).toBe(false);
});

describe("parseVotes", () => {
  test("accepts a valid ballot", () => {
    expect(parseVotes({ votes: [{ categoryId: A, candidateId: B }] })).toEqual([{ categoryId: A, candidateId: B }]);
  });
  test("rejects bad shapes", () => {
    expect(parseVotes({})).toBeNull();
    expect(parseVotes({ votes: [] })).toBeNull();
    expect(parseVotes({ votes: "x" })).toBeNull();
    expect(parseVotes({ votes: [{ categoryId: "x", candidateId: B }] })).toBeNull();
    expect(parseVotes({ votes: [null] })).toBeNull();
  });
  test("rejects two votes in the same category", () => {
    expect(parseVotes({ votes: [{ categoryId: A, candidateId: B }, { categoryId: A, candidateId: A }] })).toBeNull();
  });
});
