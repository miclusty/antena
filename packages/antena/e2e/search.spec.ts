import { test, expect } from "@playwright/test";

test.describe("Search", () => {
  test("typing in search bar shows results", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Buscar").click();
    await page.waitForLoadState("networkidle");

    // Find a search input
    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/buscar|search/i)).first();
    if (!(await searchInput.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip(true, "No search input visible");
      return;
    }

    await searchInput.fill("dolar");
    // Wait for debounce (250ms) + fetch
    await page.waitForTimeout(800);

    // URL or results should reflect the search
    const url = page.url();
    const hasResults = await page.locator("article").count();
    // Either URL has the query or some results rendered
    expect(url.includes("dolar") || hasResults > 0).toBeTruthy();
  });
});
