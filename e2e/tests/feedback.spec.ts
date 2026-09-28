import { asAdmin, asPlayer, expect, test } from "./fixtures";
import { PLAYER } from "../global-setup";

// specs/features/feedback.feature
test("Sending feedback, then admins triage it", async ({ browser }) => {
  const player = await (await browser.newContext(asPlayer)).newPage();
  await player.goto("/");
  await player.getByRole("button", { name: new RegExp(PLAYER.displayName) }).click();
  await player.getByRole("menuitem", { name: "Send feedback" }).click();
  const dialog = player.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Bug" }).click();
  await dialog.getByLabel("Your message").fill("The volume slider is hard to grab on phones (e2e)");
  await expect(dialog.getByText(/You can send \d more today\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(player.getByText("Thanks! Your feedback was sent.")).toBeVisible();

  const admin = await (await browser.newContext(asAdmin)).newPage();
  await admin.goto("/admin/feedback");
  await expect(admin.getByText(/\d+ unread/)).toBeVisible();
  const item = admin.getByRole("listitem").filter({ hasText: "The volume slider is hard to grab on phones (e2e)" });
  await item.getByRole("button", { name: "Vote up" }).click();
  await expect(item.getByText("1", { exact: true })).toBeVisible();
  await item.getByRole("button", { name: "Archive" }).click();
  await expect(admin.getByText("Archived", { exact: true }).first()).toBeVisible();
  await admin.getByRole("button", { name: "Archived" }).click();
  await expect(admin.getByText("The volume slider is hard to grab on phones (e2e)")).toBeVisible();

  await player.reload();
  await player.getByRole("button", { name: new RegExp(PLAYER.displayName) }).click();
  await player.getByRole("menuitem", { name: "Send feedback" }).click();
  await expect(player.getByRole("dialog").getByText("Archived", { exact: true })).toBeVisible();
});
