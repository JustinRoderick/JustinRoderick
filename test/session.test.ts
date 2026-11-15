import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../src/session.ts";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;

describe("session cookie", () => {
  it("verifies a cookie it signed until it expires", async () => {
    const value = await signSession(SECRET, NOW + 1000);
    expect(await verifySession(SECRET, value, NOW)).toBe(true);
    expect(await verifySession(SECRET, value, NOW + 999)).toBe(true);
    expect(await verifySession(SECRET, value, NOW + 1000)).toBe(false);
  });

  it("rejects a cookie signed with another secret", async () => {
    expect(await verifySession(SECRET, await signSession("other", NOW + 1000), NOW)).toBe(false);
  });

  it("rejects an extended expiry that keeps the old signature", async () => {
    const [, signature] = (await signSession(SECRET, NOW + 1000)).split(".");
    expect(await verifySession(SECRET, `${NOW + 10_000_000}.${signature}`, NOW)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const value = await signSession(SECRET, NOW + 1000);
    const flipped = value.slice(0, -1) + (value.endsWith("A") ? "B" : "A");
    expect(await verifySession(SECRET, flipped, NOW)).toBe(false);
  });

  it.each(["", "garbage", `${NOW + 1000}.`, `${NOW + 1000}.a`, `.${"A".repeat(43)}`, `${NOW + 1000}.***`])(
    "rejects the malformed value %j",
    async (value) => {
      expect(await verifySession(SECRET, value, NOW)).toBe(false);
    },
  );
});
