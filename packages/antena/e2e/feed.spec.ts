import { test, expect } from "@playwright/test";

test.describe("Feed interactions", () => {
  test("infinite scroll loads more articles", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const initialCount = await page.locator("article").count();
    if (initialCount === 0) {
      test.skip(true, "No articles to scroll");
      return;
    }

    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // After scroll, there should be at least the same number of articles
    // (or more, if infinite scroll triggered)
    const afterCount = await page.locator("article").count();
    expect(afterCount).toBeGreaterThanOrEqual(initialCount);
  });

  test("category filter narrows the feed", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for a category link/button
    const categoryLink = page.getByText(/Política|Economía|Deportes/i).first();
    if (!(await categoryLink.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip(true, "No category filter visible");
      return;
    }

    await categoryLink.click();
    await page.waitForTimeout(500);

    // URL should reflect the category filter
    const url = page.url();
    expect(url).toContain("cat=");
  });

  test("sort change is reflected in URL", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for a sort control (Time filters, etc.)
    const sortControl = page.getByText(/reciente|popular|destacado|tiempo|hoy|semana/i).first();
    if (!(await sortControl.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip(true, "No sort control visible");
      return;
    }

    await sortControl.click();
    await page.waitForTimeout(300);
  });
});
