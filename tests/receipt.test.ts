import { describe, expect, it } from "vitest";
import { hashReceiptSecret, isReceiptSecret, newReceiptSecret, receiptText } from "../src/domain/receipt.ts";
import { en } from "../src/web/i18n/en.ts";

describe("receipt secrets", () => {
  it("are 256-bit, prefixed and different every time", () => {
    const a = newReceiptSecret();
    const b = newReceiptSecret();
    expect(a).toMatch(/^gds1_[A-Za-z0-9_-]{43}$/);
    expect(isReceiptSecret(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("rejects anything else", () => {
    for (const value of ["", "gds1_short", `gds2_${"a".repeat(43)}`, `gds1_${"a".repeat(42)}=`, `gds1_${"a".repeat(44)}`]) {
      expect(isReceiptSecret(value)).toBe(false);
    }
  });

  it("hash to a stable value that doesn't contain the secret", async () => {
    const secret = newReceiptSecret();
    const hash = await hashReceiptSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashReceiptSecret(secret)).toBe(hash);
    expect(hash).not.toContain(secret.slice(5, 15));
  });

  it("are written into a receipt with a warning", () => {
    const text = receiptText("gds1_x", "https://stats.example", new Date(Date.UTC(2026, 9, 4)), en.receiptFile);
    expect(text).toContain("Receipt: gds1_x");
    expect(text).toContain("Keep this private");
    expect(text).toContain("2026-10-04T00:00:00.000Z");
  });
});
