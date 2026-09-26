import { expect, test } from "./fixtures";

// specs/features/pagination.feature
test("Paging through a long queue", async ({ page }) => {
  await page.goto("/r/e2e-paging");
  await expect(page.getByRole("tab", { name: "Up next (25)" })).toBeVisible();
  await expect(page.getByText("1–20 of 25 songs")).toBeVisible();
  await expect(page.getByText("Paging Song 01", { exact: true })).toBeVisible();
  await expect(page.getByText("Paging Song 21", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("21–25 of 25 songs")).toBeVisible();
  await expect(page.getByText("Paging Song 21", { exact: true })).toBeVisible();
  await expect(page.getByText("Paging Song 01", { exact: true })).toHaveCount(0);
  await page.getByLabel("Per page").selectOption("50");
  await expect(page.getByText("1–25 of 25 songs")).toBeVisible();
});
