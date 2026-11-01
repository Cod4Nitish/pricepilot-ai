import { describe, expect, it } from "vitest";
import { canonicalUrl, looksLikeUrl, validateRetailerUrl } from "../ssrf";

describe("validateRetailerUrl", () => {
  it("accepts retailer https URLs and strips tracking", () => {
    const r = validateRetailerUrl("https://www.amazon.in/dp/B0CMDRCZBH?utm_source=x&ref_=abc&th=1#frag");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.retailer.id).toBe("amazon");
      expect(r.url).not.toContain("utm_source");
      expect(r.url).not.toContain("ref_");
      expect(r.url).not.toContain("#");
    }
  });
  it.each([
    "http://www.amazon.in/dp/B0CMDRCZBH",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://10.0.0.1/x",
    "https://2130706433/x",
    "https://metadata.google.internal/x",
    "https://evil.com/amazon.in",
    "https://amazon.in.evil.com/dp/B0CMDRCZBH",
    "https://user:pw@amazon.in/dp/B0CMDRCZBH",
    "https://amazon.in:8443/dp/B0CMDRCZBH",
    "ftp://amazon.in/x",
    "not a url",
  ])("rejects %s", (u) => {
    expect(validateRetailerUrl(u).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("canonicalUrl is stable", () => {
    expect(canonicalUrl("https://www.amazon.in/dp/B0CMDRCZBH/?utm_source=a")).toBe(canonicalUrl("https://www.amazon.in/dp/B0CMDRCZBH?ref_=z"));
  });
  it("looksLikeUrl", () => {
    expect(looksLikeUrl("https://flipkart.com/x")).toBe(true);
    expect(looksLikeUrl("iphone 15")).toBe(false);
  });
});
