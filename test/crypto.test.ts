import { describe, expect, test } from "bun:test";
import { randomSlug, safeEqual, signValue, verifyValue } from "../src/worker/lib/crypto";

describe("signValue / verifyValue", () => {
  test("round-trips a value", async () => {
    const signed = await signValue("abc-123", "secret");
    expect(await verifyValue(signed, "secret")).toBe("abc-123");
  });
  test("rejects a wrong secret", async () => {
    expect(await verifyValue(await signValue("abc", "secret"), "other")).toBeNull();
  });
  test("rejects a tampered value", async () => {
    const signed = await signValue("1700000000", "secret");
    expect(await verifyValue(signed.replace("1700000000", "9999999999"), "secret")).toBeNull();
  });
  test("rejects garbage", async () => {
    expect(await verifyValue("no-dot", "secret")).toBeNull();
    expect(await verifyValue(".sig", "secret")).toBeNull();
  });
});

test("safeEqual", () => {
  expect(safeEqual("abc", "abc")).toBe(true);
  expect(safeEqual("abc", "abd")).toBe(false);
  expect(safeEqual("abc", "abcd")).toBe(false);
  expect(safeEqual("", "")).toBe(true);
});

test("randomSlug is 8 readable chars and varies", () => {
  const a = randomSlug();
  expect(a).toMatch(/^[a-z2-9]{8}$/);
  expect(a).not.toMatch(/[01oli]/);
  expect(new Set(Array.from({ length: 50 }, () => randomSlug())).size).toBe(50);
});
