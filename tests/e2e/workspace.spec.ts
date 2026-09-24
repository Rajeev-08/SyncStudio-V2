
import { test, expect, type Page } from "@playwright/test";

const suffix = Date.now().toString(36);

async function register(page: Page, name: string) {
  await page.goto("/register");

  await page.getByLabel("Username").fill(name + suffix);

  await page
    .getByLabel("Email address")
    .fill(`${name}${suffix}@example.test`);

  await page
    .getByLabel("Password", { exact: true })
    .fill("E2eTestPassword123!");

  await page
    .getByRole("button", {
      name: "Create account",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "Your projects",
    }),
  ).toBeVisible();
}

async function createProject(
  page: Page,
  projectName: string,
) {
  await page
    .getByRole("button", {
      name: "New project",
      exact: true,
    })
    .click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();

  await dialog
    .getByLabel("Project name")
    .fill(projectName);

  await dialog
    .getByRole("button", {
      name: "Create project",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("textbox", {
      name: "Editor content",
      exact: true,
    }),
  ).toBeVisible();
}

test(
  "two users collaborate, preview, snapshot, restore and enforce isolation",
  async ({ browser }) => {
    const owner = await browser.newContext();
    const editor = await browser.newContext();
    const stranger = await browser.newContext();

    const a = await owner.newPage();
    const b = await editor.newPage();
    const c = await stranger.newPage();

    // ------------------------------------------------------------
    // Register users
    // ------------------------------------------------------------

    await register(a, "owner");
    await register(b, "editor");
    await register(c, "stranger");

    // ------------------------------------------------------------
    // Create project
    // ------------------------------------------------------------

    await createProject(a, "E2E workspace");

    const url = a.url();

    // ------------------------------------------------------------
    // Add editor
    // ------------------------------------------------------------

    await a
      .getByRole("button", {
        name: "Members",
        exact: true,
      })
      .click();

    await a
      .getByLabel("Email", {
        exact: true,
      })
      .fill(`editor${suffix}@example.test`);

    await a
      .getByRole("button", {
        name: "Add member",
        exact: true,
      })
      .click();

    await expect(
      a.getByText("Member added", {
        exact: true,
      }),
    ).toBeVisible();

    // ------------------------------------------------------------
    // Editor opens project
    // ------------------------------------------------------------

    await b.goto(url);

    await expect(
      b.getByRole("textbox", {
        name: "Editor content",
        exact: true,
      }),
    ).toBeVisible();

    const ea = a.getByRole("textbox", {
      name: "Editor content",
      exact: true,
    });

    const eb = b.getByRole("textbox", {
      name: "Editor content",
      exact: true,
    });

    // ------------------------------------------------------------
    // Collaborative editing
    // ------------------------------------------------------------

    await Promise.all([
      ea.press("ControlOrMeta+End"),
      eb.press("ControlOrMeta+End"),
    ]);

    await ea.pressSequentially(
      "\n<!-- FROM_OWNER -->",
    );

    await eb.pressSequentially(
      "\n<!-- FROM_EDITOR -->",
    );

    await expect
      .poll(
        async () =>
          a.locator(".view-lines").innerText(),
      )
      .toContain("FROM_EDITOR");

    await expect
      .poll(
        async () =>
          b.locator(".view-lines").innerText(),
      )
      .toContain("FROM_OWNER");

    // ------------------------------------------------------------
    // Remote selection
    // ------------------------------------------------------------

    await expect(
      a
        .locator('[class*="yRemoteSelectionHead-"]')
        .first(),
    ).toBeVisible();

    // ------------------------------------------------------------
    // Preview
    // ------------------------------------------------------------

    const frame = a.frameLocator(
      'iframe[title="Project preview"]',
    );

    await frame
      .getByRole("button", {
        name: "Make it happen · 0",
      })
      .click();

    await expect(
      frame.getByRole("button", {
        name: "Make it happen · 1",
      }),
    ).toBeVisible();

    await expect(
      a.getByRole("log"),
    ).toContainText(
      "You made it happen",
    );

    // ------------------------------------------------------------
    // Version history
    // ------------------------------------------------------------

    await a
      .getByRole("button", {
        name: "Version history",
        exact: true,
      })
      .click();

    await a
      .getByLabel("Snapshot message")
      .fill("Working milestone");

    await a
      .getByRole("button", {
        name: "Create snapshot",
        exact: true,
      })
      .click();

    await expect(
      a.getByText("Snapshot created", {
        exact: true,
      }),
    ).toBeVisible();

    // ------------------------------------------------------------
    // Change after snapshot
    // ------------------------------------------------------------

    await ea.press("ControlOrMeta+End");

    await ea.pressSequentially(
      "\n<!-- AFTER_SNAPSHOT -->",
    );

    await expect(
      a.getByRole("button", {
        name: "Saved",
        exact: true,
      }),
    ).toBeVisible();

    // ------------------------------------------------------------
    // Compare
    // ------------------------------------------------------------

    await a
      .getByRole("button", {
        name: "Compare",
        exact: true,
      })
      .click();

    await expect(
      a.getByRole("dialog"),
    ).toBeVisible();

    await a
      .getByRole("button", {
        name: "Close dialog",
        exact: true,
      })
      .click();

    // ------------------------------------------------------------
    // Restore
    // ------------------------------------------------------------

    await a
      .getByRole("button", {
        name: "Restore snapshot",
        exact: true,
      })
      .click();

    const restoreDialog = a.getByRole("dialog");

    await expect(
      restoreDialog,
    ).toBeVisible();

    await restoreDialog
      .getByRole("button", {
        name: "Restore snapshot",
        exact: true,
      })
      .click();

    // ------------------------------------------------------------
    // Verify restored content
    // ------------------------------------------------------------

    await expect
      .poll(
        async () =>
          a.locator(".view-lines").innerText(),
      )
      .not.toContain(
        "AFTER_SNAPSHOT",
      );

    // ------------------------------------------------------------
    // Stranger cannot access project
    // ------------------------------------------------------------

    await c.goto(url);

    await expect(
      c.getByRole("heading", {
        name: "Couldn’t open this project",
      }),
    ).toBeVisible();

    // IMPORTANT:
    // Do NOT call owner.close(), editor.close(), or stranger.close().
    // Playwright owns these contexts through the browser fixture.
  },
);

test(
  "nested explorer, tabs, quick open and search",
  async ({ page }) => {
    await register(page, "files");

    // ------------------------------------------------------------
    // Create project
    // ------------------------------------------------------------

    await createProject(
      page,
      "File operations",
    );

    // ------------------------------------------------------------
    // Create folder
    // ------------------------------------------------------------

    await page
      .getByRole("button", {
        name: "New folder",
        exact: true,
      })
      .click();

    await page
      .getByLabel("Path", {
        exact: true,
      })
      .fill("src");

    await page
      .getByRole("button", {
        name: "Save",
        exact: true,
      })
      .click();

    // ------------------------------------------------------------
    // Create nested file
    // ------------------------------------------------------------

    await page
      .getByRole("button", {
        name: "New file",
        exact: true,
      })
      .click();

    await page
      .getByLabel("Path", {
        exact: true,
      })
      .fill("src/test.js");

    await page
      .getByRole("button", {
        name: "Save",
        exact: true,
      })
      .click();

    // ------------------------------------------------------------
    // Open test.js
    // ------------------------------------------------------------

    await page
      .getByRole("button", {
        name: "test.js",
        exact: true,
      })
      .click();

    await expect(
      page.getByRole("tab", {
        name: "JS test.js",
      }),
    ).toBeVisible();

    // ------------------------------------------------------------
    // Quick Open
    // ------------------------------------------------------------

    await page
      .getByRole("button", {
        name: "Quick open",
        exact: true,
      })
      .click();

    await expect(
      page.getByRole("dialog"),
    ).toBeVisible();

    await page
      .getByLabel(
        "Search commands or files",
      )
      .fill("styles");

    /*
     * Quick Open's result is not exposed as a button with the
     * accessible name "styles.css" in the current implementation.
     *
     * Search the dialog by text instead of assuming a role.
     */

    const quickOpen = page.getByRole(
      "dialog",
    );

    await expect(
      quickOpen.getByText(
        "styles.css",
        { exact: true },
      ),
    ).toBeVisible();

    await quickOpen
      .getByText(
        "styles.css",
        { exact: true },
      )
      .click();

    // ------------------------------------------------------------
    // Verify styles.css opened
    // ------------------------------------------------------------

    await expect(
      page.getByRole("tab", {
        name: "# styles.css",
      }),
    ).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // ------------------------------------------------------------
    // Workspace search
    // ------------------------------------------------------------

    await page
      .getByRole("button", {
        name: "Search",
        exact: true,
      })
      .click();

    await page
      .getByLabel("Search workspace")
      .fill("background");

    await expect(
      page
        .locator(".search-result")
        .first(),
    ).toBeVisible();
  },
);
