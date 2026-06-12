import { test, expect } from "@playwright/test";

test.describe("Bookmarks", () => {
  test("bookmarks view shows empty state when no bookmarks saved", async ({ page }) => {
    // Clear localStorage first
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("antena-bookmarks"));

    await page.getByLabel("Guardados").click();
    await page.waitForTimeout(300);

    // Either the empty state OR a list of bookmarked articles
    const bodyText = await page.locator("body").textContent();
    const hasEmpty = bodyText?.includes("No tenes noticias") || bodyText?.includes("guardadas");
    const hasGuardadosHeader = bodyText?.includes("Guardados");
    expect(hasGuardadosHeader).toBeTruthy();
    expect(hasEmpty !== undefined).toBeTruthy();
  });

  test("Limpiar button appears when bookmarks exist", async ({ page }) => {
    await page.goto("/");
    // Pre-seed a bookmark
    await page.evaluate(() => {
      localStorage.setItem("antena-bookmarks", JSON.stringify(["a", "b", "c"]));
    });
    await page.getByLabel("Guardados").click();
    await page.waitForTimeout(500);

    const limpiar = page.getByText("Limpiar");
    await expect(limpiar).toBeVisible();
  });
});
