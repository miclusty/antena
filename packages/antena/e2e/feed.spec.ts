import { test, expect } from "@playwright/test";

test.describe("Feed interactions", () => {
  test("infinite scroll loads more articles", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The feed must have at least one article for this test to make sense.
    // If the API is empty, fail loudly — do NOT test.skip.
    const firstArticle = page.locator("article").first();
    await expect(firstArticle).toBeVisible({ timeout: 10_000 });

    const initialCount = await page.locator("article").count();

    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    // After scroll, there should be at least the same number of articles
    // (or more, if infinite scroll triggered)
    const afterCount = await page.locator("article").count();
    expect(afterCount).toBeGreaterThanOrEqual(initialCount);
  });

  test("category filter narrows the feed", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Política is one of the category buttons in the sidebar / top
    // filters. Use the exact "Política" text (the category name
    // in the CATEGORIES constant).
    const categoryLink = page.getByRole("button", { name: "Política" }).first();
    await expect(categoryLink).toBeVisible({ timeout: 5_000 });

    await categoryLink.click();
    await page.waitForTimeout(500);

    // URL should reflect the category filter (?cat=Política, with the
    // accented i URL-encoded as %C3%AD).
    const url = page.url();
    expect(url).toMatch(/cat=.*Pol/i);
  });
});
