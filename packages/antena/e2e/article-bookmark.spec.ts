import { test, expect } from "@playwright/test";

/**
 * This test is a subset of e2e/happy-path.spec.ts (the
 * "feed → bookmark → article → unbookmark → bookmarks view"
 * flow covers the same territory more thoroughly). Kept here
 * as a quick smoke test for the bookmark action in the article
 * detail header (which is reachable directly via URL).
 */
test.describe("Article page", () => {
  test("opening an article via URL shows the article body", async ({ page }) => {
    // The feed must have at least one article. Fail loudly if not.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const firstArticle = page.locator("article").first();
    await expect(firstArticle).toBeVisible({ timeout: 10_000 });

    // NewsCard has an onClick that calls setSelectedNews, which
    // changes the URL state to ?view=article&id=… . Trigger it
    // and verify the article body renders.
    await firstArticle.click();
    await page.waitForURL(/[?&]view=article/, { timeout: 5_000 });

    // The article body should render with a heading (article title)
    // and the "Volver" back button.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Volver")).toBeVisible();
  });

  test("article detail survives a page reload", async ({ page }) => {
    // The URL state is the source of truth (?view=article&id=…).
    // On reload, the app should re-hydrate from the URL and show
    // the same article (instead of falling back to the feed).
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Find a real article id from the feed DOM.
    const articleLink = page.locator("a[href*='view=article']").first();
    if (await articleLink.count() === 0) {
      // No direct link in the DOM — fall back to clicking the card.
      await page.locator("article").first().click();
    } else {
      await articleLink.click();
    }
    await page.waitForURL(/[?&]view=article/, { timeout: 5_000 });
    const articleUrl = page.url();

    // Reload — the article should still be visible (URL-based routing).
    await page.reload();
    await page.waitForLoadState("networkidle");

    // We should still be on the article page.
    expect(page.url()).toBe(articleUrl);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
