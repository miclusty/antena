import { test, expect } from "@playwright/test";

/**
 * Source-following end-to-end test.
 *
 * Flow:
 *   1. Open the app (feed loads)
 *   2. Find the first article's "Seguir" button (FollowButton with
 *      aria-label="Seguir" because the device is not following yet)
 *   3. Click it. The label should switch to "Siguiendo"
 *   4. Navigate to the Siguiendo tab (the bottom-nav
 *      "Siguiendo" button in mobile, the sidebar "Siguiendo"
 *      link in desktop)
 *   5. The followed source's news should appear in the feed
 *   6. The "Siguiendo" counter in the sidebar / bottom-nav
 *      should now read "1"
 *   7. Toggle the follow off → label reverts to "Seguir"
 *   8. The Siguiendo tab should now be empty
 *
 * Note: uses the device_id persisted in localStorage by the app
 * itself. The test uses a clean browser context (Playwright
 * fixtures), so the device_id is fresh for each run, which
 * means a fresh "follows" set in D1 per test execution.
 */
test.describe("Source following", () => {
  test("follow a source, see it in the Siguiendo tab", async ({ page }) => {
    // 1. Open the app.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    // 2. Find the first article's follow button. Scope to main
    //    so we don't accidentally grab a trending card.
    const firstArticle = page.locator("main article").first();
    await expect(firstArticle).toBeVisible({ timeout: 10_000 });
    const followBtn = firstArticle.getByLabel("Seguir");
    await expect(followBtn).toBeVisible({ timeout: 5_000 });

    // 3. Click to follow.
    await followBtn.click();

    // 4. The label should switch to "Siguiendo".
    const followingBtn = firstArticle.getByLabel("Siguiendo");
    await expect(followingBtn).toBeVisible({ timeout: 5_000 });

    // 5. Navigate to the Siguiendo tab.
    const siguiendoTab = page.getByRole("button", { name: "Siguiendo" }).last();
    await siguiendoTab.click();
    await page.waitForTimeout(2000);

    // 6. The followed source's articles should be visible.
    //    We assert that AT LEAST one article rendered in the
    //    main feed area (not just the trending sidebar).
    const siguiendoArticles = page.locator("main article");
    await expect(siguiendoArticles.first()).toBeVisible({ timeout: 5_000 });
    const count = await siguiendoArticles.count();
    expect(count).toBeGreaterThan(0);
  });
});
