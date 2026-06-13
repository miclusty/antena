import { test, expect } from "@playwright/test";

/**
 * Happy-path end-to-end test for the Antena app.
 *
 * Flow: home → feed → click article → save bookmark → check
 * bookmarks view → unbookmark → verify removed.
 *
 * Requires the dev server (with a live API) running on
 * http://localhost:4321. The `webServer` config in
 * playwright.config.ts auto-starts it when CI=true.
 *
 * For local dev:
 *   1. `pnpm --filter api dev`  (in one terminal)
 *   2. `pnpm --filter antena dev`  (in another)
 *   3. `pnpm --filter antena exec playwright test e2e/happy-path.spec.ts`
 */
test.describe("Happy path", () => {
  test.beforeEach(async ({ page }) => {
    // Always start with a clean bookmarks state so the test
    // is deterministic regardless of previous runs.
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("antena-bookmarks"));
  });

  test("feed → bookmark → article → unbookmark → bookmarks view", async ({ page }) => {
    // 1. Home loads with the bottom nav (smoke contract).
    await page.goto("/");
    await expect(page.getByLabel("Inicio")).toBeVisible();
    await expect(page.getByLabel("Guardados").first()).toBeVisible();

    // 2. Wait for the feed to populate.
    await page.waitForLoadState("networkidle");

    // 3. The feed must have at least one article for the flow to make sense.
    //    If the API is empty, fail loudly — do NOT test.skip, because
    //    a working happy-path test is the point.
    const firstArticle = page.locator("article").first();
    await expect(firstArticle).toBeVisible({ timeout: 10_000 });

    // 4. Capture the article title so we can verify it later in the
    //    bookmarks view.
    const titleLocator = firstArticle.locator("h2, h3").first();
    const articleTitle = await titleLocator.textContent();
    expect(articleTitle?.trim().length).toBeGreaterThan(0);

    // 5. Bookmark from the feed card (the bookmark button is in
    //    the NewsCard's action bar, aria-label="Guardar").
    const bookmarkButton = firstArticle.getByLabel("Guardar");
    await expect(bookmarkButton).toBeVisible();
    await bookmarkButton.click();
    await page.waitForTimeout(300);

    // 6. localStorage should now have one bookmark.
    const bookmarksAfterSave = await page.evaluate(() => {
      const raw = localStorage.getItem("antena-bookmarks");
      return raw ? (JSON.parse(raw) as string[]) : [];
    });
    expect(bookmarksAfterSave.length).toBe(1);

    // 7. Click the article to open the detail view.
    await firstArticle.click();
    await page.waitForURL(/[?&]view=article/, { timeout: 5_000 });

    // 8. The article detail shows the same title we captured.
    await expect(page.getByRole("heading", { name: articleTitle! })).toBeVisible();

    // 9. Go back to the feed (article detail hides the bottom nav).
    await page.getByLabel("Volver").click();
    await page.waitForURL((url) => !url.searchParams.has("view"), { timeout: 5_000 });
    await page.waitForLoadState("networkidle");

    // 10. Navigate to the Bookmarks view via the bottom nav.
    //     Use the bottom-nav instance (last one in the DOM) because the
    //     sidebar also has a "Guardados" link in desktop layouts.
    await page.getByLabel("Guardados").last().click();
    await page.waitForTimeout(500);

    // 10. The bookmarked article appears in the Guardados view.
    //     (The card title is rendered as a heading; matches by name.)
    await expect(page.getByRole("heading", { name: articleTitle! })).toBeVisible();

    // 11. The "Limpiar" button is visible because we have ≥1 bookmark.
    await expect(page.getByText("Limpiar")).toBeVisible();

    // 12. Find the saved card in the bookmarks view and unbookmark
    //     from there. NewsCard's "Guardar" button is a toggle.
    const savedCard = page.locator("article").first();
    await expect(savedCard).toBeVisible();
    await savedCard.getByLabel("Guardar").click();
    await page.waitForTimeout(300);

    // 13. localStorage should now be empty.
    const bookmarksAfterRemove = await page.evaluate(() => {
      const raw = localStorage.getItem("antena-bookmarks");
      return raw ? (JSON.parse(raw) as string[]) : [];
    });
    expect(bookmarksAfterRemove.length).toBe(0);

    // 14. Bookmarks view should now show the empty state.
    await page.waitForTimeout(300);
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toMatch(/No tenes noticias|guardadas/i);
  });

  test("bookmarks persist across page reloads", async ({ page }) => {
    // 1. Pre-seed a bookmark.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "antena-bookmarks",
        JSON.stringify(["test-article-1", "test-article-2"]),
      );
    });

    // 2. Reload — bookmarks should survive.
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 3. Open Guardados.
    await page.getByLabel("Guardados").click();
    await page.waitForTimeout(300);

    // 4. Limpiar button is visible (we have 2 bookmarks).
    await expect(page.getByText("Limpiar")).toBeVisible();
  });

  test("Limpiar empties the bookmarks list", async ({ page }) => {
    // 1. Pre-seed.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem(
        "antena-bookmarks",
        JSON.stringify(["a", "b", "c"]),
      );
    });

    // 2. Open Guardados.
    await page.getByLabel("Guardados").click();
    await page.waitForTimeout(300);

    // 3. Click Limpiar (the button clears the list after a confirm).
    //    Use a window.confirm handler to auto-accept.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByText("Limpiar").click();
    await page.waitForTimeout(300);

    // 4. localStorage should be empty.
    const after = await page.evaluate(() => {
      const raw = localStorage.getItem("antena-bookmarks");
      return raw ? (JSON.parse(raw) as string[]) : [];
    });
    expect(after.length).toBe(0);
  });
});
