import { describe, expect, it } from "vitest";
import { runSeoHealthCheck } from "../lib/seo-monitor";

describe("seo-monitor", () => {
  it("runs all 11 checks and returns a summary", async () => {
    const result = await runSeoHealthCheck({});
    expect(result.results).toHaveLength(11);
    expect(result.ok + result.fail).toBe(11);
    for (const r of result.results) {
      expect(r.name).toBeTruthy();
      expect(typeof r.pass).toBe("boolean");
      expect(r.detail).toBeTruthy();
      expect(r.duration_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("is tolerant of trailing slash differences in extracted canonical/og:url", async () => {
    const result = await runSeoHealthCheck({});
    const canonical = result.results.find(r => r.name === "home_canonical_www");
    const og = result.results.find(r => r.name === "home_og_url_www");
    expect(canonical).toBeDefined();
    expect(og).toBeDefined();
    // Both should pass: actual emits without trailing slash,
    // expect is `${SITE}/` with trailing slash. The check
    // normalizes both before comparing.
    expect(canonical?.pass).toBe(true);
    expect(og?.pass).toBe(true);
  });
});
