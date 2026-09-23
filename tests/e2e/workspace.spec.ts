import { test, expect, type Page } from "@playwright/test";
const suffix = Date.now().toString(36);
async function register(page: Page, name: string) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(name + suffix);
  await page.getByLabel("Email address").fill(`${name}${suffix}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("E2eTestPassword123!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your projects" }),
  ).toBeVisible();
}
test("two users collaborate, preview, snapshot, restore and enforce isolation", async ({
  browser,
}) => {
  const owner = await browser.newContext(),
    editor = await browser.newContext(),
    stranger = await browser.newContext();
  const a = await owner.newPage(),
    b = await editor.newPage(),
    c = await stranger.newPage();
  await register(a, "owner");
  await register(b, "editor");
  await register(c, "stranger");
  await a.getByRole("button", { name: "New project", exact: true }).click();
  await a.getByLabel("Project name").fill("E2E workspace");
  await a.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(
    a.getByRole("textbox", { name: "Editor content", exact: true }),
  ).toBeVisible();
  const url = a.url();
  await a.getByRole("button", { name: "Members", exact: true }).click();
  await a
    .getByLabel("Email", { exact: true })
    .fill(`editor${suffix}@example.test`);
  await a.getByRole("button", { name: "Add member", exact: true }).click();
  await expect(a.getByText("Member added", { exact: true })).toBeVisible();
  await b.goto(url);
  await expect(
    b.getByRole("textbox", { name: "Editor content", exact: true }),
  ).toBeVisible();
  const ea = a.getByRole("textbox", { name: "Editor content", exact: true }),
    eb = b.getByRole("textbox", { name: "Editor content", exact: true });
  await Promise.all([
    ea.press("ControlOrMeta+End"),
    eb.press("ControlOrMeta+End"),
  ]);
  await Promise.all([
    ea.pressSequentially("\n<!-- FROM_OWNER -->"),
    eb.pressSequentially("\n<!-- FROM_EDITOR -->"),
  ]);
  await expect
    .poll(async () => a.locator(".view-lines").innerText())
    .toContain("FROM_EDITOR");
  await expect
    .poll(async () => b.locator(".view-lines").innerText())
    .toContain("FROM_OWNER");
  await expect(
    a.locator('[class*="yRemoteSelectionHead-"]').first(),
  ).toBeVisible();
  const frame = a.frameLocator('iframe[title="Project preview"]');
  await frame.getByRole("button", { name: "Make it happen · 0" }).click();
  await expect(
    frame.getByRole("button", { name: "Make it happen · 1" }),
  ).toBeVisible();
  await expect(a.getByRole("log")).toContainText("You made it happen");
  await a.getByRole("button", { name: "Version history", exact: true }).click();
  await a.getByLabel("Snapshot message").fill("Working milestone");
  await a.getByRole("button", { name: "Create snapshot", exact: true }).click();
  await expect(a.getByText("Snapshot created", { exact: true })).toBeVisible();
  await ea.press("ControlOrMeta+End");
  await ea.pressSequentially("\n<!-- AFTER_SNAPSHOT -->");
  await expect(
    a.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(a.getByRole("dialog")).toBeVisible();
  await a.getByRole("button", { name: "Close dialog", exact: true }).click();
  await a
    .getByRole("button", { name: "Restore snapshot", exact: true })
    .click();
  await a
    .getByRole("dialog")
    .getByRole("button", { name: "Restore snapshot", exact: true })
    .click();
  await expect
    .poll(async () => a.locator(".view-lines").innerText())
    .not.toContain("AFTER_SNAPSHOT");
  await c.goto(url);
  await expect(
    c.getByRole("heading", { name: "Couldn’t open this project" }),
  ).toBeVisible();
  await owner.close();
  await editor.close();
  await stranger.close();
});
test("nested explorer, tabs, quick open and search", async ({ page }) => {
  await register(page, "files");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("File operations");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Editor content", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Path", { exact: true }).fill("src");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.getByLabel("Path", { exact: true }).fill("src/test.js");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "test.js", exact: true }).click();
  await expect(page.getByRole("tab", { name: "JS test.js" })).toBeVisible();
  await page.getByRole("button", { name: "Quick open", exact: true }).click();
  await page.getByLabel("Search commands or files").fill("styles");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "styles.css", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "# styles.css" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search workspace").fill("background");
  await expect(page.locator(".search-result").first()).toBeVisible();
});
