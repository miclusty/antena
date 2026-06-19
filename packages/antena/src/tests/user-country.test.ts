import { describe, it, expect, beforeEach, vi } from "vitest";

describe("user-country", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "antena_country=; path=/; max-age=0";
    vi.resetModules();
  });

  it("loadUserCountry reads localStorage override and skips fetch", async () => {
    localStorage.setItem("antena.radio.country", "CL");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { loadUserCountry, country, isOverride } = await import("../lib/user-country");
    const code = await loadUserCountry();
    expect(code).toBe("CL");
    expect(country()).toBe("CL");
    expect(isOverride()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loadUserCountry falls back to /api/stats/radios/countries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        countries: [{ code: "AR", count: 818 }],
        total: 818,
        detected: "AR",
        override: null,
      }), { headers: { "Content-Type": "application/json" } }),
    );
    const { loadUserCountry, country, detectedCountry } = await import("../lib/user-country");
    const code = await loadUserCountry();
    expect(code).toBe("AR");
    expect(detectedCountry()).toBe("AR");
  });

  it("loadUserCountry default AR when fetch fails and no LS", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const { loadUserCountry, country } = await import("../lib/user-country");
    const code = await loadUserCountry();
    expect(code).toBe("AR");
    expect(country()).toBe("AR");
  });

  it("setUserCountry writes localStorage and cookie", async () => {
    const { setUserCountry, country } = await import("../lib/user-country");
    setUserCountry("US");
    expect(localStorage.getItem("antena.radio.country")).toBe("US");
    expect(document.cookie).toContain("antena_country=US");
    expect(country()).toBe("US");
  });

  it("setUserCountry rejects malformed codes", async () => {
    const { setUserCountry, country } = await import("../lib/user-country");
    setUserCountry("invalid");
    expect(localStorage.getItem("antena.radio.country")).toBeNull();
    expect(country()).toBe("AR");
  });

  it("clearUserCountry removes localStorage + cookie", async () => {
    localStorage.setItem("antena.radio.country", "CL");
    document.cookie = "antena_country=CL; path=/";
    const { clearUserCountry } = await import("../lib/user-country");
    clearUserCountry();
    expect(localStorage.getItem("antena.radio.country")).toBeNull();
    expect(document.cookie.includes("antena_country=CL")).toBe(false);
  });
});
