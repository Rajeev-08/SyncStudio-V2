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

/**
 * Opens the New Project modal and creates a project.
 *
 * Important:
 * The dashboard also contains a "Create project" button when
 * there are no projects. Once the modal is open, there can therefore
 * be TWO buttons with the same accessible name.
 *
 * Scoping the locator to the dialog avoids Playwright strict-mode
 * violations.
 */
async function createProject(page: Page, projectName: string) {
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

    try {
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
      // Add editor as project member
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
      // Editor joins project
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

      // Remote cursor/selection should appear.
      await expect(
        a.locator('[class*="yRemoteSelectionHead-"]').first(),
      ).toBeVisible();

      // ------------------------------------------------------------
      // Preview interaction
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
      ).toContainText("You made it happen");

      // ------------------------------------------------------------
      // Version history / snapshot
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
      // Modify after snapshot
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
      // Compare snapshot
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
      // Restore snapshot
      // ------------------------------------------------------------

      await a
        .getByRole("button", {
          name: "Restore snapshot",
          exact: true,
        })
        .click();

      // There may now be two "Restore snapshot" buttons:
      // one in the page and one inside the confirmation dialog.
      // Scope the second click to the dialog.
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
      // Verify snapshot restoration
      // ------------------------------------------------------------

      await expect
        .poll(async () => a.locator(".view-lines").innerText())
        .not.toContain("AFTER_SNAPSHOT");

      // ------------------------------------------------------------
      // Verify project isolation
      // ------------------------------------------------------------

      await c.goto(url);

      await expect(
        c.getByRole("heading", {
          name: "Couldn’t open this project",
        }),
      ).toBeVisible();
    } finally {
      // Always close browser contexts, even when a test fails.
      await owner.close();
      await editor.close();
      await stranger.close();
    }
  },
);

test(
  "nested explorer, tabs, quick open and search",
  async ({ page }) => {
    await register(page, "files");

    // ------------------------------------------------------------
    // Create project
    // ------------------------------------------------------------

    await createProject(page, "File operations");

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
    // Open file
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
    // Quick open
    // ------------------------------------------------------------

    await page
      .getByRole("button", {
        name: "Quick open",
        exact: true,
      })
      .click();

    const quickOpenDialog = page.getByRole("dialog");

    await expect(
      quickOpenDialog,
    ).toBeVisible();

    await page
      .getByLabel("Search commands or files")
      .fill("styles");

    await quickOpenDialog
      .getByRole("button", {
        name: "styles.css",
        exact: true,
      })
      .click();

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
      page.locator(".search-result").first(),
    ).toBeVisible();
  },
);
