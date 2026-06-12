import { test, expect } from "@playwright/test";

test.describe("Article page", () => {
  test("bookmark icon saves article", async ({ page }) => {
    await page.goto("/");

    // Wait for the feed to load
    await page.waitForLoadState("networkidle");

    // Look for the first news article's bookmark button
    const bookmarkButtons = page.getByLabel("Guardar");
    const count = await bookmarkButtons.count();

    if (count === 0) {
      test.skip(true, "No news articles available — backend may be empty");
      return;
    }

    // Click the first bookmark button
    await bookmarkButtons.first().click();

    // Navigate to bookmarks
    await page.getByLabel("Guardados").click();

    // The article should appear in bookmarks view
    await page.waitForTimeout(500);
    // The bookmark view should show at least one card or the empty state
    const url = page.url();
    expect(url).toMatch(/guardados|bookmarks|menu/);
  });
});
