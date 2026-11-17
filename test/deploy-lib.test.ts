import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DB_PLACEHOLDER,
  HOST_PLACEHOLDER,
  accountsFromWhoami,
  deployTag,
  destructiveStatements,
  findUuid,
  isEmail,
  isHostname,
  parseJsonc,
  pendingMigrations,
  setAccountId,
  setDatabaseId,
  setHostname,
  type WranglerConfig,
} from "../scripts/deploy-lib";

const real = readFileSync(join(import.meta.dir, "..", "wrangler.jsonc"), "utf8");

describe("wrangler.jsonc editing", () => {
  test("parses the real config", () => {
    const cfg = parseJsonc<WranglerConfig>(real);
    expect(cfg.name).toBe("vote-counter");
    expect(cfg.d1_databases[0]?.binding).toBe("DB");
  });

  test("fills placeholders and stays valid", () => {
    if (!real.includes(DB_PLACEHOLDER) || !real.includes(HOST_PLACEHOLDER)) return; // already configured
    let text = setDatabaseId(real, "11111111-2222-4333-8444-555555555555");
    text = setHostname(text, "vote.example.org");
    text = setAccountId(text, "0123456789abcdef0123456789abcdef");
    const cfg = parseJsonc<WranglerConfig>(text);
    expect(cfg.d1_databases[0]?.database_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(cfg.routes?.[0]).toEqual({ pattern: "vote.example.org", custom_domain: true });
    expect(cfg.account_id).toBe("0123456789abcdef0123456789abcdef");
    expect(text).toContain("// Secrets"); // comments preserved
  });

  test("setAccountId replaces an existing value", () => {
    const once = setAccountId('{\n  "name": "x",\n}', "a".repeat(32));
    expect(parseJsonc<WranglerConfig>(setAccountId(once, "b".repeat(32))).account_id).toBe("b".repeat(32));
  });

  test("refuses to edit when the placeholder is gone", () => {
    expect(() => setDatabaseId('{"database_id": "real"}', "x")).toThrow();
  });
});

test("isHostname wants a subdomain", () => {
  expect(isHostname("vote.example.org")).toBe(true);
  expect(isHostname("vote.club.co.uk")).toBe(true);
  expect(isHostname("example.org")).toBe(false);
  expect(isHostname("https://vote.example.org")).toBe(false);
  expect(isHostname("Vote.Example.org")).toBe(false);
});

test("isEmail", () => {
  expect(isEmail("a@b.co")).toBe(true);
  expect(isEmail("nope")).toBe(false);
});

test("pendingMigrations", () => {
  expect(pendingMigrations(["0002_b.sql", "0001_a.sql", "README.md"], ["0001_a.sql"])).toEqual(["0002_b.sql"]);
  expect(pendingMigrations(["0001_a.sql"], [])).toEqual(["0001_a.sql"]);
});

describe("destructiveStatements", () => {
  test("initial schema is additive", () => {
    const sql = readFileSync(join(import.meta.dir, "..", "migrations", "0001_init.sql"), "utf8");
    expect(destructiveStatements(sql)).toEqual([]);
  });
  test("flags data-changing statements", () => {
    expect(destructiveStatements("DROP TABLE votes;")).toEqual(["DROP TABLE"]);
    expect(destructiveStatements("ALTER TABLE votes DROP COLUMN x;")).toEqual(["ALTER TABLE … DROP"]);
    expect(destructiveStatements("delete from votes")).toEqual(["DELETE FROM"]);
    expect(destructiveStatements("UPDATE campaigns SET name = 'x'")).toEqual(["UPDATE … SET"]);
  });
  test("ignores comments and additive changes", () => {
    expect(destructiveStatements("-- DROP TABLE votes\nALTER TABLE votes ADD COLUMN note TEXT;")).toEqual([]);
    expect(destructiveStatements("/* DELETE FROM x */ CREATE INDEX i ON votes(device_id);")).toEqual([]);
  });
});

test("accountsFromWhoami tolerates shapes", () => {
  expect(accountsFromWhoami({ accounts: [{ id: "a".repeat(32), name: "Club" }] })).toEqual([{ id: "a".repeat(32), name: "Club" }]);
  expect(accountsFromWhoami({ loggedIn: false })).toEqual([]);
});

test("findUuid and deployTag", () => {
  expect(findUuid('database_id = "11111111-2222-4333-8444-555555555555"')).toBe("11111111-2222-4333-8444-555555555555");
  expect(findUuid("nothing")).toBeNull();
  expect(deployTag(new Date(Date.UTC(2026, 10, 16, 21, 5, 9)))).toBe("deploy-20261116-210509");
});
