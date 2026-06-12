import { env, SELF, fetchMock } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("/api/img/:hash", () => {
  beforeEach(() => {
    fetchMock.activate();
  });

  it("returns 200 when image exists in R2", async () => {
    // Stub R2.get to return a fake image
    const fakeObject = {
      body: "fake-image-bytes",
      httpMetadata: { contentType: "image/jpeg" },
      etag: "etag-1",
      size: 16,
      key: "abc",
      version: "v1",
      storageClass: "Standard",
      uploaded: new Date(),
      httpEtag: "etag-1",
      customMetadata: undefined,
      writeHttpMetadata: () => {},
    } as unknown as R2ObjectBody;
    const getSpy = vi.spyOn(env.IMAGES, "get").mockResolvedValue(fakeObject);

    // Stub the cloudflare R2 fetch
    fetchMock
      .get("https://antena-images.r2.cloudflarestorage.com")
      .intercept({ path: () => true })
      .reply(200, "fake-image-bytes", { headers: { "content-type": "image/jpeg" } });

    const res = await SELF.fetch("http://example.com/api/img/abc123");
    expect(res.status).toBe(200);

    getSpy.mockRestore();
  });

  it("returns 404 when image not in R2", async () => {
    const getSpy = vi.spyOn(env.IMAGES, "get").mockResolvedValue(null);

    const res = await SELF.fetch("http://example.com/api/img/notfound");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; hash: string };
    expect(body.error).toContain("not yet available");
    expect(body.hash).toBe("notfound");

    getSpy.mockRestore();
  });

  it("returns 400 on invalid w param", async () => {
    const res = await SELF.fetch("http://example.com/api/img/abc?w=10");
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid fmt param", async () => {
    const res = await SELF.fetch("http://example.com/api/img/abc?fmt=png");
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid fit param", async () => {
    const res = await SELF.fetch("http://example.com/api/img/abc?fit=fill");
    expect(res.status).toBe(400);
  });

  it("accepts valid params (returns 404 when not in R2)", async () => {
    const getSpy = vi.spyOn(env.IMAGES, "get").mockResolvedValue(null);

    const res = await SELF.fetch("http://example.com/api/img/abc?w=800&fmt=webp&fit=cover");
    expect(res.status).toBe(404);

    getSpy.mockRestore();
  });
});
